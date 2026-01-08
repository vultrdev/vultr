use anchor_lang::prelude::*;

use crate::constants::REWARD_PRECISION;
use crate::error::StakingError;

/// Global staking pool state
/// PDA: ["staking_pool", vltr_mint]
#[account]
#[derive(Default)]
pub struct StakingPool {
    /// Admin who can pause/unpause and update settings
    pub admin: Pubkey,

    /// VLTR token mint (from PumpFun)
    pub vltr_mint: Pubkey,

    /// Reward token mint (USDC)
    pub reward_mint: Pubkey,

    /// Vault holding staked VLTR tokens
    /// PDA: ["stake_vault", staking_pool]
    pub stake_vault: Pubkey,

    /// Vault holding USDC rewards to distribute
    /// This is the staking_rewards_vault from the main pool
    pub reward_vault: Pubkey,

    /// Total VLTR tokens staked
    pub total_staked: u64,

    /// Total USDC rewards distributed (lifetime)
    pub total_rewards_distributed: u64,

    /// Accumulated rewards per token (scaled by REWARD_PRECISION)
    /// This increases each time rewards are distributed
    pub reward_per_token: u128,

    /// Last time rewards were distributed
    pub last_distribution_time: i64,

    /// Number of unique stakers
    pub staker_count: u64,

    /// Emergency pause flag
    pub is_paused: bool,

    /// PDA bump seed
    pub bump: u8,

    /// Stake vault bump seed
    pub stake_vault_bump: u8,
}

impl StakingPool {
    /// Account size for allocation
    pub const SIZE: usize = 8 + // discriminator
        32 + // admin
        32 + // vltr_mint
        32 + // reward_mint
        32 + // stake_vault
        32 + // reward_vault
        8 +  // total_staked
        8 +  // total_rewards_distributed
        16 + // reward_per_token (u128)
        8 +  // last_distribution_time
        8 +  // staker_count
        1 +  // is_paused
        1 +  // bump
        1 +  // stake_vault_bump
        64;  // padding for future fields

    /// Update reward_per_token when new rewards are distributed
    /// Formula: reward_per_token += (new_rewards * PRECISION) / total_staked
    pub fn update_reward_per_token(&mut self, new_rewards: u64) -> Result<()> {
        if self.total_staked == 0 {
            // No stakers, rewards cannot be distributed
            // This shouldn't happen if called correctly
            return Ok(());
        }

        let reward_increase = (new_rewards as u128)
            .checked_mul(REWARD_PRECISION)
            .ok_or(StakingError::MathOverflow)?
            .checked_div(self.total_staked as u128)
            .ok_or(StakingError::DivisionByZero)?;

        self.reward_per_token = self
            .reward_per_token
            .checked_add(reward_increase)
            .ok_or(StakingError::MathOverflow)?;

        self.total_rewards_distributed = self
            .total_rewards_distributed
            .checked_add(new_rewards)
            .ok_or(StakingError::MathOverflow)?;

        self.last_distribution_time = Clock::get()?.unix_timestamp;

        Ok(())
    }
}
