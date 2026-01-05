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
 */
export interface Pool {
  /** Pool admin public key */
  admin: PublicKey;
  /** Deposit token mint (e.g., USDC) */
  depositMint: PublicKey;
  /** Share token mint (VLTR) */
  shareMint: PublicKey;
  /** Vault holding deposited tokens */
  vault: PublicKey;
  /** Vault holding accumulated protocol fees */
  protocolFeeVault: PublicKey;

  /** Total deposit tokens in the pool */
  totalDeposits: BN;
  /** Total share tokens minted */
  totalShares: BN;
  /** Total profit generated from liquidations */
  totalProfit: BN;
  /** Total protocol fees accumulated (in fee vault) */
  accumulatedProtocolFees: BN;

  /** Protocol fee in basis points (default: 500 = 5%) */
  protocolFeeBps: number;
  /** Operator fee in basis points (default: 1500 = 15%) */
  operatorFeeBps: number;
  /** Depositor share in basis points (default: 8000 = 80%) */
  depositorShareBps: number;

  /** Number of registered operators */
  operatorCount: number;
  /** Whether the pool is paused */
  isPaused: boolean;

  /** PDA bumps for efficient derivation */
  bump: number;
  vaultBump: number;
  shareMintBump: number;
  protocolFeeVaultBump: number;
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

  /** Total shares currently held by this depositor */
  sharesMinted: BN;
  /** Cumulative amount deposited (lifetime) */
  totalDeposited: BN;
  /** Cumulative amount withdrawn (lifetime) */
  totalWithdrawn: BN;

  /** Number of deposits made */
  depositCount: number;
  /** Number of withdrawals made */
  withdrawalCount: number;

  /** Timestamp of first deposit */
  firstDepositTimestamp: BN;
  /** Timestamp of most recent deposit */
  lastDepositTimestamp: BN;
  /** Timestamp of most recent withdrawal */
  lastWithdrawalTimestamp: BN;

  /** PDA bump */
  bump: number;
}

/**
 * Operator status enum
 */
export enum OperatorStatus {
  /** Operator is not active (should not happen in practice) */
  Inactive = 0,
  /** Operator is active and can execute liquidations */
  Active = 1,
  /** Operator is in withdrawal cooldown (future feature) */
  Withdrawing = 2,
}

/**
 * Operator account state
 * Tracks a registered liquidation operator
 */
export interface Operator {
  /** Pool this operator belongs to */
  pool: PublicKey;
  /** Authority (wallet) of the operator */
  authority: PublicKey;

  /** Amount staked by this operator */
  stakeAmount: BN;
  /** Total number of liquidations executed */
  totalLiquidations: number;
  /** Total profit generated for the pool */
  totalProfitGenerated: BN;
  /** Total fees earned by this operator */
  totalFeesEarned: BN;

  /** Timestamp of last liquidation */
  lastLiquidationTimestamp: BN;
  /** Timestamp when operator registered */
  registeredAt: BN;

  /** Current operator status */
  status: OperatorStatus;
  /** PDA bump */
  bump: number;
}

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
 * Parameters for the register_operator instruction
 */
export interface RegisterOperatorParams {
  /** Amount to stake (must be >= MIN_OPERATOR_STAKE) */
  stakeAmount: BN;
}

/**
 * Parameters for the execute_liquidation instruction
 */
export interface ExecuteLiquidationParams {
  /** Profit from the liquidation (mock parameter for testing) */
  profit: BN;
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
  /** New protocol fee in basis points */
  protocolFeeBps: number;
  /** New operator fee in basis points */
  operatorFeeBps: number;
  /** New depositor share in basis points */
  depositorShareBps: number;
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
  /** Amount going to protocol fee vault */
  protocolFee: BN;
  /** Amount going to operator */
  operatorFee: BN;
  /** Amount staying in pool for depositors */
  depositorProfit: BN;
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
  /** Current share price */
  sharePrice: BN;
  /** Total profit generated */
  totalProfit: BN;
  /** Number of active operators */
  operatorCount: number;
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
