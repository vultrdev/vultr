// =============================================================================
// VULTR Bot Configuration
// =============================================================================
// Loads configuration from environment variables and .env file.
// =============================================================================

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

import { BotConfig } from "./types";

// Load .env file if it exists
dotenv.config();

// =============================================================================
// Default Values
// =============================================================================

const DEFAULTS = {
  RPC_URL: "https://api.mainnet-beta.solana.com",
  WS_URL: "wss://api.mainnet-beta.solana.com",
  VULTR_PROGRAM_ID: "2cTDHuGALYQQQTLai9HLwsvkS7nv6r8JJLgPeMrsRPxm",
  // USDC on mainnet
  DEPOSIT_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  MIN_PROFIT_BPS: 50, // 0.5% minimum profit
  MAX_POSITION_SIZE: "1000000000000", // 1M USDC (6 decimals)
  POLL_INTERVAL_MS: 1000, // 1 second
  USE_JITO: true,
  JITO_TIP_LAMPORTS: 10000, // 0.00001 SOL
  JITO_BLOCK_ENGINE_URL: "https://mainnet.block-engine.jito.wtf",
  DRY_RUN: true,
  LOG_LEVEL: "info" as const,
};

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Load bot configuration from environment variables
 *
 * @returns Validated BotConfig object
 * @throws Error if required configuration is missing
 */
export function loadConfig(): BotConfig {
  // Required: wallet path
  const walletPath = process.env.WALLET_PATH;
  if (!walletPath) {
    throw new Error(
      "WALLET_PATH environment variable is required. " +
        "Set it to the path of your operator wallet keypair JSON file."
    );
  }

  // Validate wallet file exists
  const resolvedWalletPath = path.resolve(walletPath);
  if (!fs.existsSync(resolvedWalletPath)) {
    throw new Error(`Wallet file not found at: ${resolvedWalletPath}`);
  }

  // Parse optional values with defaults
  const config: BotConfig = {
    rpcUrl: process.env.RPC_URL || DEFAULTS.RPC_URL,
    wsUrl: process.env.WS_URL || DEFAULTS.WS_URL,
    walletPath: resolvedWalletPath,
    vultrProgramId: new PublicKey(
      process.env.VULTR_PROGRAM_ID || DEFAULTS.VULTR_PROGRAM_ID
    ),
    depositMint: new PublicKey(
      process.env.DEPOSIT_MINT || DEFAULTS.DEPOSIT_MINT
    ),
    minProfitBps: parseInt(
      process.env.MIN_PROFIT_BPS || String(DEFAULTS.MIN_PROFIT_BPS),
      10
    ),
    maxPositionSize: new BN(
      process.env.MAX_POSITION_SIZE || DEFAULTS.MAX_POSITION_SIZE
    ),
    pollIntervalMs: parseInt(
      process.env.POLL_INTERVAL_MS || String(DEFAULTS.POLL_INTERVAL_MS),
      10
    ),
    useJito: process.env.USE_JITO !== "false",
    jitoTipLamports: parseInt(
      process.env.JITO_TIP_LAMPORTS || String(DEFAULTS.JITO_TIP_LAMPORTS),
      10
    ),
    jitoBlockEngineUrl:
      process.env.JITO_BLOCK_ENGINE_URL || DEFAULTS.JITO_BLOCK_ENGINE_URL,
    dryRun: process.env.DRY_RUN !== "false",
    logLevel: (process.env.LOG_LEVEL as BotConfig["logLevel"]) || DEFAULTS.LOG_LEVEL,
  };

  // Validate configuration
  validateConfig(config);

  return config;
}

/**
 * Validate configuration values
 */
function validateConfig(config: BotConfig): void {
  if (config.minProfitBps < 0 || config.minProfitBps > 10000) {
    throw new Error("MIN_PROFIT_BPS must be between 0 and 10000");
  }

  if (config.pollIntervalMs < 100) {
    throw new Error("POLL_INTERVAL_MS must be at least 100ms");
  }

  if (config.jitoTipLamports < 0) {
    throw new Error("JITO_TIP_LAMPORTS must be non-negative");
  }

  const validLogLevels = ["debug", "info", "warn", "error"];
  if (!validLogLevels.includes(config.logLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${validLogLevels.join(", ")}`);
  }
}

/**
 * Load wallet keypair from file
 *
 * @param walletPath - Path to keypair JSON file
 * @returns Keypair bytes array
 */
export function loadWalletKeypair(walletPath: string): Uint8Array {
  const keypairJson = fs.readFileSync(walletPath, "utf-8");
  const keypairArray = JSON.parse(keypairJson);

  if (!Array.isArray(keypairArray) || keypairArray.length !== 64) {
    throw new Error("Invalid keypair file format. Expected array of 64 bytes.");
  }

  return Uint8Array.from(keypairArray);
}

/**
 * Create example .env file
 */
export function createExampleEnvFile(outputPath: string = ".env.example"): void {
  const content = `# VULTR Liquidation Bot Configuration
# Copy this file to .env and fill in your values

# =============================================================================
# Required
# =============================================================================

# Path to your operator wallet keypair JSON file
WALLET_PATH=/path/to/your/keypair.json

# =============================================================================
# Network Configuration
# =============================================================================

# Solana RPC endpoint (use a private RPC for better performance)
RPC_URL=https://api.mainnet-beta.solana.com

# WebSocket endpoint for real-time updates
WS_URL=wss://api.mainnet-beta.solana.com

# =============================================================================
# VULTR Configuration
# =============================================================================

# VULTR program ID (update if deploying to different address)
VULTR_PROGRAM_ID=2cTDHuGALYQQQTLai9HLwsvkS7nv6r8JJLgPeMrsRPxm

# Deposit token mint (USDC on mainnet)
DEPOSIT_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# =============================================================================
# Liquidation Settings
# =============================================================================

# Minimum profit in basis points (50 = 0.5%)
MIN_PROFIT_BPS=50

# Maximum position size to liquidate (in base units, e.g., 1M USDC = 1000000000000)
MAX_POSITION_SIZE=1000000000000

# Polling interval in milliseconds
POLL_INTERVAL_MS=1000

# =============================================================================
# Jito MEV Protection
# =============================================================================

# Use Jito bundles for MEV protection (true/false)
USE_JITO=true

# Jito tip amount in lamports
JITO_TIP_LAMPORTS=10000

# Jito block engine URL
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf

# =============================================================================
# Operation Mode
# =============================================================================

# Dry run mode - simulate but don't execute (true/false)
DRY_RUN=true

# Log level (debug, info, warn, error)
LOG_LEVEL=info
`;

  fs.writeFileSync(outputPath, content);
  console.log(`Example .env file created at: ${outputPath}`);
}

/**
 * Print current configuration (with sensitive data masked)
 */
export function printConfig(config: BotConfig): void {
  console.log("\n=== Bot Configuration ===");
  console.log(`RPC URL: ${config.rpcUrl}`);
  console.log(`WebSocket URL: ${config.wsUrl}`);
  console.log(`Wallet Path: ${config.walletPath}`);
  console.log(`VULTR Program ID: ${config.vultrProgramId.toBase58()}`);
  console.log(`Deposit Mint: ${config.depositMint.toBase58()}`);
  console.log(`Min Profit: ${config.minProfitBps / 100}%`);
  console.log(`Max Position Size: ${config.maxPositionSize.toString()}`);
  console.log(`Poll Interval: ${config.pollIntervalMs}ms`);
  console.log(`Use Jito: ${config.useJito}`);
  console.log(`Jito Tip: ${config.jitoTipLamports} lamports`);
  console.log(`Dry Run: ${config.dryRun}`);
  console.log(`Log Level: ${config.logLevel}`);
  console.log("=========================\n");
}
