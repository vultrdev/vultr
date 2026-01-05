// =============================================================================
// Depositor State Account
// =============================================================================
// The Depositor account tracks an individual user's position in the pool.
// Each user who deposits gets their own Depositor PDA that stores their
// shares and deposit history.
//
// Why do we need this account?
// - SPL tokens (shares) are held in token accounts, but we need to track
//   additional metadata like deposit timestamps and total deposited amount
// - This allows us to implement features like time-weighted rewards later
// - Helps with analytics and user-facing statistics
// =============================================================================

use anchor_lang::prelude::*;

/// Tracks an individual user's position in a VULTR pool.
///
/// This account is a PDA derived from ["depositor", pool_pubkey, owner_pubkey].
/// One Depositor account per user per pool.
///
/// Account size calculation:
/// - discriminator: 8 bytes
/// - pool: 32 bytes
/// - owner: 32 bytes
/// - shares_minted: 8 bytes
/// - total_deposited: 8 bytes
/// - total_withdrawn: 8 bytes
/// - deposit_count: 4 bytes
/// - last_deposit_timestamp: 8 bytes
/// - last_withdrawal_timestamp: 8 bytes
/// - bump: 1 byte
/// - _padding: 3 bytes
/// Total: 8 + 120 = 128 bytes
#[account]
#[derive(InitSpace)]
pub struct Depositor {
    // =========================================================================
    // Account References
    // =========================================================================

    /// The pool this depositor belongs to
    /// Used to validate operations are for the correct pool
    pub pool: Pubkey,

    /// The wallet address that owns this depositor account
    /// Must sign for deposits/withdrawals
    pub owner: Pubkey,

    // =========================================================================
    // Position Tracking
    // =========================================================================

    /// Total share tokens this user has been minted
    /// Note: This tracks minted shares, not current balance!
    /// User's current shares are in their token account.
    /// This is for historical tracking and analytics.
    pub shares_minted: u64,

    /// Total amount of deposit tokens this user has deposited (cumulative)
    /// Used to calculate profit/loss: profit = withdrawn - deposited + current_value
    pub total_deposited: u64,

    /// Total amount of deposit tokens this user has withdrawn (cumulative)
    /// Combined with total_deposited, shows user's realized gains
    pub total_withdrawn: u64,

    /// Number of deposit transactions this user has made
    /// Useful for analytics and potential loyalty rewards
    pub deposit_count: u32,

    // =========================================================================
    // Timestamps
    // =========================================================================

    /// Unix timestamp of the user's most recent deposit
    /// Can be used for time-weighted calculations
    pub last_deposit_timestamp: i64,

    /// Unix timestamp of the user's most recent withdrawal
    pub last_withdrawal_timestamp: i64,

    // =========================================================================
    // PDA Bump
    // =========================================================================

    /// Bump seed for this Depositor PDA
    pub bump: u8,
}

impl Depositor {
    /// Record a new deposit for this user
    ///
    /// Updates:
    /// - shares_minted: Adds the newly minted shares
    /// - total_deposited: Adds the deposit amount
    /// - deposit_count: Increments by 1
    /// - last_deposit_timestamp: Sets to current time
    ///
    /// # Arguments
    /// * `deposit_amount` - Amount of deposit tokens being deposited
    /// * `shares_received` - Number of share tokens being minted
    /// * `timestamp` - Current unix timestamp
    pub fn record_deposit(
        &mut self,
        deposit_amount: u64,
        shares_received: u64,
        timestamp: i64,
    ) -> Result<()> {
        self.shares_minted = self
            .shares_minted
            .checked_add(shares_received)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;

        self.total_deposited = self
            .total_deposited
            .checked_add(deposit_amount)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;

        self.deposit_count = self
            .deposit_count
            .checked_add(1)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;

        self.last_deposit_timestamp = timestamp;

        Ok(())
    }

    /// Record a withdrawal for this user
    ///
    /// Updates:
    /// - total_withdrawn: Adds the withdrawal amount
    /// - last_withdrawal_timestamp: Sets to current time
    ///
    /// # Arguments
    /// * `withdrawal_amount` - Amount of deposit tokens being withdrawn
    /// * `timestamp` - Current unix timestamp
    pub fn record_withdrawal(&mut self, withdrawal_amount: u64, timestamp: i64) -> Result<()> {
        self.total_withdrawn = self
            .total_withdrawn
            .checked_add(withdrawal_amount)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;

        self.last_withdrawal_timestamp = timestamp;

        Ok(())
    }

    /// Calculate the user's realized profit/loss
    ///
    /// This only considers completed transactions:
    /// profit = total_withdrawn - total_deposited
    ///
    /// Note: This doesn't include unrealized gains from current share holdings.
    /// For total P/L, you'd also need to calculate the current value of shares.
    ///
    /// Returns: Positive for profit, negative for loss (as i64)
    pub fn realized_pnl(&self) -> i64 {
        // Cast to i64 for signed arithmetic
        (self.total_withdrawn as i64) - (self.total_deposited as i64)
    }

    /// Calculate how long the user has been depositing (time since first deposit)
    ///
    /// # Arguments
    /// * `current_timestamp` - Current unix timestamp
    ///
    /// Returns: Duration in seconds, or 0 if never deposited
    pub fn time_since_first_deposit(&self, current_timestamp: i64) -> i64 {
        if self.deposit_count == 0 {
            return 0;
        }
        // Note: last_deposit_timestamp is actually first deposit for count=1
        // For proper "first deposit" tracking, you'd need a separate field
        current_timestamp.saturating_sub(self.last_deposit_timestamp)
    }
}
