// =============================================================================
// Record Profit Instruction Builder
// =============================================================================
// Builds and executes the record_profit instruction on the VULTR contract.
// This distributes liquidation profits: 80% depositors, 15% stakers, 5% treasury
// =============================================================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import idl from "../idl/vultr.json";
import { PoolState } from "../types";
import { Logger } from "../logger";

// =============================================================================
// Record Profit Builder
// =============================================================================

export interface RecordProfitParams {
  /** Amount of profit to record (in deposit token base units) */
  profitAmount: BN;
  /** Pool state (fetched from VultrClient) */
  pool: PoolState;
  /** Pool PDA address */
  poolAddress: PublicKey;
}

export interface RecordProfitResult {
  /** Whether the transaction succeeded */
  success: boolean;
  /** Transaction signature */
  signature?: string;
  /** Error message if failed */
  error?: string;
  /** Actual amounts distributed */
  distribution?: {
    depositorShare: BN;
    stakingShare: BN;
    treasuryShare: BN;
  };
}

/**
 * Builder for record_profit instruction
 */
export class RecordProfitBuilder {
  private connection: Connection;
  private wallet: Keypair;
  private program: Program;
  private logger: Logger;

  constructor(connection: Connection, wallet: Keypair, logger?: Logger) {
    this.connection = connection;
    this.wallet = wallet;
    this.logger = logger || new Logger("RecordProfit");

    // Initialize Anchor program
    const provider = new AnchorProvider(
      connection,
      new Wallet(wallet),
      { commitment: "confirmed" }
    );
    this.program = new Program(idl as any, provider);
  }

  // ===========================================================================
  // Transaction Building
  // ===========================================================================

  /**
   * Build record_profit transaction
   *
   * @param params - Parameters for record_profit
   * @returns Unsigned transaction ready for signing
   */
  async buildTransaction(params: RecordProfitParams): Promise<Transaction> {
    const { profitAmount, pool, poolAddress } = params;

    this.logger.info(
      `Building record_profit tx for ${profitAmount.toNumber() / 1_000_000} USDC`
    );

    // Get bot's profit source token account (where USDC profit sits)
    const profitSource = await getAssociatedTokenAddress(
      pool.depositMint,
      this.wallet.publicKey
    );

    this.logger.debug(`Profit source ATA: ${profitSource.toBase58()}`);
    this.logger.debug(`Vault: ${pool.vault.toBase58()}`);
    this.logger.debug(`Treasury: ${pool.treasury.toBase58()}`);
    this.logger.debug(`Staking rewards: ${pool.stakingRewardsVault.toBase58()}`);

    const tx = new Transaction();

    // Add compute budget (record_profit is relatively simple)
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
    );

    // Build record_profit instruction using Anchor
    const recordProfitIx = await this.program.methods
      .recordProfit(profitAmount)
      .accounts({
        botWallet: this.wallet.publicKey,
        pool: poolAddress,
        vault: pool.vault,
        stakingRewardsVault: pool.stakingRewardsVault,
        treasury: pool.treasury,
        profitSource,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    tx.add(recordProfitIx);

    return tx;
  }

  // ===========================================================================
  // Execution
  // ===========================================================================

  /**
   * Build and execute record_profit
   *
   * @param params - Parameters for record_profit
   * @returns Result of the transaction
   */
  async execute(params: RecordProfitParams): Promise<RecordProfitResult> {
    const { profitAmount, pool } = params;

    this.logger.info(
      `Executing record_profit for ${profitAmount.toNumber() / 1_000_000} USDC profit`
    );

    try {
      // Calculate expected distribution
      const distribution = this.calculateDistribution(profitAmount, pool);

      this.logger.debug(
        `Distribution: ${distribution.depositorShare.toNumber() / 1_000_000} depositors, ` +
        `${distribution.stakingShare.toNumber() / 1_000_000} stakers, ` +
        `${distribution.treasuryShare.toNumber() / 1_000_000} treasury`
      );

      // Ensure profit source ATA exists
      await this.ensureProfitSourceAta(params.pool.depositMint);

      // Build transaction
      const tx = await this.buildTransaction(params);

      // Set recent blockhash and fee payer
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = this.wallet.publicKey;

      // Sign and send
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.wallet],
        { commitment: "confirmed" }
      );

      this.logger.success(`record_profit executed: ${signature}`);

      return {
        success: true,
        signature,
        distribution,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`record_profit failed: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Calculate fee distribution for a profit amount
   *
   * @param profitAmount - Total profit
   * @param pool - Pool state (for fee percentages)
   * @returns Breakdown of distribution
   */
  calculateDistribution(
    profitAmount: BN,
    pool: PoolState
  ): {
    depositorShare: BN;
    stakingShare: BN;
    treasuryShare: BN;
  } {
    const BPS_DENOMINATOR = 10000;

    // Calculate each share
    const depositorShare = profitAmount
      .mul(new BN(pool.depositorFeeBps))
      .div(new BN(BPS_DENOMINATOR));

    const stakingShare = profitAmount
      .mul(new BN(pool.stakingFeeBps))
      .div(new BN(BPS_DENOMINATOR));

    // Treasury gets remainder to avoid rounding issues
    const treasuryShare = profitAmount.sub(depositorShare).sub(stakingShare);

    return {
      depositorShare,
      stakingShare,
      treasuryShare,
    };
  }

  /**
   * Ensure profit source ATA exists for the bot wallet
   */
  private async ensureProfitSourceAta(depositMint: PublicKey): Promise<PublicKey> {
    try {
      const ata = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        depositMint,
        this.wallet.publicKey
      );
      return ata.address;
    } catch (error) {
      this.logger.warn("Could not create profit source ATA", error);
      throw error;
    }
  }
}

export default RecordProfitBuilder;
