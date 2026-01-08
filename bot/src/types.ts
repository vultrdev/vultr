// =============================================================================
// VULTR Bot Type Definitions
// =============================================================================

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Bot configuration loaded from environment
 */
export interface BotConfig {
  /** Solana RPC endpoint URL */
  rpcUrl: string;
  /** WebSocket endpoint for subscriptions */
  wsUrl: string;
  /** Path to bot wallet keypair file */
  walletPath: string;
  /** VULTR program ID */
  vultrProgramId: PublicKey;
  /** Pool address (the deployed Pool PDA) */
  poolAddress: PublicKey;
  /** Deposit mint (e.g., USDC) */
  depositMint: PublicKey;
  /** Minimum profit threshold in basis points (e.g., 50 = 0.5%) */
  minProfitBps: number;
  /** Maximum position size to liquidate (in deposit tokens) */
  maxPositionSize: BN;
  /** Polling interval in milliseconds */
  pollIntervalMs: number;
  /** Whether to use Jito bundles for MEV protection */
  useJito: boolean;
  /** Jito tip amount in lamports */
  jitoTipLamports: number;
  /** Jito block engine URL */
  jitoBlockEngineUrl: string;
  /** Dry run mode (simulate but don't execute) */
  dryRun: boolean;
  /** Log level */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Minimum time between RPC calls in milliseconds (rate limiting) */
  rpcRateLimitMs: number;
  /** Maximum number of retry attempts for RPC calls */
  rpcMaxRetries: number;
  /** Initial backoff delay for retries in milliseconds */
  rpcBackoffMs: number;
  /** Maximum retry attempts for transaction confirmations */
  txConfirmMaxRetries: number;
  /** Timeout for transaction confirmations in milliseconds */
  txConfirmTimeoutMs: number;
  /** Staking program ID (for auto-distribute) */
  stakingProgramId?: PublicKey;
  /** VLTR token mint (for staking) */
  vltrMint?: PublicKey;
  /** Whether to auto-distribute staking rewards after record_profit */
  autoDistributeStakingRewards: boolean;
}

// =============================================================================
// Lending Protocol Types
// =============================================================================

/**
 * Supported lending protocols
 */
export enum LendingProtocol {
  Marginfi = "marginfi",
  Kamino = "kamino",
  Solend = "solend",
}

/**
 * Marginfi-specific account references for liquidation
 */
export interface MarginfiAccounts {
  /** Marginfi group (protocol config) */
  marginfiGroup: PublicKey;
  /** Asset bank (collateral) */
  assetBank: PublicKey;
  /** Liability bank (debt) */
  liabBank: PublicKey;
  /** Asset bank liquidity vault */
  assetBankLiquidityVault: PublicKey;
  /** Liability bank liquidity vault */
  liabBankLiquidityVault: PublicKey;
  /** Insurance vault */
  insuranceVault: PublicKey;
  /** Insurance vault authority */
  insuranceVaultAuthority: PublicKey;
  /** Asset bank oracle (price feed) */
  assetBankOracle: PublicKey;
  /** Liability bank oracle (price feed) */
  liabBankOracle: PublicKey;
}

/**
 * A lending position that can potentially be liquidated
 */
export interface LendingPosition {
  /** Protocol this position is on */
  protocol: LendingProtocol;
  /** User account / margin account address */
  accountAddress: PublicKey;
  /** Owner of the position */
  owner: PublicKey;
  /** Total borrowed value in USD */
  borrowedValueUsd: number;
  /** Total collateral value in USD */
  collateralValueUsd: number;
  /** Current health factor (< 1 means liquidatable) */
  healthFactor: number;
  /** Loan-to-value ratio */
  ltv: number;
  /** Liquidation threshold LTV */
  liquidationThreshold: number;
  /** List of borrowed assets */
  borrows: AssetPosition[];
  /** List of collateral assets */
  collaterals: AssetPosition[];
  /** Timestamp when this position was fetched */
  fetchedAt: number;
  /** Marginfi-specific accounts (if protocol is Marginfi) */
  marginfiAccounts?: MarginfiAccounts;
}

/**
 * An individual asset position (borrow or collateral)
 */
export interface AssetPosition {
  /** Token mint */
  mint: PublicKey;
  /** Token symbol (e.g., "USDC") */
  symbol: string;
  /** Amount in native units */
  amount: BN;
  /** Amount in decimals */
  amountUi: number;
  /** Value in USD */
  valueUsd: number;
  /** Token price in USD */
  priceUsd: number;
  /** Token decimals */
  decimals: number;
}

// =============================================================================
// Liquidation Types
// =============================================================================

/**
 * A liquidation opportunity that has been analyzed for profitability
 */
export interface LiquidationOpportunity {
  /** The position to liquidate */
  position: LendingPosition;
  /** Estimated gross profit in deposit tokens */
  estimatedProfit: BN;
  /** Estimated gross profit in USD */
  estimatedProfitUsd: number;
  /** Estimated gas cost in lamports */
  estimatedGasCost: number;
  /** Net profit after gas in deposit tokens */
  netProfit: BN;
  /** Net profit in USD */
  netProfitUsd: number;
  /** Profit as percentage of liquidation value */
  profitBps: number;
  /** The collateral asset to seize */
  collateralToSeize: AssetPosition;
  /** The debt asset to repay */
  debtToRepay: AssetPosition;
  /** Maximum amount that can be liquidated */
  maxLiquidationAmount: BN;
  /** Priority score for ordering (higher = better) */
  priorityScore: number;
  /** Whether this opportunity is still valid */
  isValid: boolean;
  /** Reason if invalid */
  invalidReason?: string;
}

/**
 * Result of a liquidation attempt
 */
export interface LiquidationResult {
  /** Whether the liquidation succeeded */
  success: boolean;
  /** Transaction signature (if successful) */
  signature?: string;
  /** Error message (if failed) */
  error?: string;
  /** Actual profit realized */
  actualProfit?: BN;
  /** Gas cost paid */
  gasCost?: number;
  /** Time taken in milliseconds */
  executionTimeMs: number;
  /** The opportunity that was executed */
  opportunity: LiquidationOpportunity;
}

// =============================================================================
// Oracle Types
// =============================================================================

/**
 * Price data for a token
 */
export interface TokenPrice {
  /** Token mint */
  mint: PublicKey;
  /** Price in USD */
  priceUsd: number;
  /** Price confidence interval */
  confidence: number;
  /** Timestamp of the price */
  timestamp: number;
  /** Source of the price (e.g., "pyth", "switchboard") */
  source: string;
}

// =============================================================================
// Bot State Types
// =============================================================================

/**
 * Current state of the bot
 */
export interface BotState {
  /** Whether the bot is running */
  isRunning: boolean;
  /** When the bot started */
  startedAt: number;
  /** Total positions scanned */
  positionsScanned: number;
  /** Total liquidations attempted */
  liquidationsAttempted: number;
  /** Total successful liquidations */
  liquidationsSuccessful: number;
  /** Total profit earned (in deposit tokens) */
  totalProfit: BN;
  /** Total gas spent (in lamports) */
  totalGasSpent: number;
  /** Last error encountered */
  lastError?: string;
  /** Last successful liquidation timestamp */
  lastLiquidationAt?: number;
  /** Current operator balance */
  operatorBalance: BN;
  /** Current pool TVL */
  poolTvl: BN;
}

/**
 * Bot performance metrics
 */
export interface BotMetrics {
  /** Average profit per liquidation */
  avgProfitPerLiquidation: number;
  /** Success rate (successful / attempted) */
  successRate: number;
  /** Average execution time in ms */
  avgExecutionTimeMs: number;
  /** Profit per hour */
  profitPerHour: number;
  /** Liquidations per hour */
  liquidationsPerHour: number;
  /** Uptime in seconds */
  uptimeSeconds: number;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Events emitted by the bot
 */
export type BotEvent =
  | { type: "started"; timestamp: number }
  | { type: "stopped"; timestamp: number; reason: string }
  | { type: "position_found"; position: LendingPosition }
  | { type: "opportunity_found"; opportunity: LiquidationOpportunity }
  | { type: "liquidation_attempted"; opportunity: LiquidationOpportunity }
  | { type: "liquidation_success"; result: LiquidationResult }
  | { type: "liquidation_failed"; result: LiquidationResult }
  | { type: "error"; error: Error; context: string };

/**
 * Event handler function
 */
export type BotEventHandler = (event: BotEvent) => void;

// =============================================================================
// VULTR Pool Types
// =============================================================================

/**
 * Pool state from on-chain VULTR Pool account
 */
export interface PoolState {
  /** Pool admin (can pause/update settings) */
  admin: PublicKey;
  /** Authorized bot wallet (can call record_profit) */
  botWallet: PublicKey;
  /** Deposit token mint (e.g., USDC) */
  depositMint: PublicKey;
  /** Share token mint (sVLTR) */
  shareMint: PublicKey;
  /** Pool vault holding deposits */
  vault: PublicKey;
  /** Treasury account (receives 5%) */
  treasury: PublicKey;
  /** Staking rewards vault (receives 15%) */
  stakingRewardsVault: PublicKey;
  /** Total deposit tokens in vault */
  totalDeposits: BN;
  /** Total share tokens minted */
  totalShares: BN;
  /** Total profit generated (cumulative) */
  totalProfit: BN;
  /** Total liquidations executed */
  totalLiquidations: BN;
  /** Depositor fee share (8000 = 80%) */
  depositorFeeBps: number;
  /** Staking fee share (1500 = 15%) */
  stakingFeeBps: number;
  /** Treasury fee share (500 = 5%) */
  treasuryFeeBps: number;
  /** Whether pool is paused */
  isPaused: boolean;
  /** Maximum pool size */
  maxPoolSize: BN;
}

/**
 * Stuck collateral tracking (for error recovery)
 * When Marginfi liquidation succeeds but Jupiter swap fails
 */
export interface StuckCollateral {
  /** Collateral token mint */
  mint: PublicKey;
  /** Amount of stuck collateral */
  amount: BN;
  /** Timestamp when it got stuck */
  stuckAt: number;
  /** Number of retry attempts */
  retryCount: number;
  /** Error message from last failure */
  lastError: string;
}

// =============================================================================
// Staking Types
// =============================================================================

/**
 * Staking pool state from on-chain VLTR Staking account
 */
export interface StakingPoolState {
  /** Pool admin */
  admin: PublicKey;
  /** VLTR token mint */
  vltrMint: PublicKey;
  /** Reward token mint (USDC) */
  rewardMint: PublicKey;
  /** Vault holding staked VLTR */
  stakeVault: PublicKey;
  /** Vault for reward distribution */
  rewardVault: PublicKey;
  /** Total VLTR staked */
  totalStaked: BN;
  /** Total rewards distributed */
  totalRewardsDistributed: BN;
  /** Reward per token (scaled) */
  rewardPerToken: BN;
  /** Last distribution timestamp */
  lastDistributionTime: number;
  /** Number of stakers */
  stakerCount: number;
  /** Whether pool is paused */
  isPaused: boolean;
}
