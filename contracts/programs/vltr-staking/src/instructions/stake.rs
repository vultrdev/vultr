use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{MAX_STAKE_AMOUNT, MIN_STAKE_AMOUNT, STAKER_SEED, STAKING_POOL_SEED, STAKE_VAULT_SEED};
use crate::error::StakingError;
use crate::state::{Staker, StakingPool};

/// Stake VLTR tokens
///
/// # Arguments
/// * `ctx` - The context containing all accounts
/// * `amount` - Amount of VLTR tokens to stake
///
/// # Flow
/// 1. Validate amount
/// 2. Transfer VLTR from user to stake vault
/// 3. Update staker position (with reward debt)
/// 4. Update pool totals
///
#[derive(Accounts)]
pub struct Stake<'info> {
    /// User staking their VLTR tokens
    #[account(mut)]
    pub user: Signer<'info>,

    /// Staking pool
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED, staking_pool.vltr_mint.as_ref()],
        bump = staking_pool.bump,
        constraint = !staking_pool.is_paused @ StakingError::PoolPaused
    )]
    pub staking_pool: Account<'info, StakingPool>,

    /// User's staker account (created if first time)
    #[account(
        init_if_needed,
        payer = user,
        space = Staker::SIZE,
        seeds = [STAKER_SEED, staking_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub staker: Account<'info, Staker>,

    /// VLTR token mint
    #[account(
        constraint = vltr_mint.key() == staking_pool.vltr_mint @ StakingError::InvalidVltrMint
    )]
    pub vltr_mint: Account<'info, Mint>,

    /// User's VLTR token account
    #[account(
        mut,
        token::mint = vltr_mint,
        token::authority = user
    )]
    pub user_vltr_account: Account<'info, TokenAccount>,

    /// Pool's stake vault
    #[account(
        mut,
        seeds = [STAKE_VAULT_SEED, staking_pool.key().as_ref()],
        bump = staking_pool.stake_vault_bump,
        token::mint = vltr_mint,
        token::authority = staking_pool
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler_stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    // Validate amount
    require!(amount > 0, StakingError::InvalidAmount);
    require!(amount >= MIN_STAKE_AMOUNT, StakingError::BelowMinimumStake);
    require!(amount <= MAX_STAKE_AMOUNT, StakingError::ExceedsMaximumStake);

    let staking_pool = &mut ctx.accounts.staking_pool;
    let staker = &mut ctx.accounts.staker;

    // Check if this is a new staker
    let is_new_staker = staker.staked_amount == 0 && staker.pool == Pubkey::default();

    // Initialize staker if new
    if is_new_staker {
        staker.pool = staking_pool.key();
        staker.owner = ctx.accounts.user.key();
        staker.bump = ctx.bumps.staker;

        // Increment staker count
        staking_pool.staker_count = staking_pool
            .staker_count
            .checked_add(1)
            .ok_or(StakingError::MathOverflow)?;
    }

    // Transfer VLTR from user to stake vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_vltr_account.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update staker position (handles reward debt)
    staker.record_stake(amount, staking_pool.reward_per_token)?;

    // Update pool total staked
    staking_pool.total_staked = staking_pool
        .total_staked
        .checked_add(amount)
        .ok_or(StakingError::MathOverflow)?;

    msg!(
        "Staked {} VLTR. User total: {}, Pool total: {}",
        amount,
        staker.staked_amount,
        staking_pool.total_staked
    );

    Ok(())
}
