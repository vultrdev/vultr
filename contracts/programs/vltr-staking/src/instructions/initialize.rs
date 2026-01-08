use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{STAKING_POOL_SEED, STAKE_VAULT_SEED};
use crate::state::StakingPool;

/// Initialize a new staking pool
///
/// # Arguments
/// * `ctx` - The context containing all accounts
///
/// # Accounts
/// * `admin` - The admin who will control this pool (signer, payer)
/// * `staking_pool` - The staking pool PDA to create
/// * `vltr_mint` - The VLTR token mint (from PumpFun)
/// * `reward_mint` - The reward token mint (USDC)
/// * `stake_vault` - The vault to hold staked VLTR tokens
/// * `reward_vault` - The external reward vault (staking_rewards_vault from main pool)
///
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Admin who will control this staking pool
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Staking pool PDA
    #[account(
        init,
        payer = admin,
        space = StakingPool::SIZE,
        seeds = [STAKING_POOL_SEED, vltr_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,

    /// VLTR token mint (from PumpFun)
    pub vltr_mint: Account<'info, Mint>,

    /// Reward token mint (USDC)
    pub reward_mint: Account<'info, Mint>,

    /// Vault to hold staked VLTR tokens
    #[account(
        init,
        payer = admin,
        seeds = [STAKE_VAULT_SEED, staking_pool.key().as_ref()],
        bump,
        token::mint = vltr_mint,
        token::authority = staking_pool
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    /// External reward vault (staking_rewards_vault from main VULTR pool)
    /// This is where 15% of liquidation profits accumulate
    /// We just store the reference, rewards are distributed from here
    #[account(
        token::mint = reward_mint
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler_initialize(ctx: Context<Initialize>) -> Result<()> {
    let staking_pool = &mut ctx.accounts.staking_pool;

    // Initialize pool state
    staking_pool.admin = ctx.accounts.admin.key();
    staking_pool.vltr_mint = ctx.accounts.vltr_mint.key();
    staking_pool.reward_mint = ctx.accounts.reward_mint.key();
    staking_pool.stake_vault = ctx.accounts.stake_vault.key();
    staking_pool.reward_vault = ctx.accounts.reward_vault.key();

    // Initialize counters
    staking_pool.total_staked = 0;
    staking_pool.total_rewards_distributed = 0;
    staking_pool.reward_per_token = 0;
    staking_pool.last_distribution_time = Clock::get()?.unix_timestamp;
    staking_pool.staker_count = 0;

    // Not paused by default
    staking_pool.is_paused = false;

    // Store bump seeds
    staking_pool.bump = ctx.bumps.staking_pool;
    staking_pool.stake_vault_bump = ctx.bumps.stake_vault;

    msg!(
        "Staking pool initialized: vltr_mint={}, reward_mint={}",
        staking_pool.vltr_mint,
        staking_pool.reward_mint
    );

    Ok(())
}
