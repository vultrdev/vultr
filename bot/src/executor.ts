// =============================================================================
// Liquidation Executor (Updated for 2-Step Liquidation)
// =============================================================================
// Executes liquidations through the VULTR pool using a 2-step process:
// 1. execute_liquidation: Marginfi CPI to liquidate position
// 2. complete_liquidation: Jupiter swap + profit distribution
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
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import idl from "./idl/vultr.json";

import {
  BotConfig,
  LiquidationOpportunity,
  LiquidationResult,
  BotState,
} from "./types";
import { Logger } from "./logger";

// =============================================================================
// Constants
// =============================================================================

// PDA seeds (must match on-chain program)
const POOL_SEED = Buffer.from("pool");
const VAULT_SEED = Buffer.from("vault");
const OPERATOR_SEED = Buffer.from("operator");
const PROTOCOL_FEE_VAULT_SEED = Buffer.from("protocol_fee_vault");

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

// =============================================================================
// Liquidation Executor
// =============================================================================

/**
 * Executor for liquidation transactions using 2-step process
 */
export class LiquidationExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private config: BotConfig;
  private logger: Logger;
  private state: BotState;
  private program: Program;

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

    // Initialize Anchor program
    const provider = new AnchorProvider(
      connection,
      new Wallet(wallet),
      { commitment: "confirmed" }
    );
    this.program = new Program(idl as any, provider);
  }

  // ===========================================================================
  // Liquidation Execution (2-Step Process)
  // ===========================================================================

  /**
   * Execute a liquidation opportunity using 2-step process
   *
   * Step 1: execute_liquidation (Marginfi CPI)
   * Step 2: complete_liquidation (Jupiter swap + fee distribution)
   *
   * @param opportunity - The opportunity to execute
   * @returns Result of the liquidation attempt
   */
  async execute(opportunity: LiquidationOpportunity): Promise<LiquidationResult> {
    const startTime = Date.now();

    this.logger.info(
      `Executing 2-step liquidation for ${opportunity.position.accountAddress.toBase58().slice(0, 8)}...`
    );

    // Check if dry run
    if (this.config.dryRun) {
      return this.simulateLiquidation(opportunity, startTime);
    }

    try {
      // Step 1: Execute Marginfi liquidation
      this.logger.info("Step 1/2: Executing Marginfi liquidation...");
      const step1Sig = await this.executeMarginfiLiquidation(opportunity);
      this.logger.success(`Step 1 complete: ${step1Sig}`);

      // Wait for confirmation
      await this.connection.confirmTransaction(step1Sig, "confirmed");

      // Step 2: Complete with Jupiter swap
      this.logger.info("Step 2/2: Executing Jupiter swap and profit distribution...");
      const step2Sig = await this.completeLiquidation(opportunity);
      this.logger.success(`Step 2 complete: ${step2Sig}`);

      const executionTimeMs = Date.now() - startTime;

      this.logger.success(`✅ 2-step liquidation successful!`);
      this.logger.info(`  Step 1 (Marginfi): ${step1Sig}`);
      this.logger.info(`  Step 2 (Jupiter):  ${step2Sig}`);

      // Update state
      this.state.liquidationsSuccessful++;
      this.state.totalProfit = this.state.totalProfit.add(opportunity.netProfit);
      this.state.lastLiquidationAt = Date.now();

      return {
        success: true,
        signature: step2Sig, // Return final signature
        actualProfit: opportunity.netProfit,
        gasCost: opportunity.estimatedGasCost,
        executionTimeMs,
        opportunity,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

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

  /**
   * Step 1: Execute Marginfi liquidation
   *
   * This calls execute_liquidation which:
   * - Transfers USDC from vault to Marginfi
   * - CPIs to Marginfi.liquidate()
   * - Receives collateral in pool-controlled account
   */
  private async executeMarginfiLiquidation(
    opportunity: LiquidationOpportunity
  ): Promise<string> {
    // Get PDAs
    const [poolPda] = PublicKey.findProgramAddressSync(
      [POOL_SEED, this.config.depositMint.toBuffer()],
      this.config.vultrProgramId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, poolPda.toBuffer()],
      this.config.vultrProgramId
    );

    const [operatorPda] = PublicKey.findProgramAddressSync(
      [OPERATOR_SEED, poolPda.toBuffer(), this.wallet.publicKey.toBuffer()],
      this.config.vultrProgramId
    );

    // Get Marginfi accounts from opportunity
    // These are populated by the Marginfi client when fetching positions
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

    // Collateral account (pool-controlled)
    const liquidatorCollateralAccount = await getAssociatedTokenAddress(
      opportunity.collateralToSeize.mint,
      poolPda,
      true // allowOwnerOffCurve
    );

    // Asset amount to liquidate (liability to repay)
    const assetAmount = opportunity.debtToRepay.amount;

    // Build transaction
    const tx = new Transaction();

    // Add compute budget
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
    );

    // Build execute_liquidation instruction using Anchor
    const executeLiquidationIx = await this.program.methods
      .executeLiquidation(assetAmount)
      .accounts({
        operatorAuthority: this.wallet.publicKey,
        pool: poolPda,
        operator: operatorPda,
        vault: vaultPda,
        marginfiProgram: MARGINFI_PROGRAM_ID,
        marginfiGroup,
        liquidateeMarginfiAccount,
        assetBank,
        liabBank,
        assetBankLiquidityVault,
        liabBankLiquidityVault,
        liquidatorCollateralAccount,
        insuranceVault,
        insuranceVaultAuthority,
        assetBankOracle,
        liabBankOracle,
        depositMint: this.config.depositMint,
        collateralMint: opportunity.collateralToSeize.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    tx.add(executeLiquidationIx);

    // Add Jito tip if enabled
    if (this.config.useJito) {
      tx.add(this.buildJitoTipInstruction());
    }

    // Send transaction
    const signature = await this.sendTransaction(tx);
    return signature;
  }

  /**
   * Step 2: Complete liquidation with Jupiter swap
   *
   * This calls complete_liquidation which:
   * - Swaps collateral to USDC via Jupiter
   * - Calculates profit
   * - Distributes fees (80/15/5)
   */
  private async completeLiquidation(
    opportunity: LiquidationOpportunity
  ): Promise<string> {
    // Get PDAs
    const [poolPda] = PublicKey.findProgramAddressSync(
      [POOL_SEED, this.config.depositMint.toBuffer()],
      this.config.vultrProgramId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, poolPda.toBuffer()],
      this.config.vultrProgramId
    );

    const [operatorPda] = PublicKey.findProgramAddressSync(
      [OPERATOR_SEED, poolPda.toBuffer(), this.wallet.publicKey.toBuffer()],
      this.config.vultrProgramId
    );

    const [protocolFeeVaultPda] = PublicKey.findProgramAddressSync(
      [PROTOCOL_FEE_VAULT_SEED, poolPda.toBuffer()],
      this.config.vultrProgramId
    );

    // Operator token account
    const operatorTokenAccount = await getAssociatedTokenAddress(
      this.config.depositMint,
      this.wallet.publicKey
    );

    // Collateral source (received from Marginfi)
    const collateralSource = await getAssociatedTokenAddress(
      opportunity.collateralToSeize.mint,
      poolPda,
      true
    );

    // Swap destination (temporary USDC account)
    const swapDestination = await getAssociatedTokenAddress(
      this.config.depositMint,
      poolPda,
      true
    );

    // Slippage protection
    const minOutputAmount = opportunity.estimatedProfit
      .mul(new BN(97)) // 3% slippage tolerance
      .div(new BN(100));

    // Liquidation cost (amount spent in step 1)
    const liquidationCost = opportunity.debtToRepay.amount;

    // Build transaction
    const tx = new Transaction();

    // Add compute budget
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
    );

    // Build complete_liquidation instruction using Anchor
    const completeLiquidationIx = await this.program.methods
      .completeLiquidation(minOutputAmount, liquidationCost)
      .accounts({
        operatorAuthority: this.wallet.publicKey,
        pool: poolPda,
        operator: operatorPda,
        vault: vaultPda,
        protocolFeeVault: protocolFeeVaultPda,
        operatorTokenAccount,
        collateralSource,
        swapDestination,
        jupiterProgram: JUPITER_PROGRAM_ID,
        depositMint: this.config.depositMint,
        collateralMint: opportunity.collateralToSeize.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      // TODO: Add remaining_accounts for Jupiter swap route
      // .remainingAccounts([...jupiterAccounts])
      .instruction();

    tx.add(completeLiquidationIx);

    // Add Jito tip if enabled
    if (this.config.useJito) {
      tx.add(this.buildJitoTipInstruction());
    }

    // Send transaction
    const signature = await this.sendTransaction(tx);
    return signature;
  }

  /**
   * Simulate a liquidation (dry run mode)
   */
  private async simulateLiquidation(
    opportunity: LiquidationOpportunity,
    startTime: number
  ): Promise<LiquidationResult> {
    this.logger.info("[DRY RUN] Simulating 2-step liquidation...");
    this.logger.info("[DRY RUN] Step 1/2: Marginfi liquidation...");
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.logger.info("[DRY RUN] Step 2/2: Jupiter swap...");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Randomly succeed or fail for realistic simulation
    const success = Math.random() > 0.1; // 90% success rate

    const executionTimeMs = Date.now() - startTime;

    if (success) {
      this.logger.success("[DRY RUN] 2-step liquidation simulation successful");
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
  // Transaction Sending
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
   * Send transaction normally
   */
  private async sendTransaction(transaction: Transaction): Promise<string> {
    // Set recent blockhash and fee payer
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.wallet.publicKey;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.wallet],
      {
        commitment: "confirmed",
        maxRetries: 3,
      }
    );

    return signature;
  }

  /**
   * Send transaction via Jito bundle
   *
   * NOTE: This is a simplified implementation. In production, use the
   * jito-ts SDK for proper bundle submission.
   */
  private async sendWithJito(transaction: Transaction): Promise<string> {
    this.logger.debug("Sending transaction via Jito...");

    // Sign the transaction
    transaction.sign(this.wallet);

    // In production, use jito-ts to submit the bundle
    this.logger.warn(
      "Jito bundle submission not fully implemented, falling back to normal send"
    );

    return await this.sendTransaction(transaction);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Check if operator is registered for the pool
   */
  async isOperatorRegistered(): Promise<boolean> {
    const [poolPda] = PublicKey.findProgramAddressSync(
      [POOL_SEED, this.config.depositMint.toBuffer()],
      this.config.vultrProgramId
    );

    const [operatorPda] = PublicKey.findProgramAddressSync(
      [OPERATOR_SEED, poolPda.toBuffer(), this.wallet.publicKey.toBuffer()],
      this.config.vultrProgramId
    );

    try {
      const account = await this.connection.getAccountInfo(operatorPda);
      return account !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get operator's token balance
   */
  async getOperatorBalance(): Promise<BN> {
    try {
      const tokenAccount = await getAssociatedTokenAddress(
        this.config.depositMint,
        this.wallet.publicKey
      );
      const account = await getAccount(this.connection, tokenAccount);
      return new BN(account.amount.toString());
    } catch {
      return new BN(0);
    }
  }

  /**
   * Get operator's SOL balance
   */
  async getSolBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance;
  }
}
