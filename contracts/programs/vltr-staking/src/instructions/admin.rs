use anchor_lang::prelude::*;

use crate::constants::STAKING_POOL_SEED;
use crate::error::StakingError;
use crate::state::StakingPool;

// =============================================================================
// Pause Pool
// =============================================================================

#[derive(Accounts)]
pub struct PausePool<'info> {
    #[account(
        constraint = admin.key() == staking_pool.admin @ StakingError::Unauthorized
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKING_POOL_SEED, staking_pool.vltr_mint.as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
}

pub fn pause_pool(ctx: Context<PausePool>, paused: bool) -> Result<()> {
    ctx.accounts.staking_pool.is_paused = paused;

    msg!(
        "Staking pool {} {}",
        ctx.accounts.staking_pool.key(),
        if paused { "PAUSED" } else { "RESUMED" }
    );

    Ok(())
}

// =============================================================================
// Transfer Admin
// =============================================================================

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(
        constraint = admin.key() == staking_pool.admin @ StakingError::Unauthorized
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKING_POOL_SEED, staking_pool.vltr_mint.as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,

    /// CHECK: New admin address, validated to not be default
    #[account(
        constraint = new_admin.key() != Pubkey::default() @ StakingError::InvalidAuthority,
        constraint = new_admin.key() != admin.key() @ StakingError::InvalidAuthority
    )]
    pub new_admin: UncheckedAccount<'info>,
}

pub fn transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
    let old_admin = ctx.accounts.staking_pool.admin;
    ctx.accounts.staking_pool.admin = ctx.accounts.new_admin.key();

    msg!(
        "Admin transferred from {} to {}",
        old_admin,
        ctx.accounts.new_admin.key()
    );

    Ok(())
}

// =============================================================================
// Update Reward Vault
// =============================================================================

#[derive(Accounts)]
pub struct UpdateRewardVault<'info> {
    #[account(
        constraint = admin.key() == staking_pool.admin @ StakingError::Unauthorized
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKING_POOL_SEED, staking_pool.vltr_mint.as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,

    /// CHECK: New reward vault address
    #[account(
        constraint = new_reward_vault.key() != Pubkey::default() @ StakingError::InvalidPDA
    )]
    pub new_reward_vault: UncheckedAccount<'info>,
}

pub fn update_reward_vault(ctx: Context<UpdateRewardVault>) -> Result<()> {
    let old_vault = ctx.accounts.staking_pool.reward_vault;
    ctx.accounts.staking_pool.reward_vault = ctx.accounts.new_reward_vault.key();

    msg!(
        "Reward vault updated from {} to {}",
        old_vault,
        ctx.accounts.new_reward_vault.key()
    );

    Ok(())
}
