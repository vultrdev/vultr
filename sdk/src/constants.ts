// =============================================================================
// VULTR SDK Constants
// =============================================================================
// These constants match the on-chain program constants exactly.
// Keep in sync with programs/vultr/src/constants.rs
// =============================================================================

import { PublicKey } from "@solana/web3.js";

// =============================================================================
// Program ID
// =============================================================================

/**
 * The VULTR program ID on devnet/mainnet
 * Update this when deploying to a new cluster
 */
export const VULTR_PROGRAM_ID = new PublicKey(
  "7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe"
);

// =============================================================================
// PDA Seeds
// =============================================================================

/** Seed for Pool PDA: ["pool", deposit_mint] */
export const POOL_SEED = Buffer.from("pool");

/** Seed for Vault PDA: ["vault", pool] */
export const VAULT_SEED = Buffer.from("vault");

/** Seed for Share Mint PDA: ["share_mint", pool] */
export const SHARE_MINT_SEED = Buffer.from("share_mint");

/** Seed for Depositor PDA: ["depositor", pool, owner] */
export const DEPOSITOR_SEED = Buffer.from("depositor");

// Note: Operator PDAs removed in simplified design
// Note: Protocol fee vault is now an external treasury account, not a PDA

// =============================================================================
// Fee Configuration (in basis points, 1 bps = 0.01%)
// =============================================================================

/** Depositor fee: 80% (8000 bps) - goes to vault, increases share price */
export const DEPOSITOR_FEE_BPS = 8000;

/** Staking fee: 15% (1500 bps) - goes to VLTR stakers */
export const STAKING_FEE_BPS = 1500;

/** Treasury fee: 5% (500 bps) - goes to protocol treasury */
export const TREASURY_FEE_BPS = 500;

/** Total must equal 10000 (100%) */
export const BPS_DENOMINATOR = 10000;

// =============================================================================
// Limits
// =============================================================================

/** Minimum deposit amount: 1 USDC (1_000_000 with 6 decimals) */
export const MIN_DEPOSIT_AMOUNT = 1_000_000n;

/** Maximum single deposit: 100M USDC */
export const MAX_DEPOSIT_AMOUNT = 100_000_000_000_000n;

/** Maximum pool size: 1B USDC */
export const MAX_POOL_SIZE = 1_000_000_000_000_000n;

/** Share token decimals (same as USDC for simplicity) */
export const SHARE_DECIMALS = 6;

// =============================================================================
// Common Token Mints
// =============================================================================

/** USDC mint on mainnet */
export const USDC_MINT_MAINNET = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

/** USDC mint on devnet (test USDC with mint authority for testing) */
export const USDC_MINT_DEVNET = new PublicKey(
  "A1Y8wecoidpqZBS7hhohtACkBoQyLudnJGCVGkvKJ4FX"
);
