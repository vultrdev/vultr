// =============================================================================
// VULTR SDK
// =============================================================================
// TypeScript SDK for interacting with the VULTR Solana liquidation pool protocol.
//
// Quick Start:
// ```typescript
// import { VultrClient, USDC_MINT_DEVNET } from "@vultr/sdk";
// import { Connection, Keypair } from "@solana/web3.js";
// import { Wallet } from "@coral-xyz/anchor";
//
// // Create a client
// const connection = new Connection("https://api.devnet.solana.com");
// const wallet = new Wallet(Keypair.generate());
// const client = new VultrClient({ connection, wallet });
//
// // Get pool stats
// const stats = await client.getPoolStats(USDC_MINT_DEVNET);
// console.log("TVL:", stats.tvl.toString());
//
// // Deposit
// const tx = await client.deposit(USDC_MINT_DEVNET, new BN(1_000_000_000));
// ```
// =============================================================================

// Client
export { VultrClient, VultrClientOptions } from "./client";

// Types
export {
  // Account types
  Pool,
  Depositor,
  // Instruction params
  DepositParams,
  WithdrawParams,
  RecordProfitParams,
  PausePoolParams,
  UpdateFeesParams,
  // Result types
  ShareCalculation,
  WithdrawalCalculation,
  FeeDistribution,
  PoolStats,
  UserPosition,
} from "./types";

// PDA helpers
export {
  PdaResult,
  findPoolPda,
  findVaultPda,
  findShareMintPda,
  findDepositorPda,
  findAllPoolPdas,
  pdaExists,
} from "./pda";

// Constants
export {
  VULTR_PROGRAM_ID,
  POOL_SEED,
  VAULT_SEED,
  SHARE_MINT_SEED,
  DEPOSITOR_SEED,
  DEPOSITOR_FEE_BPS,
  STAKING_FEE_BPS,
  TREASURY_FEE_BPS,
  BPS_DENOMINATOR,
  MIN_DEPOSIT_AMOUNT,
  MAX_DEPOSIT_AMOUNT,
  MAX_POOL_SIZE,
  SHARE_DECIMALS,
  USDC_MINT_MAINNET,
  USDC_MINT_DEVNET,
} from "./constants";

// Utilities
export {
  // Token formatting
  formatTokenAmount,
  parseTokenAmount,
  formatBps,
  percentToBps,
  // Share price
  calculateSharePrice,
  formatSharePrice,
  // Token accounts
  getTokenBalance,
  tokenAccountExists,
  // APY
  calculateApy,
  formatApy,
  // Validation
  validateFeeConfig,
  isValidDepositAmount,
  // Time
  timestampToDate,
  formatRelativeTime,
  // Debugging
  logPoolState,
} from "./utils";

// Re-export commonly used external types for convenience
export { BN } from "bn.js";
export { PublicKey, Connection, Keypair } from "@solana/web3.js";
export { Wallet } from "@coral-xyz/anchor";
