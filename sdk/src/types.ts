// =============================================================================
// VULTR SDK Type Definitions
// =============================================================================
// TypeScript interfaces matching the on-chain account structures.
// These are used for deserialized account data and instruction parameters.
// =============================================================================

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// =============================================================================
// Account Types
// =============================================================================

/**
 * Pool account state
 * Stores all configuration and state for a VULTR liquidation pool
 *
 * NEW SIMPLIFIED DESIGN:
 * - No external operators - team runs the bot internally
 * - bot_wallet field stores the authorized bot address
 * - staking_rewards_vault receives 15% for VLTR token stakers
 */
export interface Pool {
  /** Pool admin public key */
  admin: PublicKey;
  /** Bot wallet authorized to call record_profit */
  botWallet: PublicKey;
  /** Deposit token mint (e.g., USDC) */
  depositMint: PublicKey;
  /** Share token mint (sVLTR) */
  shareMint: PublicKey;
  /** Vault holding deposited tokens (PDA) */
  vault: PublicKey;
  /** Treasury account for protocol fees (5%) - external account */
  treasury: PublicKey;
  /** Staking rewards vault for VLTR stakers (15%) - external account */
  stakingRewardsVault: PublicKey;

  /** Total deposit tokens in the pool (includes depositor share of profits) */
  totalDeposits: BN;
  /** Total share tokens minted */
  totalShares: BN;
  /** Total profit generated from liquidations (cumulative, for stats) */
  totalProfit: BN;
  /** Total number of liquidations executed */
  totalLiquidations: BN;

  /** Depositor fee in basis points (default: 8000 = 80%) */
  depositorFeeBps: number;
  /** Staking fee in basis points (default: 1500 = 15%) */
  stakingFeeBps: number;
  /** Treasury fee in basis points (default: 500 = 5%) */
  treasuryFeeBps: number;

  /** Whether the pool is paused */
  isPaused: boolean;
  /** Maximum pool size in deposit tokens */
  maxPoolSize: BN;

  /** PDA bumps for efficient derivation */
  bump: number;
  vaultBump: number;
  shareMintBump: number;
}

/**
 * Depositor account state
 * Tracks an individual user's deposits and shares
 */
export interface Depositor {
  /** Pool this depositor belongs to */
  pool: PublicKey;
  /** Owner of this depositor account */
  owner: PublicKey;

  /** Total shares minted to this depositor (cumulative) */
  sharesMinted: BN;
  /** Cumulative amount deposited (lifetime) */
  totalDeposited: BN;
  /** Cumulative amount withdrawn (lifetime) */
  totalWithdrawn: BN;

  /** Number of deposits made */
  depositCount: number;

  /** Timestamp of most recent deposit */
  lastDepositTimestamp: BN;
  /** Timestamp of most recent withdrawal */
  lastWithdrawalTimestamp: BN;

  /** PDA bump */
  bump: number;
}

// Note: Operator accounts removed in simplified design
// Team runs the bot internally via bot_wallet field

// =============================================================================
// Instruction Parameter Types
// =============================================================================

/**
 * Parameters for the deposit instruction
 */
export interface DepositParams {
  /** Amount of deposit tokens to deposit (in base units) */
  amount: BN;
}

/**
 * Parameters for the withdraw instruction
 */
export interface WithdrawParams {
  /** Number of share tokens to burn */
  sharesToBurn: BN;
}

/**
 * Parameters for the record_profit instruction (bot only)
 */
export interface RecordProfitParams {
  /** Total profit amount to distribute */
  profitAmount: BN;
}

/**
 * Parameters for the pause_pool instruction
 */
export interface PausePoolParams {
  /** true to pause, false to unpause */
  paused: boolean;
}

/**
 * Parameters for the update_fees instruction
 */
export interface UpdateFeesParams {
  /** New depositor fee in basis points (default: 8000 = 80%) */
  depositorFeeBps: number;
  /** New staking fee in basis points (default: 1500 = 15%) */
  stakingFeeBps: number;
  /** New treasury fee in basis points (default: 500 = 5%) */
  treasuryFeeBps: number;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of calculating shares to mint for a deposit
 */
export interface ShareCalculation {
  /** Number of shares that will be minted */
  sharesToMint: BN;
  /** Current share price (deposit tokens per share, scaled by 1e6) */
  sharePrice: BN;
  /** Exchange rate description */
  exchangeRate: string;
}

/**
 * Result of calculating withdrawal amount for shares
 */
export interface WithdrawalCalculation {
  /** Amount of deposit tokens that will be received */
  withdrawalAmount: BN;
  /** Current share price (deposit tokens per share, scaled by 1e6) */
  sharePrice: BN;
  /** Exchange rate description */
  exchangeRate: string;
}

/**
 * Fee distribution breakdown
 */
export interface FeeDistribution {
  /** Amount going to depositors (added to vault, increases share price) */
  depositorShare: BN;
  /** Amount going to staking rewards vault (for VLTR stakers) */
  stakingShare: BN;
  /** Amount going to treasury */
  treasuryShare: BN;
  /** Total profit being distributed */
  totalProfit: BN;
}

/**
 * Pool statistics for display
 */
export interface PoolStats {
  /** Total value locked in the pool */
  tvl: BN;
  /** Total shares outstanding */
  totalShares: BN;
  /** Current share price (scaled by 1e6) */
  sharePrice: BN;
  /** Total profit generated (cumulative) */
  totalProfit: BN;
  /** Total number of liquidations */
  totalLiquidations: BN;
  /** APY estimate (requires historical data) */
  estimatedApy?: number;
}

/**
 * User position in a pool
 */
export interface UserPosition {
  /** User's share balance */
  shares: BN;
  /** Current value of shares in deposit tokens */
  value: BN;
  /** Total amount deposited */
  totalDeposited: BN;
  /** Total amount withdrawn */
  totalWithdrawn: BN;
  /** Unrealized profit/loss */
  unrealizedPnl: BN;
  /** Whether user has an active depositor account */
  hasDepositorAccount: boolean;
}
