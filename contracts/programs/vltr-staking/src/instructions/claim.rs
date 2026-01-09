use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{STAKER_SEED, STAKING_POOL_SEED};
use crate::error::StakingError;
use crate::state::{Staker, StakingPool};

/// Claim accumulated USDC rewards
///
/// # Arguments
/// * `ctx` - The context containing all accounts
///
/// # Flow
/// 1. Calculate pending rewards based on reward_per_token and reward_debt
/// 2. Transfer USDC from reward vault to user
/// 3. Update staker's reward_debt
///
#[derive(Accounts)]
pub struct Claim<'info> {
    /// User claiming their rewards
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

    /// Reward token mint (USDC)
    #[account(
        constraint = reward_mint.key() == staking_pool.reward_mint @ StakingError::InvalidRewardMint
    )]
    pub reward_mint: Account<'info, Mint>,

    /// User's USDC token account
    #[account(
        mut,
        token::mint = reward_mint,
        token::authority = user
    )]
    pub user_reward_account: Account<'info, TokenAccount>,

    /// Pool's reward vault (staking_rewards_vault from main pool)
    /// The admin/bot should have set the authority to allow the staking pool to withdraw
    #[account(
        mut,
        constraint = reward_vault.key() == staking_pool.reward_vault @ StakingError::InvalidPDA,
        token::mint = reward_mint,
        constraint = reward_vault.owner == reward_vault_authority.key() @ StakingError::InvalidTokenAccountOwner
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    /// Authority that can sign for the reward vault transfers
    /// Must be the owner of the reward_vault
    pub reward_vault_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler_claim(ctx: Context<Claim>) -> Result<()> {
    let staking_pool = &ctx.accounts.staking_pool;
    let staker = &mut ctx.accounts.staker;

    // Calculate pending rewards
    let pending_rewards = staker.calculate_pending_rewards(staking_pool.reward_per_token)?;

    // Ensure there are rewards to claim
    require!(pending_rewards > 0, StakingError::NoRewardsToClaim);

    // Check reward vault has enough balance
    require!(
        ctx.accounts.reward_vault.amount >= pending_rewards,
        StakingError::InsufficientRewardBalance
    );

    // Transfer USDC from reward vault to user
    // The reward_vault_authority signs this transfer
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.reward_vault.to_account_info(),
                to: ctx.accounts.user_reward_account.to_account_info(),
                authority: ctx.accounts.reward_vault_authority.to_account_info(),
            },
        ),
        pending_rewards,
    )?;

    // Update staker's reward tracking
    staker.record_claim(pending_rewards, staking_pool.reward_per_token)?;

    msg!(
        "Claimed {} USDC rewards. Total claimed: {}",
        pending_rewards,
        staker.rewards_claimed
    );

    Ok(())
}
