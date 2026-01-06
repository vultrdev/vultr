// =============================================================================
// Liquidation Executor
// =============================================================================
// Executes liquidations through the VULTR pool with optional Jito bundles
// for MEV protection.
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
import BN from "bn.js";

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

// =============================================================================
// Liquidation Executor
// =============================================================================

/**
 * Executor for liquidation transactions
 */
export class LiquidationExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private config: BotConfig;
  private logger: Logger;
  private state: BotState;

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
  }

  // ===========================================================================
  // Liquidation Execution
  // ===========================================================================

  /**
   * Execute a liquidation opportunity
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
      // Build the liquidation transaction
      const transaction = await this.buildLiquidationTransaction(opportunity);

      // Send transaction
      let signature: string;

      if (this.config.useJito) {
        signature = await this.sendWithJito(transaction);
      } else {
        signature = await this.sendTransaction(transaction);
      }

      const executionTimeMs = Date.now() - startTime;

      this.logger.success(`Liquidation successful: ${signature}`);

      // Update state
      this.state.liquidationsSuccessful++;
      this.state.totalProfit = this.state.totalProfit.add(opportunity.netProfit);
      this.state.lastLiquidationAt = Date.now();

      return {
        success: true,
        signature,
        actualProfit: opportunity.netProfit, // In production, calculate from tx result
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
   * Simulate a liquidation (dry run mode)
   */
  private async simulateLiquidation(
    opportunity: LiquidationOpportunity,
    startTime: number
  ): Promise<LiquidationResult> {
    this.logger.info("[DRY RUN] Simulating liquidation...");

    // Simulate some processing time
    await new Promise((resolve) => setTimeout(resolve, 100));

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
  // Transaction Building
  // ===========================================================================

  /**
   * Build a liquidation transaction
   *
   * This builds a transaction that:
   * 1. Calls the VULTR execute_liquidation instruction
   * 2. (In production) Also includes CPI to marginfi for actual liquidation
   */
  private async buildLiquidationTransaction(
    opportunity: LiquidationOpportunity
  ): Promise<Transaction> {
    const transaction = new Transaction();

    // Add compute budget instructions for priority
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
    );

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

    // Get operator's token account
    const operatorTokenAccount = await getAssociatedTokenAddress(
      this.config.depositMint,
      this.wallet.publicKey
    );

    // Ensure operator token account exists
    try {
      await getAccount(this.connection, operatorTokenAccount);
    } catch {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          this.wallet.publicKey,
          operatorTokenAccount,
          this.wallet.publicKey,
          this.config.depositMint
        )
      );
    }

    // Build execute_liquidation instruction
    // In production, this would be built using Anchor's instruction builder
    const executeLiquidationIx = await this.buildExecuteLiquidationInstruction(
      opportunity,
      {
        pool: poolPda,
        vault: vaultPda,
        operator: operatorPda,
        protocolFeeVault: protocolFeeVaultPda,
        operatorTokenAccount,
      }
    );

    transaction.add(executeLiquidationIx);

    // Add Jito tip if enabled
    if (this.config.useJito) {
      transaction.add(this.buildJitoTipInstruction());
    }

    // Set recent blockhash and fee payer
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.wallet.publicKey;

    return transaction;
  }

  /**
   * Build the execute_liquidation instruction
   *
   * ⚠️  IMPORTANT: This uses a hardcoded instruction discriminator.
   *
   * In production, you should:
   * 1. Import the generated IDL from target/types/vultr.ts
   * 2. Use Anchor's Program class to build instructions:
   *    ```typescript
   *    import { Program } from "@coral-xyz/anchor";
   *    import { Vultr } from "../target/types/vultr";
   *
   *    const program = new Program<Vultr>(idl, provider);
   *    const ix = await program.methods
   *      .executeLiquidation(profit)
   *      .accounts({...})
   *      .instruction();
   *    ```
   *
   * The discriminator below is calculated as:
   * sha256("global:execute_liquidation")[0..8]
   */
  private async buildExecuteLiquidationInstruction(
    opportunity: LiquidationOpportunity,
    accounts: {
      pool: PublicKey;
      vault: PublicKey;
      operator: PublicKey;
      protocolFeeVault: PublicKey;
      operatorTokenAccount: PublicKey;
    }
  ): Promise<TransactionInstruction> {
    // Instruction discriminator for execute_liquidation
    // ⚠️  HARDCODED - In production, use Anchor's instruction builder
    // This discriminator may change if the instruction name changes!
    // Regenerate with: sha256("global:execute_liquidation")[0..8]
    const EXECUTE_LIQUIDATION_DISCRIMINATOR = Buffer.from([
      0x9d, 0x13, 0x07, 0x8f, 0x5b, 0x2a, 0x1c, 0x4e,
    ]);

    // Encode profit amount as little-endian u64
    const profitBuffer = Buffer.alloc(8);
    profitBuffer.writeBigUInt64LE(BigInt(opportunity.estimatedProfit.toString()));

    const data = Buffer.concat([EXECUTE_LIQUIDATION_DISCRIMINATOR, profitBuffer]);

    // Build instruction
    const instruction = new TransactionInstruction({
      programId: this.config.vultrProgramId,
      keys: [
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: accounts.pool, isSigner: false, isWritable: true },
        { pubkey: accounts.operator, isSigner: false, isWritable: true },
        { pubkey: this.config.depositMint, isSigner: false, isWritable: false },
        { pubkey: accounts.vault, isSigner: false, isWritable: true },
        { pubkey: accounts.protocolFeeVault, isSigner: false, isWritable: true },
        { pubkey: accounts.operatorTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });

    return instruction;
  }

  /**
   * Build Jito tip instruction
   */
  private buildJitoTipInstruction(): TransactionInstruction {
    // Pick a random tip account
    const tipAccount =
      JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];

    return SystemProgram.transfer({
      fromPubkey: this.wallet.publicKey,
      toPubkey: tipAccount,
      lamports: this.config.jitoTipLamports,
    });
  }

  // ===========================================================================
  // Transaction Sending
  // ===========================================================================

  /**
   * Send transaction normally
   */
  private async sendTransaction(transaction: Transaction): Promise<string> {
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

    // Serialize the transaction
    const serializedTx = transaction.serialize();

    // In production, use jito-ts to submit the bundle:
    // const bundle = new Bundle([transaction]);
    // const response = await jitoClient.sendBundle(bundle);

    // For now, fall back to normal sending
    // In a real implementation, you would:
    // 1. Create a Jito bundle with the transaction
    // 2. Submit to Jito block engine
    // 3. Wait for bundle confirmation

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
