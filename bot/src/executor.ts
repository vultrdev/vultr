// =============================================================================
// Liquidation Executor (NEW Design - Direct Execution + record_profit)
// =============================================================================
// Executes liquidations directly and distributes profits via VULTR contract:
// 1. Execute Marginfi liquidation DIRECTLY (not via CPI)
// 2. Swap collateral to USDC via Jupiter DIRECTLY
// 3. Call VULTR record_profit to distribute earnings (80/15/5 split)
// =============================================================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { createJupiterApiClient, QuoteGetRequest, QuoteResponse } from "@jup-ag/api";

import {
  BotConfig,
  LiquidationOpportunity,
  LiquidationResult,
  BotState,
  PoolState,
  StuckCollateral,
} from "./types";
import { Logger } from "./logger";
import { VultrClient, RecordProfitBuilder, StakingClient } from "./vultr";
import {
  executeWithRetry,
  RateLimiter,
  LIQUIDATION_RETRY_CONFIG,
  TX_CONFIRM_RETRY_CONFIG,
} from "./retry";

// =============================================================================
// Constants
// =============================================================================

// Jito tip accounts (one of these must receive the tip)
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
].map((s) => new PublicKey(s));

// Marginfi Program ID
const MARGINFI_PROGRAM_ID = new PublicKey(
  "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"
);

// Jupiter Program ID
const JUPITER_PROGRAM_ID = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);

// Retry configuration for Jupiter swaps
const JUPITER_SWAP_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

// =============================================================================
// Liquidation Executor
// =============================================================================

/**
 * Executor for liquidation transactions using direct execution + record_profit
 */
export class LiquidationExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private config: BotConfig;
  private logger: Logger;
  private state: BotState;
  private vultrClient: VultrClient;
  private recordProfitBuilder: RecordProfitBuilder;
  private stakingClient: StakingClient | null;
  private rateLimiter: RateLimiter;

  // Track stuck collateral for manual recovery
  private stuckCollateral: StuckCollateral[] = [];

  constructor(
    connection: Connection,
    wallet: Keypair,
    config: BotConfig,
    state: BotState,
    logger?: Logger
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.config = config;
    this.state = state;
    this.logger = logger || new Logger("Executor");

    // Initialize rate limiter for RPC calls
    this.rateLimiter = new RateLimiter(
      config.rpcRateLimitMs || 100,
      this.logger
    );

    // Initialize VULTR clients
    this.vultrClient = new VultrClient(connection, wallet, this.logger);
    this.recordProfitBuilder = new RecordProfitBuilder(connection, wallet, this.logger);

    // Initialize Staking client if configured
    if (config.stakingProgramId && config.vltrMint && config.autoDistributeStakingRewards) {
      this.stakingClient = new StakingClient(
        connection,
        wallet,
        config.stakingProgramId,
        this.logger
      );
      this.logger.info("Staking client initialized for auto-distribution");
    } else {
      this.stakingClient = null;
    }
  }

  // ===========================================================================
  // Main Execution Flow
  // ===========================================================================

  /**
   * Execute a liquidation opportunity using direct execution
   *
   * Flow:
   * 1. Execute Marginfi liquidation DIRECTLY (bot calls Marginfi)
   * 2. Swap collateral to USDC via Jupiter DIRECTLY (bot calls Jupiter)
   * 3. Call VULTR record_profit to distribute earnings (80/15/5 split)
   *
   * @param opportunity - The opportunity to execute
   * @returns Result of the liquidation attempt
   */
  async execute(opportunity: LiquidationOpportunity): Promise<LiquidationResult> {
    const startTime = Date.now();

    this.logger.info(
      `Executing liquidation for ${opportunity.position.accountAddress.toBase58().slice(0, 8)}...`
    );

    // Check if dry run
    if (this.config.dryRun) {
      return this.simulateLiquidation(opportunity, startTime);
    }

    try {
      // Fetch current pool state
      const pool = await this.vultrClient.fetchPool(this.config.poolAddress);

      if (pool.isPaused) {
        throw new Error("Pool is paused - cannot execute liquidations");
      }

      // Step 1: Execute Marginfi liquidation DIRECTLY
      this.logger.info("Step 1/3: Executing Marginfi liquidation...");
      const marginfiSig = await this.executeDirectMarginfiLiquidation(opportunity);
      this.logger.success(`Marginfi liquidation complete: ${marginfiSig}`);

      // Wait for confirmation
      await this.waitForConfirmation(marginfiSig);

      // Get collateral balance received
      const collateralMint = opportunity.collateralToSeize.mint;
      const collateralBalance = await this.getTokenBalance(collateralMint);

      if (collateralBalance.isZero()) {
        throw new Error("No collateral received from Marginfi liquidation");
      }

      this.logger.info(
        `Received ${collateralBalance.toNumber() / Math.pow(10, opportunity.collateralToSeize.decimals)} ${opportunity.collateralToSeize.symbol}`
      );

      // Step 2: Swap collateral to USDC via Jupiter DIRECTLY
      this.logger.info("Step 2/3: Swapping collateral to USDC via Jupiter...");
      let swapResult: { signature: string; outputAmount: BN };

      try {
        swapResult = await this.executeDirectJupiterSwapWithRetry(
          collateralMint,
          this.config.depositMint,
          collateralBalance,
          opportunity.collateralToSeize.decimals
        );
        this.logger.success(`Jupiter swap complete: ${swapResult.signature}`);
      } catch (swapError) {
        // Jupiter swap failed after retries - track as stuck collateral
        this.trackStuckCollateral(collateralMint, collateralBalance, swapError);
        throw new Error(`Jupiter swap failed: ${swapError}`);
      }

      // Calculate profit (output - debt repaid)
      const debtRepaid = opportunity.debtToRepay.amount;
      const profit = swapResult.outputAmount.sub(debtRepaid);

      this.logger.info(
        `Swap output: ${swapResult.outputAmount.toNumber() / 1_000_000} USDC, ` +
        `Debt repaid: ${debtRepaid.toNumber() / 1_000_000} USDC, ` +
        `Profit: ${profit.toNumber() / 1_000_000} USDC`
      );

      // Step 3: Record profit in VULTR (distributes 80/15/5)
      if (profit.gt(new BN(0))) {
        this.logger.info("Step 3/3: Recording profit in VULTR...");
        const recordResult = await this.recordProfitBuilder.execute({
          profitAmount: profit,
          pool,
          poolAddress: this.config.poolAddress,
        });

        if (!recordResult.success) {
          this.logger.warn(`record_profit failed: ${recordResult.error}`);
          // Profit recording failed but liquidation succeeded
          // The profit sits in bot wallet - can be retried later
        } else {
          this.logger.success(`Profit recorded: ${recordResult.signature}`);
          if (recordResult.distribution) {
            this.logger.info(
              `Distribution: ${recordResult.distribution.depositorShare.toNumber() / 1_000_000} depositors, ` +
              `${recordResult.distribution.stakingShare.toNumber() / 1_000_000} stakers, ` +
              `${recordResult.distribution.treasuryShare.toNumber() / 1_000_000} treasury`
            );

            // Auto-distribute staking rewards if enabled
            if (
              this.stakingClient &&
              this.config.vltrMint &&
              recordResult.distribution.stakingShare.gt(new BN(0))
            ) {
              this.logger.info("Auto-distributing staking rewards...");
              const distributeResult = await this.stakingClient.distribute(
                this.config.vltrMint,
                recordResult.distribution.stakingShare,
                pool.stakingRewardsVault
              );

              if (distributeResult.success) {
                this.logger.success(
                  `Staking rewards distributed: ${recordResult.distribution.stakingShare.toNumber() / 1_000_000} USDC`
                );
              } else {
                this.logger.warn(`Staking distribution failed: ${distributeResult.error}`);
              }
            }
          }
        }
      } else {
        this.logger.warn("No profit generated from liquidation");
      }

      const executionTimeMs = Date.now() - startTime;

      this.logger.success(`✅ Liquidation successful!`);

      // Update state
      this.state.liquidationsSuccessful++;
      this.state.totalProfit = this.state.totalProfit.add(profit);
      this.state.lastLiquidationAt = Date.now();

      return {
        success: true,
        signature: swapResult.signature,
        actualProfit: profit,
        gasCost: opportunity.estimatedGasCost,
        executionTimeMs,
        opportunity,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Liquidation failed: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        executionTimeMs,
        opportunity,
      };
    } finally {
      this.state.liquidationsAttempted++;
    }
  }

  // ===========================================================================
  // Direct Marginfi Liquidation
  // ===========================================================================

  /**
   * Execute Marginfi liquidation DIRECTLY (not via VULTR CPI)
   *
   * The bot calls Marginfi.liquidate() directly, receiving collateral
   * in exchange for repaying debt.
   */
  private async executeDirectMarginfiLiquidation(
    opportunity: LiquidationOpportunity
  ): Promise<string> {
    if (!opportunity.position.marginfiAccounts) {
      throw new Error("Missing Marginfi accounts in opportunity");
    }

    const {
      marginfiGroup,
      assetBank,
      liabBank,
      assetBankLiquidityVault,
      liabBankLiquidityVault,
      insuranceVault,
      insuranceVaultAuthority,
      assetBankOracle,
      liabBankOracle,
    } = opportunity.position.marginfiAccounts;

    const liquidateeMarginfiAccount = opportunity.position.accountAddress;
    const assetAmount = opportunity.debtToRepay.amount;

    // Get/create liquidator's collateral token account
    const collateralMint = opportunity.collateralToSeize.mint;
    const liquidatorCollateralAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.wallet,
      collateralMint,
      this.wallet.publicKey
    );

    // Get liquidator's liability token account (USDC)
    const liquidatorLiabAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.wallet,
      this.config.depositMint,
      this.wallet.publicKey
    );

    // Build Marginfi liquidate instruction
    // Using marginfi-client-v2 SDK approach
    const tx = new Transaction();

    // Add compute budget
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
    );

    // Build liquidate instruction data
    // Discriminator for liquidate = [0xdf, 0x15, 0x8c, 0xb5, 0x6b, 0x4f, 0x8b, 0x99]
    const discriminator = Buffer.from([223, 21, 140, 181, 107, 79, 139, 153]);
    const amountBuffer = Buffer.alloc(8);
    assetAmount.toArrayLike(Buffer, "le", 8).copy(amountBuffer);
    const instructionData = Buffer.concat([discriminator, amountBuffer]);

    const liquidateIx = new TransactionInstruction({
      programId: MARGINFI_PROGRAM_ID,
      keys: [
        { pubkey: marginfiGroup, isSigner: false, isWritable: false },
        { pubkey: assetBank, isSigner: false, isWritable: true },
        { pubkey: liabBank, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: false }, // liquidator
        { pubkey: liquidateeMarginfiAccount, isSigner: false, isWritable: true },
        { pubkey: liquidatorLiabAccount.address, isSigner: false, isWritable: true },
        { pubkey: liabBankLiquidityVault, isSigner: false, isWritable: true },
        { pubkey: assetBankLiquidityVault, isSigner: false, isWritable: true },
        { pubkey: liquidatorCollateralAccount.address, isSigner: false, isWritable: true },
        { pubkey: insuranceVault, isSigner: false, isWritable: true },
        { pubkey: insuranceVaultAuthority, isSigner: false, isWritable: false },
        { pubkey: liabBankOracle, isSigner: false, isWritable: false },
        { pubkey: assetBankOracle, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    tx.add(liquidateIx);

    // Add Jito tip if enabled
    if (this.config.useJito) {
      tx.add(this.buildJitoTipInstruction());
    }

    // Send transaction
    const signature = await this.sendTransaction(tx);
    return signature;
  }

  // ===========================================================================
  // Direct Jupiter Swap
  // ===========================================================================

  /**
   * Execute Jupiter swap with retry logic
   */
  private async executeDirectJupiterSwapWithRetry(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: BN,
    inputDecimals: number
  ): Promise<{ signature: string; outputAmount: BN }> {
    return executeWithRetry(
      async () => this.executeDirectJupiterSwap(inputMint, outputMint, amount, inputDecimals),
      JUPITER_SWAP_RETRY_CONFIG,
      this.logger
    );
  }

  /**
   * Execute Jupiter swap DIRECTLY (not via VULTR CPI)
   *
   * @param inputMint - Token to swap from (collateral)
   * @param outputMint - Token to swap to (USDC)
   * @param amount - Amount of input token
   * @param inputDecimals - Decimals of input token
   * @returns Signature and output amount
   */
  private async executeDirectJupiterSwap(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: BN,
    inputDecimals: number
  ): Promise<{ signature: string; outputAmount: BN }> {
    this.logger.info(
      `Swapping ${amount.toNumber() / Math.pow(10, inputDecimals)} tokens via Jupiter`
    );

    try {
      // Create Jupiter API client
      const jupiterApi = createJupiterApiClient();

      // Get quote from Jupiter
      const quoteRequest: QuoteGetRequest = {
        inputMint: inputMint.toBase58(),
        outputMint: outputMint.toBase58(),
        amount: amount.toNumber(),
        slippageBps: 300, // 3% slippage
      };

      this.logger.debug("Fetching Jupiter quote...");
      const quote: QuoteResponse = await jupiterApi.quoteGet(quoteRequest);

      if (!quote) {
        throw new Error("Failed to get Jupiter quote");
      }

      const outputAmount = new BN(quote.outAmount);
      this.logger.info(
        `Jupiter quote: ${amount.toString()} → ${outputAmount.toString()} (${outputAmount.toNumber() / 1_000_000} USDC)`
      );

      // Get swap transaction
      this.logger.debug("Getting Jupiter swap transaction...");
      const swapResult = await jupiterApi.swapPost({
        swapRequest: {
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        },
      });

      if (!swapResult || !swapResult.swapTransaction) {
        throw new Error("Failed to get Jupiter swap transaction");
      }

      // Deserialize and send the transaction
      const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, "base64");
      const transaction = Transaction.from(swapTransactionBuf);

      // Sign with bot wallet
      transaction.sign(this.wallet);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        }
      );

      // Wait for confirmation
      await this.waitForConfirmation(signature);

      return {
        signature,
        outputAmount,
      };
    } catch (error) {
      this.logger.error("Jupiter swap failed", error);
      throw error;
    }
  }

  // ===========================================================================
  // Stuck Collateral Tracking
  // ===========================================================================

  /**
   * Track collateral that failed to swap for manual recovery
   */
  private trackStuckCollateral(
    mint: PublicKey,
    amount: BN,
    error: unknown
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if we already have this mint tracked
    const existing = this.stuckCollateral.find((s) => s.mint.equals(mint));

    if (existing) {
      existing.amount = existing.amount.add(amount);
      existing.retryCount++;
      existing.lastError = errorMessage;
    } else {
      this.stuckCollateral.push({
        mint,
        amount,
        stuckAt: Date.now(),
        retryCount: 1,
        lastError: errorMessage,
      });
    }

    this.logger.warn(
      `Stuck collateral tracked: ${mint.toBase58().slice(0, 8)}... - ${amount.toString()} units`
    );
  }

  /**
   * Get list of stuck collateral for monitoring/recovery
   */
  getStuckCollateral(): StuckCollateral[] {
    return [...this.stuckCollateral];
  }

  /**
   * Attempt to recover stuck collateral by retrying Jupiter swap
   */
  async recoverStuckCollateral(mint: PublicKey): Promise<boolean> {
    const stuck = this.stuckCollateral.find((s) => s.mint.equals(mint));
    if (!stuck) {
      this.logger.warn(`No stuck collateral found for ${mint.toBase58()}`);
      return false;
    }

    this.logger.info(`Attempting to recover stuck collateral: ${mint.toBase58()}`);

    try {
      const result = await this.executeDirectJupiterSwapWithRetry(
        mint,
        this.config.depositMint,
        stuck.amount,
        6 // Assume 6 decimals, could be improved by looking up mint info
      );

      // Remove from stuck list
      this.stuckCollateral = this.stuckCollateral.filter((s) => !s.mint.equals(mint));

      this.logger.success(`Recovered stuck collateral: ${result.signature}`);

      // Record profit from recovered collateral
      const pool = await this.vultrClient.fetchPool(this.config.poolAddress);
      await this.recordProfitBuilder.execute({
        profitAmount: result.outputAmount,
        pool,
        poolAddress: this.config.poolAddress,
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to recover stuck collateral: ${error}`);
      stuck.retryCount++;
      stuck.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  // ===========================================================================
  // Simulation
  // ===========================================================================

  /**
   * Simulate a liquidation (dry run mode)
   */
  private async simulateLiquidation(
    opportunity: LiquidationOpportunity,
    startTime: number
  ): Promise<LiquidationResult> {
    this.logger.info("[DRY RUN] Simulating liquidation...");
    this.logger.info("[DRY RUN] Step 1/3: Marginfi liquidation...");
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.logger.info("[DRY RUN] Step 2/3: Jupiter swap...");
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.logger.info("[DRY RUN] Step 3/3: Record profit...");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Randomly succeed or fail for realistic simulation
    const success = Math.random() > 0.1; // 90% success rate

    const executionTimeMs = Date.now() - startTime;

    if (success) {
      this.logger.success("[DRY RUN] Liquidation simulation successful");
      return {
        success: true,
        signature: `sim_${Date.now().toString(36)}`,
        actualProfit: opportunity.netProfit,
        gasCost: opportunity.estimatedGasCost,
        executionTimeMs,
        opportunity,
      };
    } else {
      this.logger.warn("[DRY RUN] Liquidation simulation failed");
      return {
        success: false,
        error: "Simulated failure",
        executionTimeMs,
        opportunity,
      };
    }
  }

  // ===========================================================================
  // Transaction Helpers
  // ===========================================================================

  /**
   * Build Jito tip instruction
   */
  private buildJitoTipInstruction(): TransactionInstruction {
    const tipAccount =
      JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];

    return SystemProgram.transfer({
      fromPubkey: this.wallet.publicKey,
      toPubkey: tipAccount,
      lamports: this.config.jitoTipLamports,
    });
  }

  /**
   * Send transaction with rate limiting and error handling
   */
  private async sendTransaction(transaction: Transaction): Promise<string> {
    return await this.rateLimiter.execute(async () => {
      // Set recent blockhash and fee payer
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.wallet.publicKey;

      // Sign transaction
      transaction.sign(this.wallet);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        }
      );

      return signature;
    });
  }

  /**
   * Wait for transaction confirmation with retries
   */
  private async waitForConfirmation(signature: string): Promise<void> {
    await executeWithRetry(
      async () => {
        const confirmation = await this.connection.confirmTransaction(
          signature,
          "confirmed"
        );

        if (confirmation.value.err) {
          throw new Error(
            `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
          );
        }

        this.logger.debug(`Transaction confirmed: ${signature}`);
      },
      TX_CONFIRM_RETRY_CONFIG,
      this.logger
    );
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get token balance for a mint in bot wallet
   */
  private async getTokenBalance(mint: PublicKey): Promise<BN> {
    try {
      const tokenAccount = await getAssociatedTokenAddress(
        mint,
        this.wallet.publicKey
      );
      const account = await getAccount(this.connection, tokenAccount);
      return new BN(account.amount.toString());
    } catch {
      return new BN(0);
    }
  }

  /**
   * Get bot's USDC balance
   */
  async getBotUsdcBalance(): Promise<BN> {
    return this.getTokenBalance(this.config.depositMint);
  }

  /**
   * Get bot's SOL balance
   */
  async getSolBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance;
  }

  /**
   * Check if bot is authorized for the pool
   */
  async isBotAuthorized(): Promise<boolean> {
    return this.vultrClient.isBotAuthorized(
      this.config.poolAddress,
      this.wallet.publicKey
    );
  }

  /**
   * Get current pool state
   */
  async getPoolState(): Promise<PoolState> {
    return this.vultrClient.fetchPool(this.config.poolAddress);
  }
}
