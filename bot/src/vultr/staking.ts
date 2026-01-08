// =============================================================================
// VLTR Staking Client - Distribute Rewards
// =============================================================================
// Handles distribution of staking rewards after liquidation profits
// =============================================================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import { Logger } from "../logger";
import { StakingPoolState } from "../types";

// PDA seeds (must match contract)
const STAKING_POOL_SEED = "staking_pool";

/**
 * Client for interacting with VLTR Staking contract
 */
export class StakingClient {
  private connection: Connection;
  private wallet: Keypair;
  private logger: Logger;
  private programId: PublicKey;

  constructor(
    connection: Connection,
    wallet: Keypair,
    programId: PublicKey,
    logger?: Logger
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.programId = programId;
    this.logger = logger || new Logger("StakingClient");
  }

  /**
   * Derive the staking pool PDA for a given VLTR mint
   */
  deriveStakingPoolPDA(vltrMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(STAKING_POOL_SEED), vltrMint.toBuffer()],
      this.programId
    );
  }

  /**
   * Fetch staking pool state
   */
  async fetchStakingPool(vltrMint: PublicKey): Promise<StakingPoolState | null> {
    try {
      const [poolPda] = this.deriveStakingPoolPDA(vltrMint);
      const accountInfo = await this.connection.getAccountInfo(poolPda);

      if (!accountInfo) {
        return null;
      }

      // Parse account data (Anchor account discriminator is first 8 bytes)
      const data = accountInfo.data.slice(8);

      return {
        admin: new PublicKey(data.slice(0, 32)),
        vltrMint: new PublicKey(data.slice(32, 64)),
        rewardMint: new PublicKey(data.slice(64, 96)),
        stakeVault: new PublicKey(data.slice(96, 128)),
        rewardVault: new PublicKey(data.slice(128, 160)),
        totalStaked: new BN(data.slice(160, 168), "le"),
        totalRewardsDistributed: new BN(data.slice(168, 176), "le"),
        rewardPerToken: new BN(data.slice(176, 192), "le"),
        lastDistributionTime: new BN(data.slice(192, 200), "le").toNumber(),
        stakerCount: new BN(data.slice(200, 204), "le").toNumber(),
        isPaused: data[204] !== 0,
      };
    } catch (error) {
      this.logger.error("Failed to fetch staking pool", error);
      return null;
    }
  }

  /**
   * Distribute rewards to stakers
   *
   * This should be called after record_profit to update reward_per_token
   * so stakers can claim their share.
   *
   * @param vltrMint - The VLTR token mint
   * @param amount - Amount of USDC to distribute
   * @param sourceTokenAccount - Token account to distribute from (staking_rewards_vault)
   * @returns Transaction signature or null if failed
   */
  async distribute(
    vltrMint: PublicKey,
    amount: BN,
    sourceTokenAccount: PublicKey
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const [stakingPoolPda] = this.deriveStakingPoolPDA(vltrMint);
      const stakingPool = await this.fetchStakingPool(vltrMint);

      if (!stakingPool) {
        return { success: false, error: "Staking pool not found" };
      }

      if (stakingPool.isPaused) {
        return { success: false, error: "Staking pool is paused" };
      }

      if (stakingPool.totalStaked.isZero()) {
        this.logger.info("No stakers - skipping distribution");
        return { success: true, signature: "skipped_no_stakers" };
      }

      // Build distribute instruction
      // Discriminator for distribute (from IDL hash)
      const discriminator = this.getDistributeDiscriminator();
      const amountBuffer = Buffer.alloc(8);
      amount.toArrayLike(Buffer, "le", 8).copy(amountBuffer);
      const instructionData = Buffer.concat([discriminator, amountBuffer]);

      const distributeIx = new TransactionInstruction({
        programId: this.programId,
        keys: [
          { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true }, // admin/authority
          { pubkey: stakingPoolPda, isSigner: false, isWritable: true }, // staking_pool
          { pubkey: sourceTokenAccount, isSigner: false, isWritable: true }, // source (staking_rewards_vault)
          { pubkey: stakingPool.rewardVault, isSigner: false, isWritable: true }, // reward_vault
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
        ],
        data: instructionData,
      });

      // Build and send transaction
      const tx = new Transaction().add(distributeIx);
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = this.wallet.publicKey;
      tx.sign(this.wallet);

      const signature = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      // Wait for confirmation
      await this.connection.confirmTransaction(signature, "confirmed");

      this.logger.success(`Staking rewards distributed: ${signature}`);
      return { success: true, signature };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to distribute staking rewards: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get the instruction discriminator for "distribute"
   * This is the first 8 bytes of sha256("global:distribute")
   */
  private getDistributeDiscriminator(): Buffer {
    // Pre-computed discriminator for "global:distribute"
    // You can verify with: sha256("global:distribute").slice(0, 8)
    return Buffer.from([0x49, 0x5e, 0xdb, 0x64, 0x85, 0xa5, 0x48, 0x5f]);
  }
}
