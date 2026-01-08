use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{STAKER_SEED, STAKING_POOL_SEED, STAKE_VAULT_SEED};
use crate::error::StakingError;
use crate::state::{Staker, StakingPool};

/// Unstake VLTR tokens (no cooldown)
///
/// # Arguments
/// * `ctx` - The context containing all accounts
/// * `amount` - Amount of VLTR tokens to unstake
///
/// # Flow
/// 1. Validate amount and user has enough staked
/// 2. Transfer VLTR from stake vault back to user
/// 3. Update staker position
/// 4. Update pool totals
///
#[derive(Accounts)]
pub struct Unstake<'info> {
    /// User unstaking their VLTR tokens
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

    /// User's staker account
    #[account(
        mut,
        seeds = [STAKER_SEED, staking_pool.key().as_ref(), user.key().as_ref()],
        bump = staker.bump,
        constraint = staker.owner == user.key() @ StakingError::InvalidAuthority
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

    pub token_program: Program<'info, Token>,
}

pub fn handler_unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    // Validate amount
    require!(amount > 0, StakingError::InvalidAmount);
    require!(
        ctx.accounts.staker.staked_amount >= amount,
        StakingError::InsufficientStake
    );

    let staking_pool = &mut ctx.accounts.staking_pool;
    let staker = &mut ctx.accounts.staker;

    // Transfer VLTR from stake vault back to user
    // Pool PDA signs as authority
    let vltr_mint_key = staking_pool.vltr_mint;
    let seeds = &[
        STAKING_POOL_SEED,
        vltr_mint_key.as_ref(),
        &[staking_pool.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.stake_vault.to_account_info(),
                to: ctx.accounts.user_vltr_account.to_account_info(),
                authority: staking_pool.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // Update staker position (handles reward debt)
    staker.record_unstake(amount, staking_pool.reward_per_token)?;

    // Update pool total staked
    staking_pool.total_staked = staking_pool
        .total_staked
        .checked_sub(amount)
        .ok_or(StakingError::MathUnderflow)?;

    // Decrement staker count if fully unstaked
    if staker.staked_amount == 0 {
        staking_pool.staker_count = staking_pool
            .staker_count
            .checked_sub(1)
            .ok_or(StakingError::MathUnderflow)?;
    }

    msg!(
        "Unstaked {} VLTR. User remaining: {}, Pool total: {}",
        amount,
        staker.staked_amount,
        staking_pool.total_staked
    );

    Ok(())
}
