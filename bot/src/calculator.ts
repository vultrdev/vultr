// =============================================================================
// Liquidation Calculator
// =============================================================================
// Calculates profitability of liquidation opportunities and ranks them
// by priority score.
// =============================================================================

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import {
  BotConfig,
  LendingPosition,
  LiquidationOpportunity,
  AssetPosition,
} from "./types";
import { MarginfiClient } from "./marginfi";
import { PythOracleClient } from "./oracle";
import { Logger } from "./logger";

// =============================================================================
// Constants
// =============================================================================

// Gas cost estimates in lamports
const BASE_TX_COST_LAMPORTS = 5000; // Base transaction fee
const CU_PER_LIQUIDATION = 400000; // Compute units for liquidation
const LAMPORTS_PER_CU = 0.000001; // Micro-lamports per CU at priority

// Swap slippage tolerance
const SWAP_SLIPPAGE_BPS = 50; // 0.5%

// SOL price for gas cost estimation (fallback only)
// Primary source is Pyth oracle client
const DEFAULT_SOL_PRICE_USD = 100;

// SOL mint address for price fetching
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// =============================================================================
// Liquidation Calculator
// =============================================================================

/**
 * Calculator for evaluating liquidation opportunities
 */
export class LiquidationCalculator {
  private config: BotConfig;
  private marginfi: MarginfiClient;
  private oracle: PythOracleClient;
  private logger: Logger;
  private cachedSolPrice: number | null = null;
  private cachedSolPriceTimestamp: number = 0;
  private readonly PRICE_CACHE_TTL_MS = 5000; // 5 seconds

  constructor(
    config: BotConfig,
    marginfi: MarginfiClient,
    oracle: PythOracleClient,
    logger?: Logger
  ) {
    this.config = config;
    this.marginfi = marginfi;
    this.oracle = oracle;
    this.logger = logger || new Logger("Calculator");
  }

  // ===========================================================================
  // Opportunity Evaluation
  // ===========================================================================

  /**
   * Evaluate a lending position for liquidation profitability
   *
   * @param position - The lending position to evaluate
   * @returns Liquidation opportunity with profitability analysis
   */
  async evaluatePosition(
    position: LendingPosition
  ): Promise<LiquidationOpportunity> {
    this.logger.debug(`Evaluating position ${position.accountAddress.toBase58()}`);

    // Find best collateral to seize and debt to repay
    const { collateral, debt } = this.selectLiquidationPair(position);

    if (!collateral || !debt) {
      return this.createInvalidOpportunity(
        position,
        "No valid collateral/debt pair found"
      );
    }

    // Calculate maximum liquidation amount
    const maxLiquidationAmount = this.marginfi.calculateMaxLiquidation(position);

    // Get liquidation bonus
    const liquidationBonus = this.marginfi.getLiquidationBonus(collateral.mint);

    // Calculate gross profit
    const { grossProfit, grossProfitUsd } = this.calculateGrossProfit(
      debt,
      collateral,
      maxLiquidationAmount,
      liquidationBonus
    );

    // Estimate gas costs
    const estimatedGasCost = this.estimateGasCost();

    // Fetch live SOL price for accurate gas cost calculation
    const solPrice = await this.getSolPrice();

    // Calculate net profit using live SOL price
    const netProfit = this.calculateNetProfit(grossProfit, estimatedGasCost, solPrice);
    const netProfitUsd = this.calculateNetProfitUsd(
      grossProfitUsd,
      estimatedGasCost,
      solPrice
    );

    // Calculate profit in basis points
    const profitBps = this.calculateProfitBps(netProfitUsd, debt.valueUsd);

    // Check if opportunity meets minimum profit threshold
    const isValid = this.isOpportunityValid(profitBps, position);

    // Calculate priority score
    const priorityScore = this.calculatePriorityScore(
      netProfitUsd,
      profitBps,
      position.healthFactor,
      maxLiquidationAmount
    );

    return {
      position,
      estimatedProfit: grossProfit,
      estimatedProfitUsd: grossProfitUsd,
      estimatedGasCost,
      netProfit,
      netProfitUsd,
      profitBps,
      collateralToSeize: collateral,
      debtToRepay: debt,
      maxLiquidationAmount,
      priorityScore,
      isValid,
      invalidReason: isValid ? undefined : this.getInvalidReason(profitBps, position),
    };
  }

  /**
   * Evaluate multiple positions and return sorted opportunities
   *
   * @param positions - Array of lending positions
   * @returns Sorted array of opportunities (highest priority first)
   */
  async evaluatePositions(
    positions: LendingPosition[]
  ): Promise<LiquidationOpportunity[]> {
    const opportunities: LiquidationOpportunity[] = [];

    for (const position of positions) {
      const opportunity = await this.evaluatePosition(position);
      opportunities.push(opportunity);
    }

    // Sort by priority score (highest first)
    return opportunities.sort((a, b) => b.priorityScore - a.priorityScore);
  }

  /**
   * Filter opportunities to only valid ones
   */
  filterValidOpportunities(
    opportunities: LiquidationOpportunity[]
  ): LiquidationOpportunity[] {
    return opportunities.filter((o) => o.isValid);
  }

  // ===========================================================================
  // Profit Calculations
  // ===========================================================================

  /**
   * Select the best collateral/debt pair for liquidation
   *
   * Strategy: Choose the debt with highest value and collateral with
   * highest liquidation bonus
   */
  private selectLiquidationPair(position: LendingPosition): {
    collateral: AssetPosition | null;
    debt: AssetPosition | null;
  } {
    if (position.borrows.length === 0 || position.collaterals.length === 0) {
      return { collateral: null, debt: null };
    }

    // Select debt to repay (highest value)
    const debt = position.borrows.reduce((max, b) =>
      b.valueUsd > max.valueUsd ? b : max
    );

    // Select collateral to seize (highest value with bonus consideration)
    const collateral = position.collaterals.reduce((best, c) => {
      const bonus = this.marginfi.getLiquidationBonus(c.mint);
      const score = c.valueUsd * (1 + bonus);
      const bestBonus = this.marginfi.getLiquidationBonus(best.mint);
      const bestScore = best.valueUsd * (1 + bestBonus);
      return score > bestScore ? c : best;
    });

    return { collateral, debt };
  }

  /**
   * Calculate gross profit from liquidation
   *
   * Gross Profit = (Collateral Seized × (1 + Bonus)) - Debt Repaid
   */
  private calculateGrossProfit(
    debt: AssetPosition,
    collateral: AssetPosition,
    maxLiquidationAmount: BN,
    liquidationBonus: number
  ): { grossProfit: BN; grossProfitUsd: number } {
    // Value of debt being repaid
    const debtValueUsd = Math.min(
      debt.valueUsd * 0.5, // Max 50% close factor
      maxLiquidationAmount.toNumber() / Math.pow(10, debt.decimals) * debt.priceUsd
    );

    // Value of collateral received (including bonus)
    const collateralReceivedUsd = debtValueUsd * (1 + liquidationBonus);

    // Gross profit in USD
    const grossProfitUsd = collateralReceivedUsd - debtValueUsd;

    // Convert to deposit token (assuming USDC with 6 decimals)
    const grossProfit = new BN(Math.floor(grossProfitUsd * 1e6));

    return { grossProfit, grossProfitUsd };
  }

  /**
   * Estimate total gas cost for liquidation
   */
  private estimateGasCost(): number {
    let totalCost = BASE_TX_COST_LAMPORTS;

    // Add compute unit cost
    totalCost += CU_PER_LIQUIDATION * LAMPORTS_PER_CU;

    // Add Jito tip if enabled
    if (this.config.useJito) {
      totalCost += this.config.jitoTipLamports;
    }

    return totalCost;
  }

  /**
   * Fetch live SOL price from Pyth oracle with caching
   */
  private async getSolPrice(): Promise<number> {
    // Check cache first
    const now = Date.now();
    if (
      this.cachedSolPrice !== null &&
      now - this.cachedSolPriceTimestamp < this.PRICE_CACHE_TTL_MS
    ) {
      return this.cachedSolPrice;
    }

    try {
      const priceData = await this.oracle.fetchPrice(SOL_MINT);
      if (priceData && priceData.priceUsd > 0) {
        this.cachedSolPrice = priceData.priceUsd;
        this.cachedSolPriceTimestamp = now;
        this.logger.debug(`Fetched SOL price: $${priceData.priceUsd.toFixed(2)}`);
        return priceData.priceUsd;
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch SOL price from oracle: ${error}`);
    }

    // Fallback to default price
    this.logger.debug(`Using default SOL price: $${DEFAULT_SOL_PRICE_USD}`);
    return DEFAULT_SOL_PRICE_USD;
  }

  /**
   * Calculate net profit after gas costs
   *
   * @param grossProfit - Gross profit in deposit tokens
   * @param gasCostLamports - Gas cost in lamports
   * @param solPriceUsd - SOL price in USD (optional, uses default if not provided)
   */
  private calculateNetProfit(
    grossProfit: BN,
    gasCostLamports: number,
    solPriceUsd: number = DEFAULT_SOL_PRICE_USD
  ): BN {
    // Convert gas cost from lamports to USD, then to USDC base units
    const gasCostUsd = (gasCostLamports / 1e9) * solPriceUsd;
    const gasCostUsdc = new BN(Math.floor(gasCostUsd * 1e6));

    return grossProfit.sub(gasCostUsdc);
  }

  /**
   * Calculate net profit in USD
   *
   * @param grossProfitUsd - Gross profit in USD
   * @param gasCostLamports - Gas cost in lamports
   * @param solPriceUsd - SOL price in USD (optional, uses default if not provided)
   */
  private calculateNetProfitUsd(
    grossProfitUsd: number,
    gasCostLamports: number,
    solPriceUsd: number = DEFAULT_SOL_PRICE_USD
  ): number {
    const gasCostUsd = (gasCostLamports / 1e9) * solPriceUsd;
    return grossProfitUsd - gasCostUsd;
  }

  /**
   * Calculate profit as basis points of liquidation value
   */
  private calculateProfitBps(netProfitUsd: number, debtValueUsd: number): number {
    if (debtValueUsd === 0) return 0;
    return Math.floor((netProfitUsd / debtValueUsd) * 10000);
  }

  // ===========================================================================
  // Validation & Priority
  // ===========================================================================

  /**
   * Check if opportunity meets minimum requirements
   */
  private isOpportunityValid(
    profitBps: number,
    position: LendingPosition
  ): boolean {
    // Must meet minimum profit threshold
    if (profitBps < this.config.minProfitBps) {
      return false;
    }

    // Must be liquidatable (health < 1)
    if (position.healthFactor >= 1) {
      return false;
    }

    // Must not exceed max position size
    const positionSizeUsd = position.borrowedValueUsd;
    const maxSizeUsd = this.config.maxPositionSize.toNumber() / 1e6;
    if (positionSizeUsd > maxSizeUsd) {
      return false;
    }

    return true;
  }

  /**
   * Get reason why opportunity is invalid
   */
  private getInvalidReason(
    profitBps: number,
    position: LendingPosition
  ): string {
    if (position.healthFactor >= 1) {
      return `Health factor ${position.healthFactor.toFixed(3)} >= 1 (not liquidatable)`;
    }

    if (profitBps < this.config.minProfitBps) {
      return `Profit ${profitBps}bps < minimum ${this.config.minProfitBps}bps`;
    }

    const positionSizeUsd = position.borrowedValueUsd;
    const maxSizeUsd = this.config.maxPositionSize.toNumber() / 1e6;
    if (positionSizeUsd > maxSizeUsd) {
      return `Position $${positionSizeUsd.toFixed(2)} > max $${maxSizeUsd.toFixed(2)}`;
    }

    return "Unknown";
  }

  /**
   * Calculate priority score for ordering opportunities
   *
   * Higher score = better opportunity
   * Factors:
   * - Net profit (higher is better)
   * - Profit percentage (higher is better)
   * - Health factor (lower is better - more urgent)
   * - Size (moderate size preferred)
   */
  private calculatePriorityScore(
    netProfitUsd: number,
    profitBps: number,
    healthFactor: number,
    maxLiquidationAmount: BN
  ): number {
    // Base score from net profit
    let score = netProfitUsd * 100;

    // Bonus for high profit percentage
    score += profitBps * 10;

    // Urgency bonus for lower health factor
    const urgencyMultiplier = Math.max(0, 1 - healthFactor) * 2;
    score *= 1 + urgencyMultiplier;

    // Size penalty for very large positions (harder to execute)
    const sizeUsd = maxLiquidationAmount.toNumber() / 1e6;
    if (sizeUsd > 100000) {
      score *= 0.8;
    }

    return Math.floor(score);
  }

  /**
   * Create an invalid opportunity object
   */
  private createInvalidOpportunity(
    position: LendingPosition,
    reason: string
  ): LiquidationOpportunity {
    const emptyAsset: AssetPosition = {
      mint: PublicKey.default,
      symbol: "UNKNOWN",
      amount: new BN(0),
      amountUi: 0,
      valueUsd: 0,
      priceUsd: 0,
      decimals: 0,
    };

    return {
      position,
      estimatedProfit: new BN(0),
      estimatedProfitUsd: 0,
      estimatedGasCost: 0,
      netProfit: new BN(0),
      netProfitUsd: 0,
      profitBps: 0,
      collateralToSeize: emptyAsset,
      debtToRepay: emptyAsset,
      maxLiquidationAmount: new BN(0),
      priorityScore: 0,
      isValid: false,
      invalidReason: reason,
    };
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format an opportunity for logging
 */
export function formatOpportunity(opp: LiquidationOpportunity): string {
  const lines = [
    `Position: ${opp.position.accountAddress.toBase58().slice(0, 8)}...`,
    `  Health Factor: ${opp.position.healthFactor.toFixed(4)}`,
    `  Debt: $${opp.debtToRepay.valueUsd.toFixed(2)} ${opp.debtToRepay.symbol}`,
    `  Collateral: $${opp.collateralToSeize.valueUsd.toFixed(2)} ${opp.collateralToSeize.symbol}`,
    `  Est. Profit: $${opp.estimatedProfitUsd.toFixed(2)} (${opp.profitBps}bps)`,
    `  Net Profit: $${opp.netProfitUsd.toFixed(2)}`,
    `  Priority: ${opp.priorityScore}`,
    `  Valid: ${opp.isValid}${opp.invalidReason ? ` (${opp.invalidReason})` : ""}`,
  ];

  return lines.join("\n");
}
