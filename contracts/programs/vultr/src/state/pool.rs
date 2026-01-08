// =============================================================================
// Pool State Account - NEW SIMPLIFIED DESIGN
// =============================================================================
// The Pool account is the central state for the VULTR protocol.
//
// KEY CHANGES FROM OLD DESIGN:
// - No external operators - team runs the bot internally
// - bot_wallet field stores the authorized bot address
// - staking_rewards_vault receives 15% for VLTR token stakers
// - No operator staking, registration, or slashing
// =============================================================================

use anchor_lang::prelude::*;

/// The main Pool account that stores all protocol state.
///
/// This account is created once per deposit token (e.g., one pool for USDC).
/// It's a PDA derived from ["pool", deposit_mint_pubkey].
#[account]
#[derive(InitSpace)]
pub struct Pool {
    // =========================================================================
    // Authority & Identification
    // =========================================================================

    /// The admin who can pause/unpause the pool and update settings
    /// This should be a multisig in production!
    pub admin: Pubkey,

    /// The wallet authorized to call record_profit (the bot)
    /// This is NOT an external operator - this is the team's bot wallet
    pub bot_wallet: Pubkey,

    /// The SPL token mint for deposits (e.g., USDC)
    /// Users deposit this token to receive shares
    pub deposit_mint: Pubkey,

    /// The SPL token mint for shares (sVLTR token)
    /// This is created by the program as a PDA
    pub share_mint: Pubkey,

    /// The token account that holds all deposited tokens
    /// This is a PDA-owned token account
    pub vault: Pubkey,

    /// The token account that accumulates protocol fees (5%)
    /// Separate from main vault for accounting clarity
    pub treasury: Pubkey,

    /// The token account for VLTR staking rewards (15%)
    /// This replaces the old operator_fee - goes to token stakers
    pub staking_rewards_vault: Pubkey,

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

    /// Total number of liquidations executed
    pub total_liquidations: u64,

    // =========================================================================
    // Fee Configuration (in basis points, 1 BPS = 0.01%)
    // Must sum to 10000 (100%)
    // =========================================================================

    /// Depositor fee: percentage of profits to pool depositors
    /// Default: 8000 BPS (80%)
    pub depositor_fee_bps: u16,

    /// Staking fee: percentage of profits to VLTR token stakers
    /// Default: 1500 BPS (15%)
    /// Note: This was operator_fee_bps in old design
    pub staking_fee_bps: u16,

    /// Treasury fee: percentage of profits to protocol treasury
    /// Default: 500 BPS (5%)
    pub treasury_fee_bps: u16,

    // =========================================================================
    // Pool Status & Configuration
    // =========================================================================

    /// Emergency pause flag
    /// When true, no deposits, withdrawals, or profit recording allowed
    pub is_paused: bool,

    /// Maximum total deposits allowed in this pool (in base units)
    /// Default: 500,000 USDC (500_000_000_000 with 6 decimals)
    pub max_pool_size: u64,

    // =========================================================================
    // PDA Bumps (stored to avoid recalculation)
    // =========================================================================

    /// Bump seed for the Pool PDA itself
    pub bump: u8,

    /// Bump seed for the vault token account PDA
    pub vault_bump: u8,

    /// Bump seed for the share mint PDA
    pub share_mint_bump: u8,
}

impl Pool {
    /// Calculate the current value of the pool for share price calculations
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
    pub fn calculate_shares_to_mint(&self, deposit_amount: u64) -> Result<u64> {
        if self.total_shares == 0 {
            // First deposit: 1:1 ratio
            Ok(deposit_amount)
        } else {
            let total_value = self.total_value();

            if total_value == 0 {
                return Ok(deposit_amount);
            }

            // Use u128 for intermediate calculation to prevent overflow
            let shares = (deposit_amount as u128)
                .checked_mul(self.total_shares as u128)
                .ok_or(error!(crate::error::VultrError::MathOverflow))?
                .checked_div(total_value as u128)
                .ok_or(error!(crate::error::VultrError::DivisionByZero))?;

            Ok(shares as u64)
        }
    }

    /// Calculate how many deposit tokens to return for burning shares
    ///
    /// Formula: withdrawal_amount = (shares_to_burn * total_value) / total_shares
    pub fn calculate_withdrawal_amount(&self, shares_to_burn: u64) -> Result<u64> {
        if self.total_shares == 0 {
            return Err(error!(crate::error::VultrError::DivisionByZero));
        }

        let total_value = self.total_value();

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
        let total_bps = (self.depositor_fee_bps as u32)
            .checked_add(self.staking_fee_bps as u32)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?
            .checked_add(self.treasury_fee_bps as u32)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?;

        if total_bps != 10000 {
            return Err(error!(crate::error::VultrError::InvalidFeeConfig));
        }

        Ok(())
    }

    /// Calculate fee distribution for a given profit amount
    ///
    /// Returns: (depositor_share, staking_share, treasury_share)
    /// - depositor_share goes to vault (increases share price)
    /// - staking_share goes to staking_rewards_vault
    /// - treasury_share goes to treasury
    pub fn calculate_fee_distribution(&self, profit: u64) -> Result<(u64, u64, u64)> {
        // depositor_share = profit * depositor_fee_bps / 10000 (80%)
        let depositor_share = (profit as u128)
            .checked_mul(self.depositor_fee_bps as u128)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?
            .checked_div(10000)
            .ok_or(error!(crate::error::VultrError::DivisionByZero))? as u64;

        // staking_share = profit * staking_fee_bps / 10000 (15%)
        let staking_share = (profit as u128)
            .checked_mul(self.staking_fee_bps as u128)
            .ok_or(error!(crate::error::VultrError::MathOverflow))?
            .checked_div(10000)
            .ok_or(error!(crate::error::VultrError::DivisionByZero))? as u64;

        // treasury_share = profit - depositor_share - staking_share (5%)
        // Calculated this way to avoid rounding errors
        let treasury_share = profit
            .checked_sub(depositor_share)
            .ok_or(error!(crate::error::VultrError::MathUnderflow))?
            .checked_sub(staking_share)
            .ok_or(error!(crate::error::VultrError::MathUnderflow))?;

        Ok((depositor_share, staking_share, treasury_share))
    }
}
