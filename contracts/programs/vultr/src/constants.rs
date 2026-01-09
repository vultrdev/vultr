// =============================================================================
// VULTR Protocol Constants - NEW SIMPLIFIED DESIGN
// =============================================================================
// This file contains all configuration values for the VULTR protocol.
//
// KEY CHANGES FROM OLD DESIGN:
// - No operator-related constants (MIN_OPERATOR_STAKE, OPERATOR_SEED removed)
// - Staking fee replaces operator fee (15% goes to VLTR token stakers)
// =============================================================================

// =============================================================================
// FEE CONFIGURATION (in basis points - 1 BPS = 0.01%)
// =============================================================================

/// Depositor share: 80% of liquidation profits go to pool depositors
/// This is the main incentive for users to provide capital
pub const DEPOSITOR_FEE_BPS: u16 = 8000;

/// Staking fee: 15% of liquidation profits go to VLTR token stakers
/// This replaces the old operator_fee - goes to staking rewards vault
pub const STAKING_FEE_BPS: u16 = 1500;

/// Treasury fee: 5% of liquidation profits go to the protocol treasury
/// This funds development, audits, and operational costs
pub const TREASURY_FEE_BPS: u16 = 500;

/// Total basis points (100%) - used as denominator in fee calculations
/// Example: fee = amount * FEE_BPS / BPS_DENOMINATOR
pub const BPS_DENOMINATOR: u16 = 10000;

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
// =============================================================================

/// Seed for the Pool account PDA
/// Full seed: ["pool", deposit_mint_pubkey]
pub const POOL_SEED: &[u8] = b"pool";

/// Seed for the vault token account PDA (holds deposited USDC)
/// Full seed: ["vault", pool_pubkey]
pub const VAULT_SEED: &[u8] = b"vault";

/// Seed for the share mint PDA (sVLTR token mint)
/// Full seed: ["share_mint", pool_pubkey]
pub const SHARE_MINT_SEED: &[u8] = b"share_mint";

/// Seed for Depositor account PDA (tracks individual user deposits)
/// Full seed: ["depositor", pool_pubkey, owner_pubkey]
pub const DEPOSITOR_SEED: &[u8] = b"depositor";

// NOTE: OPERATOR_SEED has been REMOVED - no external operators in new design

// =============================================================================
// SAFETY LIMITS
// =============================================================================

/// Maximum deposit amount per transaction (100M USDC)
/// Prevents accidents with huge deposits
pub const MAX_DEPOSIT_AMOUNT: u64 = 100_000_000_000_000;

/// Minimum deposit amount (1 USDC)
/// Prevents dust deposits that waste compute
pub const MIN_DEPOSIT_AMOUNT: u64 = 1_000_000;

/// Minimum FIRST deposit amount (1000 USDC = 1000 * 10^6)
/// Prevents share price inflation attacks where attacker:
/// 1. Deposits 1 token, gets 1 share
/// 2. Transfers tokens directly to vault
/// 3. Inflates share price, causing next depositor to get ~0 shares
/// By requiring a large first deposit, this attack becomes economically unviable
pub const MIN_FIRST_DEPOSIT: u64 = 1_000_000_000; // 1000 USDC

/// Minimum shares that must be minted for any deposit
/// Prevents rounding attacks where deposit_amount / share_price rounds to 0
pub const MIN_SHARES_MINTED: u64 = 1000; // At least 1000 base units (0.001 shares)

/// Default initial pool size cap (500K USDC = 500,000 * 10^6)
/// Ensures high capital efficiency and APY at launch
/// Admin can raise this via update_pool_cap as TVL grows
pub const DEFAULT_POOL_SIZE: u64 = 500_000_000_000;

/// Maximum allowed pool size cap (1B USDC = 1,000,000,000 * 10^6)
/// Hard limit - even admin cannot set pool cap above this
pub const MAX_POOL_SIZE: u64 = 1_000_000_000_000_000;
