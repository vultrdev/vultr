// =============================================================================
// VLTR Staking Constants
// =============================================================================

// PDA Seeds
pub const STAKING_POOL_SEED: &[u8] = b"staking_pool";
pub const STAKE_VAULT_SEED: &[u8] = b"stake_vault";
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";
pub const STAKER_SEED: &[u8] = b"staker";

// Precision for reward calculations (18 decimals)
// Using u128 to handle large numbers without overflow
pub const REWARD_PRECISION: u128 = 1_000_000_000_000_000_000; // 10^18

// Token decimals
pub const VLTR_DECIMALS: u8 = 6;
pub const USDC_DECIMALS: u8 = 6;

// Safety limits
pub const MIN_STAKE_AMOUNT: u64 = 1_000_000; // 1 VLTR (6 decimals)
pub const MAX_STAKE_AMOUNT: u64 = 100_000_000_000_000; // 100M VLTR
pub const MIN_DISTRIBUTE_AMOUNT: u64 = 1_000; // 0.001 USDC minimum distribution

// =============================================================================
// SECURITY FIX-16: Reward distribution cap to prevent overflow edge cases
// =============================================================================
// Maximum rewards that can be distributed in a single transaction
// Set to 10M USDC to prevent potential overflow in reward calculations
// while still allowing for substantial reward distributions
pub const MAX_REWARD_PER_DISTRIBUTION: u64 = 10_000_000_000_000; // 10M USDC (6 decimals)
