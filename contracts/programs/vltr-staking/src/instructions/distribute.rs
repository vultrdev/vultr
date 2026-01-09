use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{MIN_DISTRIBUTE_AMOUNT, STAKING_POOL_SEED};
use crate::error::StakingError;
use crate::state::StakingPool;

/// Distribute USDC rewards to stakers
///
/// This is called by the bot/admin after liquidation profits are recorded.
/// It transfers USDC from the source to the reward vault and updates
/// the reward_per_token so stakers can claim their share.
///
/// # Arguments
/// * `ctx` - The context containing all accounts
/// * `amount` - Amount of USDC to distribute
///
/// # Flow
/// 1. Transfer USDC from source to reward vault
/// 2. Update pool's reward_per_token
///
#[derive(Accounts)]
pub struct Distribute<'info> {
    /// Authority distributing rewards (admin or bot)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Staking pool
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED, staking_pool.vltr_mint.as_ref()],
        bump = staking_pool.bump,
        constraint = staking_pool.admin == authority.key() @ StakingError::Unauthorized
    )]
    pub staking_pool: Account<'info, StakingPool>,

    /// Reward token mint (USDC)
    #[account(
        constraint = reward_mint.key() == staking_pool.reward_mint @ StakingError::InvalidRewardMint
    )]
    pub reward_mint: Account<'info, Mint>,

    /// Source of rewards (authority's USDC account or staking_rewards_vault)
    /// Must be owned by authority to authorize transfer
    #[account(
        mut,
        token::mint = reward_mint,
        constraint = reward_source.owner == authority.key() @ StakingError::InvalidTokenAccountOwner
    )]
    pub reward_source: Account<'info, TokenAccount>,

    /// Pool's reward vault
    #[account(
        mut,
        constraint = reward_vault.key() == staking_pool.reward_vault @ StakingError::InvalidPDA,
        token::mint = reward_mint
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler_distribute(ctx: Context<Distribute>, amount: u64) -> Result<()> {
    // Validate amount
    require!(amount > 0, StakingError::InvalidAmount);
    require!(
        amount >= MIN_DISTRIBUTE_AMOUNT,
        StakingError::InvalidAmount
    );

    let staking_pool = &mut ctx.accounts.staking_pool;

    // If no stakers, we can't distribute
    // The rewards should stay in source or be returned
    if staking_pool.total_staked == 0 {
        msg!("No stakers - cannot distribute rewards. Skipping.");
        return Ok(());
    }

    // Transfer USDC from source to reward vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.reward_source.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update reward_per_token
    staking_pool.update_reward_per_token(amount)?;

    msg!(
        "Distributed {} USDC. Total distributed: {}, Stakers: {}, reward_per_token: {}",
        amount,
        staking_pool.total_rewards_distributed,
        staking_pool.staker_count,
        staking_pool.reward_per_token
    );

    Ok(())
}
