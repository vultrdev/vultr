use anchor_lang::prelude::*;

#[error_code]
pub enum StakingError {
    // Pool State Errors (6000-6009)
    #[msg("Staking pool is paused")]
    PoolPaused,

    #[msg("Staking pool already initialized")]
    PoolAlreadyInitialized,

    // Amount Errors (6010-6019)
    #[msg("Invalid amount: must be greater than zero")]
    InvalidAmount,

    #[msg("Amount below minimum stake")]
    BelowMinimumStake,

    #[msg("Amount exceeds maximum stake")]
    ExceedsMaximumStake,

    #[msg("Insufficient staked balance")]
    InsufficientStake,

    #[msg("No rewards available to claim")]
    NoRewardsToClaim,

    #[msg("Insufficient balance in reward vault")]
    InsufficientRewardBalance,

    // Authorization Errors (6020-6029)
    #[msg("Unauthorized: admin only")]
    Unauthorized,

    #[msg("Invalid authority")]
    InvalidAuthority,

    // Math Errors (6030-6039)
    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Math underflow")]
    MathUnderflow,

    #[msg("Division by zero")]
    DivisionByZero,

    // Account Validation Errors (6040-6049)
    #[msg("Invalid VLTR mint")]
    InvalidVltrMint,

    #[msg("Invalid reward mint")]
    InvalidRewardMint,

    #[msg("Invalid PDA")]
    InvalidPDA,

    #[msg("Invalid token account owner")]
    InvalidTokenAccountOwner,
}
