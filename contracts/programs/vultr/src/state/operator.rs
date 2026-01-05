// =============================================================================
// Operator State Account
// =============================================================================
// The Operator account tracks a registered liquidation operator. Operators are
// entities (bots or humans) that can execute liquidations using the pool's
// capital. They must stake a minimum amount as collateral and earn fees for
// successful liquidations.
//
// Why do we need operators?
// - Liquidations require technical expertise and infrastructure
// - Staking requirement prevents spam and provides accountability
// - Fee incentive attracts skilled liquidators to use our pool
// =============================================================================

use anchor_lang::prelude::*;

/// Status of an operator - used to control what actions they can take
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum OperatorStatus {
    /// Operator is inactive and cannot execute liquidations
    /// This is the initial state and can be set by admin as punishment
    Inactive,

    /// Operator is active and can execute liquidations
    /// Must have minimum stake to be active
    Active,

    /// Operator is in the process of withdrawing their stake
    /// Cannot execute liquidations but stake is still locked for cooldown period
    Withdrawing,
}

impl Default for OperatorStatus {
    fn default() -> Self {
        OperatorStatus::Inactive
    }
}

/// Tracks a registered operator for a VULTR pool.
///
/// This account is a PDA derived from ["operator", pool_pubkey, authority_pubkey].
/// One Operator account per operator per pool.
///
/// Account size calculation:
/// - discriminator: 8 bytes
/// - pool: 32 bytes
/// - authority: 32 bytes
/// - stake_amount: 8 bytes
/// - total_liquidations: 4 bytes
/// - total_profit_generated: 8 bytes
/// - total_fees_earned: 8 bytes
/// - last_liquidation_timestamp: 8 bytes
/// - registered_at: 8 bytes
/// - status: 1 byte (enum)
/// - bump: 1 byte
/// - _padding: 2 bytes
/// Total: 8 + 120 = 128 bytes
#[account]
#[derive(InitSpace)]
pub struct Operator {
    // =========================================================================
    // Account References
    // =========================================================================

    /// The pool this operator is registered for
    pub pool: Pubkey,

    /// The wallet address that controls this operator
    /// Must sign for liquidation executions
    pub authority: Pubkey,

    // =========================================================================
    // Stake Information
    // =========================================================================

    /// Amount of deposit tokens staked by this operator
    /// Must be >= MIN_OPERATOR_STAKE to be active
    /// Can be slashed for misbehavior (future feature)
    pub stake_amount: u64,

    // =========================================================================
    // Performance Tracking
    // =========================================================================

    /// Total number of liquidations executed by this operator
    pub total_liquidations: u32,

    /// Total profit generated for the pool by this operator's liquidations
    /// This is the gross profit before fee distribution
    pub total_profit_generated: u64,

    /// Total fees earned by this operator from liquidations
    /// This is the operator's 15% cut
    pub total_fees_earned: u64,

    // =========================================================================
    // Timestamps
    // =========================================================================

    /// Unix timestamp of the operator's most recent liquidation
    /// Used for activity monitoring and potential rewards
    pub last_liquidation_timestamp: i64,

    /// Unix timestamp when the operator registered
    /// Used for seniority/loyalty calculations
    pub registered_at: i64,

    // =========================================================================
    // Status
    // =========================================================================

    /// Current status of the operator
    pub status: OperatorStatus,

    // =========================================================================
    // PDA Bump
    // =========================================================================

    /// Bump seed for this Operator PDA
    pub bump: u8,
}

impl Operator {
    /// Check if this operator is currently active and can execute liquidations
    pub fn is_active(&self) -> bool {
        self.status == OperatorStatus::Active
    }

    /// Check if this operator has sufficient stake to be active
    ///
    /// # Arguments
    /// * `min_stake` - Minimum required stake amount
    pub fn has_sufficient_stake(&self, min_stake: u64) -> bool {
        self.stake_amount >= min_stake
    }

    /// Record a completed liquidation
    ///
    /// Updates:
    /// - total_liquidations: Increments by 1
    /// - total_profit_generated: Adds the gross profit
    /// - total_fees_earned: Adds the operator's fee
    /// - last_liquidation_timestamp: Sets to current time
    ///
    /// # Arguments
    /// * `profit` - Gross profit from the liquidation
    /// * `operator_fee` - Fee earned by this operator
    /// * `timestamp` - Current unix timestamp
    pub fn record_liquidation(
        &mut self,
        profit: u64,
        operator_fee: u64,
        timestamp: i64,
    ) -> Result<()> {
        self.total_liquidations = self
            .total_liquidations
            .checked_add(1)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;

        self.total_profit_generated = self
            .total_profit_generated
            .checked_add(profit)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;

        self.total_fees_earned = self
            .total_fees_earned
            .checked_add(operator_fee)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;

        self.last_liquidation_timestamp = timestamp;

        Ok(())
    }

    /// Add stake to this operator
    ///
    /// # Arguments
    /// * `amount` - Amount to add to stake
    pub fn add_stake(&mut self, amount: u64) -> Result<()> {
        self.stake_amount = self
            .stake_amount
            .checked_add(amount)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;
        Ok(())
    }

    /// Remove stake from this operator
    ///
    /// # Arguments
    /// * `amount` - Amount to remove from stake
    pub fn remove_stake(&mut self, amount: u64) -> Result<()> {
        self.stake_amount = self
            .stake_amount
            .checked_sub(amount)
            .ok_or(error!(crate::error::VultrError::InsufficientBalance))?;
        Ok(())
    }

    /// Calculate average profit per liquidation
    ///
    /// Returns: Average profit in deposit token base units, or 0 if no liquidations
    pub fn average_profit(&self) -> u64 {
        if self.total_liquidations == 0 {
            return 0;
        }
        self.total_profit_generated / (self.total_liquidations as u64)
    }

    /// Check if operator has been active recently
    ///
    /// # Arguments
    /// * `current_timestamp` - Current unix timestamp
    /// * `max_inactive_seconds` - Maximum allowed inactive period
    ///
    /// Returns: true if operator has liquidated within the time window
    pub fn is_recently_active(&self, current_timestamp: i64, max_inactive_seconds: i64) -> bool {
        if self.last_liquidation_timestamp == 0 {
            // Never liquidated, check registration time
            return current_timestamp - self.registered_at < max_inactive_seconds;
        }
        current_timestamp - self.last_liquidation_timestamp < max_inactive_seconds
    }
}
