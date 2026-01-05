// =============================================================================
// VULTR Protocol Constants
// =============================================================================
// This file contains all the magic numbers and configuration values for the
// VULTR liquidation pool protocol. Keeping them here makes it easy to adjust
// parameters and ensures consistency across the codebase.
// =============================================================================

// =============================================================================
// FEE CONFIGURATION (in basis points - 1 BPS = 0.01%)
// =============================================================================

/// Protocol fee: 5% of liquidation profits go to the protocol treasury
/// This funds development, audits, and operational costs
pub const PROTOCOL_FEE_BPS: u16 = 500;

/// Operator fee: 15% of liquidation profits go to the operator who executed
/// This incentivizes operators to actively seek liquidation opportunities
pub const OPERATOR_FEE_BPS: u16 = 1500;

/// Depositor share: 80% of liquidation profits go to pool depositors
/// This is the main incentive for users to provide capital
pub const DEPOSITOR_SHARE_BPS: u16 = 8000;

/// Total basis points (100%) - used as denominator in fee calculations
/// Example: fee = amount * FEE_BPS / BPS_DENOMINATOR
pub const BPS_DENOMINATOR: u16 = 10000;

// =============================================================================
// STAKING REQUIREMENTS
// =============================================================================

/// Minimum stake required to become an operator (in USDC base units)
/// 10,000 USDC = 10,000 * 10^6 = 10,000,000,000 base units
/// This stake can be slashed if operator misbehaves (future feature)
pub const MIN_OPERATOR_STAKE: u64 = 10_000_000_000;

// =============================================================================
// TOKEN DECIMALS
// =============================================================================

/// USDC has 6 decimal places on Solana
/// 1 USDC = 1,000,000 base units
pub const USDC_DECIMALS: u8 = 6;

/// VLTR share token also uses 6 decimals to match USDC
/// This simplifies share price calculations
pub const SHARE_DECIMALS: u8 = 6;

// =============================================================================
// PDA SEEDS
// =============================================================================
// PDAs (Program Derived Addresses) are special addresses that only this program
// can sign for. We use them to create accounts that are "owned" by the program.
// Seeds are like a recipe for finding the PDA - same seeds = same address.
// =============================================================================

/// Seed for the Pool account PDA
/// Full seed: ["pool", deposit_mint_pubkey]
pub const POOL_SEED: &[u8] = b"pool";

/// Seed for the vault token account PDA (holds deposited USDC)
/// Full seed: ["vault", pool_pubkey]
pub const VAULT_SEED: &[u8] = b"vault";

/// Seed for the share mint PDA (VLTR token mint)
/// Full seed: ["share_mint", pool_pubkey]
pub const SHARE_MINT_SEED: &[u8] = b"share_mint";

/// Seed for Depositor account PDA (tracks individual user deposits)
/// Full seed: ["depositor", pool_pubkey, owner_pubkey]
pub const DEPOSITOR_SEED: &[u8] = b"depositor";

/// Seed for Operator account PDA (tracks registered operators)
/// Full seed: ["operator", pool_pubkey, authority_pubkey]
pub const OPERATOR_SEED: &[u8] = b"operator";

/// Seed for protocol fee vault (accumulates protocol fees)
/// Full seed: ["protocol_fee_vault", pool_pubkey]
pub const PROTOCOL_FEE_VAULT_SEED: &[u8] = b"protocol_fee_vault";

// =============================================================================
// SAFETY LIMITS
// =============================================================================

/// Maximum deposit amount per transaction (100M USDC)
/// Prevents accidents with huge deposits
pub const MAX_DEPOSIT_AMOUNT: u64 = 100_000_000_000_000;

/// Minimum deposit amount (1 USDC)
/// Prevents dust deposits that waste compute
pub const MIN_DEPOSIT_AMOUNT: u64 = 1_000_000;

/// Maximum total pool size (1B USDC)
/// Risk management - don't concentrate too much capital
pub const MAX_POOL_SIZE: u64 = 1_000_000_000_000_000;
