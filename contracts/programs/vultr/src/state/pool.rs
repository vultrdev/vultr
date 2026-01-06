// =============================================================================
// Pool State Account
// =============================================================================
// The Pool account is the central state for the VULTR protocol. It stores all
// configuration, tracks total deposits, and holds the authority for the vault.
//
// Key Concepts:
// - PDA (Program Derived Address): An address derived from seeds that only this
//   program can sign for. This allows the program to "own" the pool.
// - Bump: A number (0-255) that makes the PDA valid. We store it to avoid
//   recalculating it every time (saves compute).
// =============================================================================

use anchor_lang::prelude::*;

/// The main Pool account that stores all protocol state.
///
/// This account is created once per deposit token (e.g., one pool for USDC).
/// It's a PDA derived from ["pool", deposit_mint_pubkey].
///
/// Account size calculation:
/// - discriminator: 8 bytes (automatically added by Anchor)
/// - admin: 32 bytes
/// - deposit_mint: 32 bytes
/// - share_mint: 32 bytes
/// - vault: 32 bytes
/// - protocol_fee_vault: 32 bytes
/// - total_deposits: 8 bytes
/// - total_shares: 8 bytes
/// - total_profit: 8 bytes
/// - accumulated_protocol_fees: 8 bytes
/// - protocol_fee_bps: 2 bytes
/// - operator_fee_bps: 2 bytes
/// - depositor_share_bps: 2 bytes
/// - operator_count: 4 bytes
/// - is_paused: 1 byte
/// - bump: 1 byte
/// - vault_bump: 1 byte
/// - share_mint_bump: 1 byte
/// - protocol_fee_vault_bump: 1 byte
/// - operator_cooldown_seconds: 8 bytes
/// - max_slippage_bps: 2 bytes
/// - _padding: 1 byte (for alignment)
/// Total: 8 + 230 = 238 bytes
#[account]
#[derive(InitSpace)]
pub struct Pool {
    // =========================================================================
    // Authority & Identification
    // =========================================================================

    /// The admin who can pause/unpause the pool and update fees
    /// This should be a multisig in production!
    pub admin: Pubkey,

    /// The SPL token mint for deposits (e.g., USDC)
    /// Users deposit this token to receive shares
    pub deposit_mint: Pubkey,

    /// The SPL token mint for shares (VLTR token)
    /// This is created by the program as a PDA
    pub share_mint: Pubkey,

    /// The token account that holds all deposited tokens
    /// This is a PDA-owned token account
    pub vault: Pubkey,

    /// The token account that accumulates protocol fees
    /// Separate from main vault for accounting clarity
    pub protocol_fee_vault: Pubkey,

    // =========================================================================
    // Financial State (all amounts in base units, e.g., USDC with 6 decimals)
    // =========================================================================

    /// Total amount of deposit tokens in the vault
    /// This is the "working capital" available for liquidations
    pub total_deposits: u64,

    /// Total supply of share tokens minted
    /// Used to calculate share price: price = total_value / total_shares
    pub total_shares: u64,

    /// Total profit generated from liquidations (cumulative)
    /// Tracks historical performance
    pub total_profit: u64,

    /// Protocol fees accumulated but not yet withdrawn
    /// Admin can call withdraw_protocol_fees to collect
    pub accumulated_protocol_fees: u64,

    // =========================================================================
    // Fee Configuration (in basis points, 1 BPS = 0.01%)
    // =========================================================================

    /// Protocol fee: percentage of profits to protocol treasury
    /// Default: 500 BPS (5%)
    pub protocol_fee_bps: u16,

    /// Operator fee: percentage of profits to the liquidating operator
    /// Default: 1500 BPS (15%)
    pub operator_fee_bps: u16,

    /// Depositor share: percentage of profits to pool depositors
    /// Default: 8000 BPS (80%)
    /// Note: protocol_fee_bps + operator_fee_bps + depositor_share_bps = 10000
    pub depositor_share_bps: u16,

    // =========================================================================
    // Operator Management
    // =========================================================================

    /// Number of currently registered operators
    /// Used for statistics and potential rate limiting
    pub operator_count: u32,

    // =========================================================================
    // Pool Status
    // =========================================================================

    /// Emergency pause flag
    /// When true, no deposits, withdrawals, or liquidations are allowed
    pub is_paused: bool,

    // =========================================================================
    // PDA Bumps (stored to avoid recalculation)
    // =========================================================================

    /// Bump seed for the Pool PDA itself
    pub bump: u8,

    /// Bump seed for the vault token account PDA
    pub vault_bump: u8,

    /// Bump seed for the share mint PDA
    pub share_mint_bump: u8,

    /// Bump seed for the protocol fee vault PDA
    pub protocol_fee_vault_bump: u8,

    // =========================================================================
    // Operator Withdrawal Configuration
    // =========================================================================

    /// Operator stake withdrawal cooldown in seconds.
    ///
    /// - 0 means immediate withdrawal is allowed once withdrawal is requested.
    /// - On mainnet, set this to something meaningful (e.g., 7 * 24 * 60 * 60).
    ///
    /// This is configurable by the pool admin via an admin instruction.
    pub operator_cooldown_seconds: i64,

    // =========================================================================
    // Liquidation Configuration
    // =========================================================================

    /// Maximum allowed slippage for token swaps in basis points (BPS).
    ///
    /// When executing liquidations, collateral is swapped to the deposit token
    /// via Jupiter. This field limits how much slippage is acceptable:
    /// - 100 BPS = 1% slippage
    /// - 300 BPS = 3% slippage (recommended default)
    /// - 1000 BPS = 10% slippage (maximum allowed)
    ///
    /// If actual slippage exceeds this, the liquidation transaction will fail.
    /// This protects against MEV attacks and bad swap routes.
    ///
    /// Configurable by admin via update_slippage_tolerance instruction.
    pub max_slippage_bps: u16,
}

impl Pool {
    /// Calculate the current value of the pool for share price calculations
    ///
    /// Note: `total_deposits` already includes the depositor share (80%) of
    /// liquidation profits, which is added in execute_liquidation. The
    /// `total_profit` field tracks lifetime statistics and should NOT be
    /// added here to avoid double-counting.
    ///
    /// Returns: Total pool value in deposit token base units
    pub fn total_value(&self) -> u64 {
        self.total_deposits
    }

    /// Calculate how many shares to mint for a given deposit amount
    ///
    /// Formula:
    /// - If pool is empty (first deposit): shares = deposit_amount
    /// - Otherwise: shares = (deposit_amount * total_shares) / total_value
    ///
    /// This ensures:
    /// - First depositor gets 1:1 shares
    /// - Later depositors get shares proportional to their contribution
    /// - Share price naturally increases as profits accumulate
    ///
    /// Returns: Ok(shares_to_mint) or Err if calculation overflows
    pub fn calculate_shares_to_mint(&self, deposit_amount: u64) -> Result<u64> {
        if self.total_shares == 0 {
            // First deposit: 1:1 ratio
            Ok(deposit_amount)
        } else {
            // shares = (deposit * total_shares) / total_value
            let total_value = self.total_value();

            // Avoid division by zero (shouldn't happen if total_shares > 0)
            if total_value == 0 {
                return Ok(deposit_amount);
            }

            // Use u128 for intermediate calculation to prevent overflow
            // deposit_amount * total_shares could exceed u64 max
            let shares = (deposit_amount as u128)
                .checked_mul(self.total_shares as u128)
                .ok_or(error!(crate::error::VultrError::MathOverflow))?
                .checked_div(total_value as u128)
                .ok_or(error!(crate::error::VultrError::DivisionByZero))?;

            // Convert back to u64 (should fit since shares <= total_shares theoretically)
            Ok(shares as u64)
        }
    }

    /// Calculate how many deposit tokens to return for burning shares
    ///
    /// Formula: withdrawal_amount = (shares_to_burn * total_value) / total_shares
    ///
    /// This ensures:
    /// - Users get proportional share of pool value
    /// - Profits are automatically included in withdrawal
    ///
    /// Returns: Ok(withdrawal_amount) or Err if calculation fails
    pub fn calculate_withdrawal_amount(&self, shares_to_burn: u64) -> Result<u64> {
        if self.total_shares == 0 {
            return Err(error!(crate::error::VultrError::DivisionByZero));
        }

        let total_value = self.total_value();

        // Use u128 for intermediate calculation
        let amount = (shares_to_burn as u128)
            .checked_mul(total_value as u128)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?
            .checked_div(self.total_shares as u128)
            .ok_or(error!(crate::error::VultrError::DivisionByZero))?;

        Ok(amount as u64)
    }

    /// Validate that the fee configuration is correct
    /// All fees must sum to exactly 10000 BPS (100%)
    pub fn validate_fees(&self) -> Result<()> {
        let total_bps = (self.protocol_fee_bps as u32)
            .checked_add(self.operator_fee_bps as u32)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?
            .checked_add(self.depositor_share_bps as u32)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;

        if total_bps != 10000 {
            return Err(error!(crate::error::VultrError::InvalidFeeConfig));
        }

        Ok(())
    }

    /// Calculate fee distribution for a given profit amount
    ///
    /// Returns: (protocol_fee, operator_fee, depositor_profit)
    pub fn calculate_fee_distribution(&self, profit: u64) -> Result<(u64, u64, u64)> {
        // protocol_fee = profit * protocol_fee_bps / 10000
        let protocol_fee = (profit as u128)
            .checked_mul(self.protocol_fee_bps as u128)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?
            .checked_div(10000)
            .ok_or(error!(crate::error::VultrError::DivisionByZero))? as u64;

        // operator_fee = profit * operator_fee_bps / 10000
        let operator_fee = (profit as u128)
            .checked_mul(self.operator_fee_bps as u128)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?
            .checked_div(10000)
            .ok_or(error!(crate::error::VultrError::DivisionByZero))? as u64;

        // depositor_profit = profit - protocol_fee - operator_fee
        // (calculated this way to avoid rounding errors)
        let depositor_profit = profit
            .checked_sub(protocol_fee)
            .ok_or(error!(crate::error::VultrError::MathUnderflow))?
            .checked_sub(operator_fee)
            .ok_or(error!(crate::error::VultrError::MathUnderflow))?;

        Ok((protocol_fee, operator_fee, depositor_profit))
    }
}
