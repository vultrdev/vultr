// =============================================================================
// VULTR Error Codes
// =============================================================================
// Custom errors that the VULTR program can return. Each error has a unique code
// and a human-readable message. The error code is used on-chain (saves space),
// while the message helps developers debug issues.
// =============================================================================

use anchor_lang::prelude::*;

/// All possible errors that the VULTR program can return.
///
/// In Anchor, errors are automatically assigned numeric codes starting from 6000.
/// When a transaction fails, you'll see the error code in logs - use this enum
/// to understand what went wrong.
#[error_code]
pub enum VultrError {
    // =========================================================================
    // Pool State Errors (6000-6009)
    // =========================================================================

    /// The pool has been paused by admin - no deposits, withdrawals, or liquidations allowed
    /// This is an emergency safety measure
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

    /// Trying to deposit/withdraw/stake 0 tokens - that's not allowed
    #[msg("Amount must be greater than zero")]
    InvalidAmount,

    /// Deposit is below the minimum (1 USDC) - prevents dust attacks
    #[msg("Amount is below minimum deposit")]
    BelowMinimumDeposit,

    /// Deposit would exceed the maximum pool size - risk management
    #[msg("Amount exceeds maximum pool size")]
    ExceedsMaxPoolSize,

    /// Single transaction deposit exceeds limit
    #[msg("Amount exceeds maximum deposit per transaction")]
    ExceedsMaxDeposit,

    // =========================================================================
    // Operator Errors (6020-6029)
    // =========================================================================

    /// Trying to become an operator without enough stake
    #[msg("Stake amount is below minimum required")]
    InsufficientStake,

    /// Trying to perform operator action but not registered/active
    #[msg("Operator is not active")]
    OperatorNotActive,

    /// Trying to register as operator but already registered
    #[msg("Already registered as operator")]
    OperatorAlreadyRegistered,

    /// Operator has pending obligations and can't deregister yet
    #[msg("Operator has pending liquidations")]
    OperatorHasPendingLiquidations,

    /// Operator must request withdrawal before withdrawing stake
    #[msg("Operator withdrawal has not been requested")]
    OperatorWithdrawalNotRequested,

    /// Operator is not in withdrawing state
    #[msg("Operator is not withdrawing")]
    OperatorNotWithdrawing,

    /// Operator cooldown has not elapsed yet
    #[msg("Operator cooldown has not elapsed")]
    OperatorCooldownNotElapsed,

    // =========================================================================
    // Fee & Configuration Errors (6030-6039)
    // =========================================================================

    /// Fee percentages don't add up to 100% or exceed limits
    #[msg("Invalid fee configuration - fees must sum to 100%")]
    InvalidFeeConfig,

    /// Trying to set a fee higher than the maximum allowed
    #[msg("Fee exceeds maximum allowed")]
    FeeExceedsMax,

    // =========================================================================
    // Authorization Errors (6040-6049)
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

    // =========================================================================
    // Math & Overflow Errors (6050-6059)
    // =========================================================================

    /// A calculation would overflow - this should never happen in normal operation
    #[msg("Math overflow - calculation exceeded maximum value")]
    MathOverflow,

    /// A calculation would underflow - trying to subtract more than available
    #[msg("Math underflow - result would be negative")]
    MathUnderflow,

    /// Division by zero - usually means pool is empty when it shouldn't be
    #[msg("Division by zero")]
    DivisionByZero,

    // =========================================================================
    // Account Validation Errors (6060-6069)
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

    // =========================================================================
    // Liquidation Errors (6070-6079)
    // Reserved for production liquidation implementation
    // =========================================================================

    /// The liquidation would not be profitable
    #[msg("Liquidation is not profitable")]
    LiquidationNotProfitable,

    /// The position is not eligible for liquidation (health factor OK)
    #[msg("Position is not liquidatable")]
    PositionNotLiquidatable,

    /// Liquidation amount exceeds maximum allowed
    #[msg("Liquidation amount exceeds maximum")]
    LiquidationExceedsMax,

    /// Slippage protection triggered - execution price too different from expected
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    // =========================================================================
    // Share Calculation Errors (6080-6089)
    // =========================================================================

    /// User doesn't have enough shares to burn for this withdrawal
    #[msg("Insufficient shares for withdrawal")]
    InsufficientShares,

    /// Calculated share amount is zero - deposit too small relative to pool
    #[msg("Share amount rounds to zero")]
    ShareAmountZero,
}
