// =============================================================================
// VULTR Pool Client
// =============================================================================
// Client for interacting with the VULTR pool contract.
// Fetches pool state and verifies bot authorization.
// =============================================================================

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import idl from "../idl/vultr.json";
import { PoolState } from "../types";
import { Logger } from "../logger";

// =============================================================================
// VULTR Client
// =============================================================================

/**
 * Client for interacting with VULTR Pool
 */
export class VultrClient {
  private connection: Connection;
  private wallet: Keypair;
  private program: Program;
  private logger: Logger;

  constructor(connection: Connection, wallet: Keypair, logger?: Logger) {
    this.connection = connection;
    this.wallet = wallet;
    this.logger = logger || new Logger("VultrClient");

    // Initialize Anchor program
    const provider = new AnchorProvider(
      connection,
      new Wallet(wallet),
      { commitment: "confirmed" }
    );
    this.program = new Program(idl as any, provider);
  }

  // ===========================================================================
  // Pool State
  // ===========================================================================

  /**
   * Fetch pool state from on-chain account
   *
   * @param poolAddress - The pool PDA address
   * @returns Pool state
   */
  async fetchPool(poolAddress: PublicKey): Promise<PoolState> {
    this.logger.debug(`Fetching pool state: ${poolAddress.toBase58()}`);

    try {
      // Use 'any' cast since we're loading IDL dynamically
      const account = await (this.program.account as any).pool.fetch(poolAddress);

      return {
        admin: account.admin as PublicKey,
        botWallet: account.botWallet as PublicKey,
        depositMint: account.depositMint as PublicKey,
        shareMint: account.shareMint as PublicKey,
        vault: account.vault as PublicKey,
        treasury: account.treasury as PublicKey,
        stakingRewardsVault: account.stakingRewardsVault as PublicKey,
        totalDeposits: account.totalDeposits as BN,
        totalShares: account.totalShares as BN,
        totalProfit: account.totalProfit as BN,
        totalLiquidations: account.totalLiquidations as BN,
        depositorFeeBps: account.depositorFeeBps as number,
        stakingFeeBps: account.stakingFeeBps as number,
        treasuryFeeBps: account.treasuryFeeBps as number,
        isPaused: account.isPaused as boolean,
        maxPoolSize: account.maxPoolSize as BN,
      };
    } catch (error) {
      this.logger.error("Failed to fetch pool state", error);
      throw error;
    }
  }

  // ===========================================================================
  // Authorization
  // ===========================================================================

  /**
   * Check if a wallet is authorized as the bot for this pool
   *
   * @param poolAddress - The pool PDA address
   * @param walletPubkey - The wallet to check
   * @returns True if wallet matches pool.bot_wallet
   */
  async isBotAuthorized(
    poolAddress: PublicKey,
    walletPubkey: PublicKey
  ): Promise<boolean> {
    try {
      const pool = await this.fetchPool(poolAddress);
      return pool.botWallet.equals(walletPubkey);
    } catch (error) {
      this.logger.error("Failed to check bot authorization", error);
      return false;
    }
  }

  // ===========================================================================
  // Pool Metrics
  // ===========================================================================

  /**
   * Get pool TVL in deposit tokens
   */
  async getPoolTvl(poolAddress: PublicKey): Promise<BN> {
    const pool = await this.fetchPool(poolAddress);
    return pool.totalDeposits;
  }

  /**
   * Get current share price (deposit tokens per share)
   *
   * @returns Share price with 6 decimal precision (1_000_000 = 1.0)
   */
  async getSharePrice(poolAddress: PublicKey): Promise<number> {
    const pool = await this.fetchPool(poolAddress);

    if (pool.totalShares.isZero()) {
      return 1_000_000; // 1.0 if no shares minted
    }

    // price = total_deposits / total_shares (with 6 decimal precision)
    return pool.totalDeposits
      .mul(new BN(1_000_000))
      .div(pool.totalShares)
      .toNumber();
  }

  /**
   * Check if pool is paused
   */
  async isPoolPaused(poolAddress: PublicKey): Promise<boolean> {
    const pool = await this.fetchPool(poolAddress);
    return pool.isPaused;
  }

  /**
   * Get pool statistics for logging
   */
  async getPoolStats(poolAddress: PublicKey): Promise<{
    tvl: string;
    totalProfit: string;
    totalLiquidations: number;
    sharePrice: string;
    isPaused: boolean;
  }> {
    const pool = await this.fetchPool(poolAddress);
    const sharePrice = await this.getSharePrice(poolAddress);

    return {
      tvl: `${(pool.totalDeposits.toNumber() / 1_000_000).toFixed(2)} USDC`,
      totalProfit: `${(pool.totalProfit.toNumber() / 1_000_000).toFixed(2)} USDC`,
      totalLiquidations: pool.totalLiquidations.toNumber(),
      sharePrice: `${(sharePrice / 1_000_000).toFixed(6)}`,
      isPaused: pool.isPaused,
    };
  }
}

export default VultrClient;
