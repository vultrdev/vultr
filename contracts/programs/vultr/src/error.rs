// =============================================================================
// VULTR Error Codes - NEW SIMPLIFIED DESIGN
// =============================================================================
// Custom errors that the VULTR program can return.
//
// KEY CHANGES FROM OLD DESIGN:
// - Operator errors REMOVED (no external operators)
// - Added UnauthorizedBot for bot_wallet checks
// =============================================================================

use anchor_lang::prelude::*;

/// All possible errors that the VULTR program can return.
#[error_code]
pub enum VultrError {
    // =========================================================================
    // Pool State Errors (6000-6009)
    // =========================================================================

    /// The pool has been paused by admin - no operations allowed
    #[msg("Pool is currently paused")]
    PoolPaused,

    /// The pool has already been initialized - can't initialize twice
    #[msg("Pool is already initialized")]
    PoolAlreadyInitialized,

    /// Trying to interact with a pool that hasn't been set up yet
    #[msg("Pool is not initialized")]
    PoolNotInitialized,

    // =========================================================================
    // Balance & Amount Errors (6010-6019)
    // =========================================================================

    /// User doesn't have enough tokens for this operation
    #[msg("Insufficient balance for operation")]
    InsufficientBalance,

    /// Trying to deposit/withdraw 0 tokens - not allowed
    #[msg("Amount must be greater than zero")]
    InvalidAmount,

    /// Deposit is below the minimum (1 USDC)
    #[msg("Amount is below minimum deposit")]
    BelowMinimumDeposit,

    /// Deposit would exceed the maximum pool size
    #[msg("Amount exceeds maximum pool size")]
    ExceedsMaxPoolSize,

    /// Single transaction deposit exceeds limit
    #[msg("Amount exceeds maximum deposit per transaction")]
    ExceedsMaxDeposit,

    // =========================================================================
    // Fee & Configuration Errors (6020-6029)
    // =========================================================================

    /// Fee percentages don't add up to 100%
    #[msg("Invalid fee configuration - fees must sum to 100%")]
    InvalidFeeConfig,

    /// Trying to set a fee higher than the maximum allowed
    #[msg("Fee exceeds maximum allowed")]
    FeeExceedsMax,

    /// Invalid pool cap configuration
    #[msg("Invalid pool cap - must be between current TVL and MAX_POOL_SIZE")]
    InvalidPoolCap,

    // =========================================================================
    // Authorization Errors (6030-6039)
    // =========================================================================

    /// Caller is not authorized to perform this action
    #[msg("Unauthorized - signer does not have permission")]
    Unauthorized,

    /// Only the pool admin can call this function
    #[msg("Only admin can perform this action")]
    AdminOnly,

    /// The signer doesn't match the expected authority
    #[msg("Invalid authority")]
    InvalidAuthority,

    /// The signer is not the authorized bot_wallet
    /// Only the team's bot can call record_profit
    #[msg("Unauthorized - signer is not the bot wallet")]
    UnauthorizedBot,

    // =========================================================================
    // Math & Overflow Errors (6040-6049)
    // =========================================================================

    /// A calculation would overflow
    #[msg("Math overflow - calculation exceeded maximum value")]
    MathOverflow,

    /// A calculation would underflow
    #[msg("Math underflow - result would be negative")]
    MathUnderflow,

    /// Division by zero
    #[msg("Division by zero")]
    DivisionByZero,

    /// Generic arithmetic error
    #[msg("Arithmetic error in calculation")]
    ArithmeticError,

    // =========================================================================
    // Account Validation Errors (6050-6059)
    // =========================================================================

    /// The deposit mint doesn't match what the pool was initialized with
    #[msg("Invalid deposit mint - must use pool's deposit token")]
    InvalidDepositMint,

    /// The share mint doesn't match the pool's share token
    #[msg("Invalid share mint")]
    InvalidShareMint,

    /// PDA derivation produced unexpected address
    #[msg("Invalid PDA derivation")]
    InvalidPDA,

    /// The provided bump doesn't match the stored bump
    #[msg("Invalid bump seed")]
    InvalidBump,

    /// Token account owner doesn't match expected owner
    #[msg("Invalid token account owner")]
    InvalidTokenAccountOwner,

    /// Invalid or missing instruction data
    #[msg("Invalid instruction data")]
    InvalidInstruction,

    /// Missing required accounts for operation
    #[msg("Missing required accounts")]
    MissingRequiredAccounts,

    // =========================================================================
    // Profit Recording Errors (6060-6069)
    // =========================================================================

    /// No profit to record (amount is zero or negative)
    #[msg("Invalid profit - amount must be greater than zero")]
    InvalidProfit,

    /// Bot's profit_source account doesn't have enough balance
    #[msg("Insufficient balance in profit source account")]
    InsufficientProfitBalance,

    /// Slippage protection triggered - swap output below minimum
    #[msg("Slippage tolerance exceeded - swap output too low")]
    SlippageExceeded,

    // =========================================================================
    // Share Calculation Errors (6070-6079)
    // =========================================================================

    /// User doesn't have enough shares to burn for this withdrawal
    #[msg("Insufficient shares for withdrawal")]
    InsufficientShares,

    /// Calculated share amount is zero - deposit too small relative to pool
    #[msg("Share amount rounds to zero")]
    ShareAmountZero,

    // =========================================================================
    // Timelock Errors (6080-6089) - SECURITY FIXES
    // =========================================================================

    /// Trying to finalize a change but no change is pending
    #[msg("No pending change to finalize")]
    NoPendingChange,

    /// Timelock period has not expired yet - must wait 24 hours
    #[msg("Timelock not expired - must wait 24 hours after proposal")]
    TimelockNotExpired,

    /// Timelock for pending change has expired (been too long since proposal)
    #[msg("Pending change expired - please propose again")]
    TimelockExpired,

    /// Trying to cancel a change but none is pending
    #[msg("No pending change to cancel")]
    NoPendingChangeToCancel,

    // =========================================================================
    // Emergency Withdrawal Errors (6090-6099)
    // =========================================================================

    /// Pool is not paused - emergency withdraw only works when paused
    #[msg("Pool is not paused - emergency withdraw not available")]
    PoolNotPaused,

    /// Pool hasn't been paused long enough for emergency withdrawal (7 days)
    #[msg("Emergency timelock not expired - pool must be paused for 7 days")]
    EmergencyTimelockNotExpired,

    /// Invalid address provided (e.g., zero address)
    #[msg("Invalid address - cannot be zero address")]
    InvalidAddress,
}
