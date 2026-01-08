// =============================================================================
// Record Profit Instruction - NEW SIMPLIFIED DESIGN
// =============================================================================
// Called by the team's bot after a successful liquidation to record profit
// and distribute fees according to the 80/15/5 split.
//
// KEY POINTS:
// - Only bot_wallet can call this (NOT external operators)
// - Profit comes from external source (bot's token account)
// - 80% goes to vault (increases share price for depositors)
// - 15% goes to staking_rewards_vault (for VLTR token stakers)
// - 5% goes to treasury (protocol revenue)
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::VultrError;
use crate::state::Pool;

/// Accounts required for the record_profit instruction
#[derive(Accounts)]
pub struct RecordProfit<'info> {
    /// The bot wallet that is authorized to record profits
    /// Must match pool.bot_wallet
    #[account(mut)]
    pub bot_wallet: Signer<'info>,

    /// The pool account
    #[account(
        mut,
        constraint = pool.bot_wallet == bot_wallet.key() @ VultrError::UnauthorizedBot,
        constraint = !pool.is_paused @ VultrError::PoolPaused,
    )]
    pub pool: Account<'info, Pool>,

    /// The pool's main vault - receives 80% (depositor share)
    #[account(
        mut,
        constraint = vault.key() == pool.vault @ VultrError::InvalidPDA,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// The staking rewards vault - receives 15% (for VLTR stakers)
    #[account(
        mut,
        constraint = staking_rewards_vault.key() == pool.staking_rewards_vault @ VultrError::InvalidPDA,
    )]
    pub staking_rewards_vault: Account<'info, TokenAccount>,

    /// The treasury - receives 5% (protocol revenue)
    #[account(
        mut,
        constraint = treasury.key() == pool.treasury @ VultrError::InvalidPDA,
    )]
    pub treasury: Account<'info, TokenAccount>,

    /// The bot's token account holding the profit to distribute
    /// This is where the liquidation profit sits before distribution
    #[account(mut)]
    pub profit_source: Account<'info, TokenAccount>,

    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Record profit from a liquidation and distribute fees
///
/// # Arguments
/// * `profit_amount` - Total profit from liquidation (in deposit token base units)
///
/// # Fee Distribution
/// * 80% to vault (increases share price for depositors)
/// * 15% to staking_rewards_vault (for VLTR token stakers)
/// * 5% to treasury (protocol revenue)
pub fn handler_record_profit(ctx: Context<RecordProfit>, profit_amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Validate profit amount
    require!(profit_amount > 0, VultrError::InvalidProfit);

    // Calculate fee distribution
    let (depositor_share, staking_share, treasury_share) =
        pool.calculate_fee_distribution(profit_amount)?;

    msg!(
        "Recording profit: {} total, {} to depositors, {} to stakers, {} to treasury",
        profit_amount,
        depositor_share,
        staking_share,
        treasury_share
    );

    // Transfer depositor share (80%) to vault
    if depositor_share > 0 {
        let transfer_to_vault = Transfer {
            from: ctx.accounts.profit_source.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.bot_wallet.to_account_info(),
        };
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_to_vault,
            ),
            depositor_share,
        )?;

        // Update pool's total_deposits to reflect the profit added
        pool.total_deposits = pool
            .total_deposits
            .checked_add(depositor_share)
            .ok_or(VultrError::MathOverflow)?;
    }

    // Transfer staking share (15%) to staking_rewards_vault
    if staking_share > 0 {
        let transfer_to_staking = Transfer {
            from: ctx.accounts.profit_source.to_account_info(),
            to: ctx.accounts.staking_rewards_vault.to_account_info(),
            authority: ctx.accounts.bot_wallet.to_account_info(),
        };
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_to_staking,
            ),
            staking_share,
        )?;
    }

    // Transfer treasury share (5%) to treasury
    if treasury_share > 0 {
        let transfer_to_treasury = Transfer {
            from: ctx.accounts.profit_source.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.bot_wallet.to_account_info(),
        };
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_to_treasury,
            ),
            treasury_share,
        )?;
    }

    // Update pool statistics
    pool.total_profit = pool
        .total_profit
        .checked_add(profit_amount)
        .ok_or(VultrError::MathOverflow)?;

    pool.total_liquidations = pool
        .total_liquidations
        .checked_add(1)
        .ok_or(VultrError::MathOverflow)?;

    msg!(
        "Profit recorded successfully. Total profit: {}, Total liquidations: {}",
        pool.total_profit,
        pool.total_liquidations
    );

    Ok(())
}
