#!/usr/bin/env node
// =============================================================================
// VULTR Liquidation Bot
// =============================================================================
// Main entry point for the VULTR liquidation bot.
//
// Usage:
//   vultr-bot              - Start the bot with default settings
//   vultr-bot --dry-run    - Run in simulation mode
//   vultr-bot --config     - Show current configuration
//   vultr-bot --help       - Show help
// =============================================================================

import { Connection, Keypair } from "@solana/web3.js";
import BN from "bn.js";

import { loadConfig, loadWalletKeypair, printConfig, createExampleEnvFile } from "./config";
import { BotConfig, BotState, LiquidationOpportunity, BotMetrics } from "./types";
import { MarginfiClient, generateMockPositions } from "./marginfi";
import { LiquidationCalculator, formatOpportunity } from "./calculator";
import { LiquidationExecutor } from "./executor";
import {
  Logger,
  formatCurrency,
  formatPercent,
  formatDuration,
  formatLargeNumber,
} from "./logger";

// =============================================================================
// Bot Class
// =============================================================================

/**
 * Main VULTR Liquidation Bot class
 */
class VultrBot {
  private config: BotConfig;
  private connection: Connection;
  private wallet: Keypair;
  private marginfi: MarginfiClient;
  private calculator: LiquidationCalculator;
  private executor: LiquidationExecutor;
  private logger: Logger;
  private state: BotState;
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(config: BotConfig) {
    this.config = config;
    this.logger = new Logger("Bot", config.logLevel);

    // Initialize connection
    this.connection = new Connection(config.rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: config.wsUrl,
    });

    // Load wallet
    const keypairBytes = loadWalletKeypair(config.walletPath);
    this.wallet = Keypair.fromSecretKey(keypairBytes);

    // Initialize state
    this.state = {
      isRunning: false,
      startedAt: 0,
      positionsScanned: 0,
      liquidationsAttempted: 0,
      liquidationsSuccessful: 0,
      totalProfit: new BN(0),
      totalGasSpent: 0,
      operatorBalance: new BN(0),
      poolTvl: new BN(0),
    };

    // Initialize clients
    this.marginfi = new MarginfiClient(
      this.connection,
      this.logger.child("Marginfi")
    );

    this.calculator = new LiquidationCalculator(
      config,
      this.marginfi,
      this.logger.child("Calculator")
    );

    this.executor = new LiquidationExecutor(
      this.connection,
      this.wallet,
      config,
      this.state,
      this.logger.child("Executor")
    );
  }

  // ===========================================================================
  // Bot Lifecycle
  // ===========================================================================

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    this.logger.separator();
    this.logger.info("Starting VULTR Liquidation Bot...");
    this.logger.separator();

    // Print configuration
    printConfig(this.config);

    // Verify setup
    await this.verifySetup();

    // Start main loop
    this.state.isRunning = true;
    this.state.startedAt = Date.now();
    this.isRunning = true;

    this.logger.success("Bot started successfully!");

    // Run first iteration immediately
    await this.runIteration();

    // Set up polling interval
    this.pollInterval = setInterval(
      () => this.runIteration(),
      this.config.pollIntervalMs
    );

    // Handle shutdown signals
    process.on("SIGINT", () => this.stop("SIGINT"));
    process.on("SIGTERM", () => this.stop("SIGTERM"));
  }

  /**
   * Stop the bot
   */
  async stop(reason: string = "manual"): Promise<void> {
    this.logger.info(`Stopping bot (reason: ${reason})...`);

    this.isRunning = false;
    this.state.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Print final stats
    this.printStats();

    this.logger.success("Bot stopped.");
    process.exit(0);
  }

  /**
   * Verify bot setup before starting
   */
  private async verifySetup(): Promise<void> {
    this.logger.info("Verifying setup...");

    // Check wallet balance
    const solBalance = await this.executor.getSolBalance();
    if (solBalance < 0.01 * 1e9) {
      this.logger.warn(
        `Low SOL balance: ${(solBalance / 1e9).toFixed(4)} SOL. ` +
        "You may not have enough for transaction fees."
      );
    } else {
      this.logger.info(`SOL balance: ${(solBalance / 1e9).toFixed(4)} SOL`);
    }

    // Check operator registration
    const isRegistered = await this.executor.isOperatorRegistered();
    if (!isRegistered) {
      this.logger.warn(
        "Operator is not registered with the VULTR pool. " +
        "You must register as an operator before executing liquidations."
      );
    } else {
      this.logger.info("Operator is registered with VULTR pool");
    }

    // Get operator token balance
    const tokenBalance = await this.executor.getOperatorBalance();
    this.state.operatorBalance = tokenBalance;
    this.logger.info(
      `Token balance: ${formatLargeNumber(tokenBalance.toNumber() / 1e6)} USDC`
    );

    // Check connection
    const slot = await this.connection.getSlot();
    this.logger.info(`Connected to cluster, current slot: ${slot}`);
  }

  // ===========================================================================
  // Main Loop
  // ===========================================================================

  /**
   * Run a single iteration of the bot loop
   */
  private async runIteration(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Fetch liquidatable positions
      const positions = await this.fetchPositions();

      if (positions.length === 0) {
        this.logger.debug("No liquidatable positions found");
        return;
      }

      this.state.positionsScanned += positions.length;
      this.logger.info(`Found ${positions.length} liquidatable positions`);

      // Evaluate opportunities
      const opportunities = await this.calculator.evaluatePositions(positions);
      const validOpportunities = this.calculator.filterValidOpportunities(opportunities);

      if (validOpportunities.length === 0) {
        this.logger.debug("No profitable opportunities found");
        return;
      }

      this.logger.info(`Found ${validOpportunities.length} profitable opportunities`);

      // Execute best opportunity
      const best = validOpportunities[0];
      this.logger.info("Best opportunity:\n" + formatOpportunity(best));

      const result = await this.executor.execute(best);

      if (result.success) {
        this.logger.success(
          `Liquidation successful! Profit: ${formatCurrency(result.actualProfit?.toNumber() ?? 0 / 1e6)}`
        );
      } else {
        this.logger.error(`Liquidation failed: ${result.error}`);
      }
    } catch (error) {
      this.logger.error("Error in bot iteration", error);
      this.state.lastError =
        error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Fetch positions from lending protocols
   */
  private async fetchPositions() {
    // In production, fetch from actual marginfi
    // For testing, use mock positions
    if (this.config.dryRun) {
      // Generate random mock positions for testing
      return generateMockPositions(10);
    }

    return await this.marginfi.fetchLiquidatablePositions();
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get bot metrics
   */
  getMetrics(): BotMetrics {
    const uptimeSeconds = (Date.now() - this.state.startedAt) / 1000;
    const uptimeHours = uptimeSeconds / 3600;

    return {
      avgProfitPerLiquidation:
        this.state.liquidationsSuccessful > 0
          ? this.state.totalProfit.toNumber() /
            1e6 /
            this.state.liquidationsSuccessful
          : 0,
      successRate:
        this.state.liquidationsAttempted > 0
          ? this.state.liquidationsSuccessful / this.state.liquidationsAttempted
          : 0,
      avgExecutionTimeMs: 0, // Would need to track this
      profitPerHour:
        uptimeHours > 0 ? this.state.totalProfit.toNumber() / 1e6 / uptimeHours : 0,
      liquidationsPerHour:
        uptimeHours > 0 ? this.state.liquidationsSuccessful / uptimeHours : 0,
      uptimeSeconds,
    };
  }

  /**
   * Print bot statistics
   */
  printStats(): void {
    const metrics = this.getMetrics();

    this.logger.separator();
    this.logger.info("=== Bot Statistics ===");
    this.logger.info(`Uptime: ${formatDuration(metrics.uptimeSeconds * 1000)}`);
    this.logger.info(`Positions Scanned: ${this.state.positionsScanned}`);
    this.logger.info(`Liquidations Attempted: ${this.state.liquidationsAttempted}`);
    this.logger.info(`Liquidations Successful: ${this.state.liquidationsSuccessful}`);
    this.logger.info(`Success Rate: ${formatPercent(metrics.successRate)}`);
    this.logger.info(
      `Total Profit: ${formatCurrency(this.state.totalProfit.toNumber() / 1e6)}`
    );
    this.logger.info(
      `Avg Profit/Liquidation: ${formatCurrency(metrics.avgProfitPerLiquidation)}`
    );
    this.logger.info(`Profit/Hour: ${formatCurrency(metrics.profitPerHour)}`);
    this.logger.info(`Liquidations/Hour: ${metrics.liquidationsPerHour.toFixed(2)}`);
    this.logger.separator();
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle CLI arguments
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("--init")) {
    createExampleEnvFile();
    process.exit(0);
  }

  // Load configuration
  let config: BotConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error("Failed to load configuration:", error);
    console.error("\nRun 'vultr-bot --init' to create an example .env file");
    process.exit(1);
  }

  // Override dry run if specified
  if (args.includes("--dry-run")) {
    config.dryRun = true;
  }

  // Just show config if requested
  if (args.includes("--config")) {
    printConfig(config);
    process.exit(0);
  }

  // Create and start bot
  const bot = new VultrBot(config);
  await bot.start();
}

function printHelp(): void {
  console.log(`
VULTR Liquidation Bot

Usage:
  vultr-bot [options]

Options:
  --help, -h      Show this help message
  --init          Create example .env file
  --config        Show current configuration
  --dry-run       Run in simulation mode (no real transactions)

Environment Variables:
  WALLET_PATH         Path to operator wallet keypair (required)
  RPC_URL             Solana RPC endpoint
  WS_URL              WebSocket endpoint
  VULTR_PROGRAM_ID    VULTR program address
  DEPOSIT_MINT        Deposit token mint (USDC)
  MIN_PROFIT_BPS      Minimum profit threshold (basis points)
  MAX_POSITION_SIZE   Maximum position size to liquidate
  POLL_INTERVAL_MS    Polling interval in milliseconds
  USE_JITO            Use Jito for MEV protection (true/false)
  JITO_TIP_LAMPORTS   Jito tip amount
  DRY_RUN             Simulation mode (true/false)
  LOG_LEVEL           Log verbosity (debug/info/warn/error)

Examples:
  # Start with default settings
  vultr-bot

  # Run in dry-run mode
  vultr-bot --dry-run

  # Initialize configuration
  vultr-bot --init
`);
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
