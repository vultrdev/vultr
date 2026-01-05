// =============================================================================
// VULTR SDK Utility Functions
// =============================================================================
// Helper functions for common operations when working with the VULTR protocol.
// =============================================================================

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import BN from "bn.js";

import { SHARE_DECIMALS, BPS_DENOMINATOR } from "./constants";

// =============================================================================
// Token Amount Formatting
// =============================================================================

/**
 * Convert a raw token amount to a human-readable decimal string
 *
 * @param amount - Raw token amount (BN or bigint or number)
 * @param decimals - Token decimals (default: 6 for USDC)
 * @returns Formatted string with appropriate decimal places
 *
 * @example
 * ```typescript
 * formatTokenAmount(new BN(1_500_000_000), 6) // "1,500.00"
 * ```
 */
export function formatTokenAmount(
  amount: BN | bigint | number,
  decimals: number = 6
): string {
  const amountBn =
    amount instanceof BN ? amount : new BN(amount.toString());
  const divisor = new BN(10).pow(new BN(decimals));

  const wholePart = amountBn.div(divisor);
  const fractionalPart = amountBn.mod(divisor);

  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, "0");

  // Format with commas for thousands
  const wholeFormatted = wholePart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Trim trailing zeros but keep at least 2 decimal places
  let trimmedFractional = fractionalStr.replace(/0+$/, "");
  if (trimmedFractional.length < 2) {
    trimmedFractional = fractionalStr.slice(0, 2);
  }

  return `${wholeFormatted}.${trimmedFractional}`;
}

/**
 * Parse a human-readable token amount to raw units
 *
 * @param amount - Human-readable amount (e.g., "100.50")
 * @param decimals - Token decimals (default: 6 for USDC)
 * @returns Raw token amount as BN
 *
 * @example
 * ```typescript
 * parseTokenAmount("100.50", 6) // BN(100_500_000)
 * ```
 */
export function parseTokenAmount(amount: string, decimals: number = 6): BN {
  // Remove commas and spaces
  const cleanAmount = amount.replace(/[,\s]/g, "");

  // Split into whole and fractional parts
  const [wholePart, fractionalPart = ""] = cleanAmount.split(".");

  // Pad or trim fractional part to match decimals
  const paddedFractional = fractionalPart.padEnd(decimals, "0").slice(0, decimals);

  // Combine and parse
  const rawAmount = `${wholePart}${paddedFractional}`;
  return new BN(rawAmount);
}

/**
 * Format a percentage from basis points
 *
 * @param bps - Basis points (1 bps = 0.01%)
 * @returns Formatted percentage string
 *
 * @example
 * ```typescript
 * formatBps(500) // "5.00%"
 * formatBps(1500) // "15.00%"
 * ```
 */
export function formatBps(bps: number): string {
  const percentage = bps / 100;
  return `${percentage.toFixed(2)}%`;
}

/**
 * Convert a percentage to basis points
 *
 * @param percentage - Percentage (e.g., 5 for 5%)
 * @returns Basis points
 *
 * @example
 * ```typescript
 * percentToBps(5) // 500
 * percentToBps(15.5) // 1550
 * ```
 */
export function percentToBps(percentage: number): number {
  return Math.round(percentage * 100);
}

// =============================================================================
// Share Price Calculations
// =============================================================================

/**
 * Calculate the current share price
 *
 * @param totalDeposits - Total deposits in the pool
 * @param totalProfit - Total profit accumulated
 * @param totalShares - Total shares outstanding
 * @returns Share price scaled by 1e6
 *
 * @example
 * ```typescript
 * const price = calculateSharePrice(
 *   new BN(1_000_000_000_000), // 1M USDC
 *   new BN(100_000_000_000),   // 100K profit
 *   new BN(1_000_000_000_000)  // 1M shares
 * );
 * // Returns BN representing 1.1 (1,100,000 scaled)
 * ```
 */
export function calculateSharePrice(
  totalDeposits: BN,
  totalProfit: BN,
  totalShares: BN
): BN {
  if (totalShares.isZero()) {
    return new BN(1_000_000); // 1.0 scaled
  }

  const totalValue = totalDeposits.add(totalProfit);
  return totalValue.mul(new BN(1_000_000)).div(totalShares);
}

/**
 * Format share price as a human-readable string
 *
 * @param sharePrice - Share price scaled by 1e6
 * @returns Formatted string
 *
 * @example
 * ```typescript
 * formatSharePrice(new BN(1_100_000)) // "1.10"
 * ```
 */
export function formatSharePrice(sharePrice: BN): string {
  const price = sharePrice.toNumber() / 1_000_000;
  return price.toFixed(6);
}

// =============================================================================
// Token Account Helpers
// =============================================================================

/**
 * Get token balance for an account
 *
 * @param connection - Solana connection
 * @param mint - Token mint
 * @param owner - Token account owner
 * @returns Token balance as BN, or zero if account doesn't exist
 */
export async function getTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<BN> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const account = await getAccount(connection, ata);
    return new BN(account.amount.toString());
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      return new BN(0);
    }
    throw error;
  }
}

/**
 * Check if a token account exists
 *
 * @param connection - Solana connection
 * @param mint - Token mint
 * @param owner - Token account owner
 * @returns true if account exists
 */
export async function tokenAccountExists(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<boolean> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    await getAccount(connection, ata);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// APY Calculations
// =============================================================================

/**
 * Calculate APY from profit over a time period
 *
 * @param totalProfit - Total profit earned
 * @param totalDeposits - Average deposits during the period
 * @param periodDays - Number of days in the period
 * @returns APY as a decimal (e.g., 0.15 for 15%)
 *
 * @example
 * ```typescript
 * const apy = calculateApy(
 *   new BN(100_000_000_000), // 100K profit
 *   new BN(1_000_000_000_000), // 1M TVL
 *   30 // 30 days
 * );
 * // Returns ~1.216 (121.6% APY)
 * ```
 */
export function calculateApy(
  totalProfit: BN,
  totalDeposits: BN,
  periodDays: number
): number {
  if (totalDeposits.isZero() || periodDays === 0) {
    return 0;
  }

  // Daily rate = profit / deposits / days
  const profitNum = totalProfit.toNumber();
  const depositsNum = totalDeposits.toNumber();
  const dailyRate = profitNum / depositsNum / periodDays;

  // APY = (1 + daily_rate)^365 - 1
  const apy = Math.pow(1 + dailyRate, 365) - 1;

  return apy;
}

/**
 * Format APY as a percentage string
 *
 * @param apy - APY as decimal
 * @returns Formatted percentage string
 *
 * @example
 * ```typescript
 * formatApy(0.1567) // "15.67%"
 * ```
 */
export function formatApy(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate fee configuration sums to 100%
 *
 * @param protocolFeeBps - Protocol fee in basis points
 * @param operatorFeeBps - Operator fee in basis points
 * @param depositorShareBps - Depositor share in basis points
 * @returns true if valid
 */
export function validateFeeConfig(
  protocolFeeBps: number,
  operatorFeeBps: number,
  depositorShareBps: number
): boolean {
  return protocolFeeBps + operatorFeeBps + depositorShareBps === BPS_DENOMINATOR;
}

/**
 * Check if an amount meets minimum deposit requirement
 *
 * @param amount - Deposit amount
 * @param minDeposit - Minimum deposit (default: 1 USDC = 1_000_000)
 * @returns true if valid
 */
export function isValidDepositAmount(
  amount: BN,
  minDeposit: BN = new BN(1_000_000)
): boolean {
  return amount.gte(minDeposit);
}

/**
 * Check if an amount meets minimum operator stake
 *
 * @param amount - Stake amount
 * @param minStake - Minimum stake (default: 10,000 USDC = 10_000_000_000)
 * @returns true if valid
 */
export function isValidOperatorStake(
  amount: BN,
  minStake: BN = new BN(10_000_000_000)
): boolean {
  return amount.gte(minStake);
}

// =============================================================================
// Time Helpers
// =============================================================================

/**
 * Convert a Solana timestamp to a JavaScript Date
 *
 * @param timestamp - Unix timestamp from Solana (BN)
 * @returns JavaScript Date object
 */
export function timestampToDate(timestamp: BN): Date {
  return new Date(timestamp.toNumber() * 1000);
}

/**
 * Format a timestamp as a relative time string
 *
 * @param timestamp - Unix timestamp (BN)
 * @returns Relative time string (e.g., "5 minutes ago")
 */
export function formatRelativeTime(timestamp: BN): string {
  const now = Date.now();
  const then = timestamp.toNumber() * 1000;
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
}

// =============================================================================
// Debugging Helpers
// =============================================================================

/**
 * Log pool state in a readable format
 *
 * @param pool - Pool data
 */
export function logPoolState(pool: {
  admin: PublicKey;
  totalDeposits: BN;
  totalShares: BN;
  totalProfit: BN;
  operatorCount: number;
  isPaused: boolean;
  protocolFeeBps: number;
  operatorFeeBps: number;
  depositorShareBps: number;
}): void {
  console.log("=== Pool State ===");
  console.log(`Admin: ${pool.admin.toBase58()}`);
  console.log(`Total Deposits: ${formatTokenAmount(pool.totalDeposits)}`);
  console.log(`Total Shares: ${formatTokenAmount(pool.totalShares, SHARE_DECIMALS)}`);
  console.log(`Total Profit: ${formatTokenAmount(pool.totalProfit)}`);
  console.log(`Share Price: ${formatSharePrice(calculateSharePrice(pool.totalDeposits, pool.totalProfit, pool.totalShares))}`);
  console.log(`Operator Count: ${pool.operatorCount}`);
  console.log(`Is Paused: ${pool.isPaused}`);
  console.log(`Fees: Protocol ${formatBps(pool.protocolFeeBps)}, Operator ${formatBps(pool.operatorFeeBps)}, Depositor ${formatBps(pool.depositorShareBps)}`);
  console.log("==================");
}
