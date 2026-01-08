use anchor_lang::prelude::*;

use crate::constants::REWARD_PRECISION;
use crate::error::StakingError;

/// Per-user staking position
/// PDA: ["staker", staking_pool, owner]
#[account]
#[derive(Default)]
pub struct Staker {
    /// The staking pool this position belongs to
    pub pool: Pubkey,

    /// Owner of this staking position
    pub owner: Pubkey,

    /// Amount of VLTR tokens staked
    pub staked_amount: u64,

    /// Reward debt - used for pro-rata calculation
    /// This tracks how much reward_per_token the user has already "claimed"
    /// When claiming: pending = staked * (pool.reward_per_token - reward_debt) / PRECISION
    pub reward_debt: u128,

    /// Total rewards claimed (lifetime)
    pub rewards_claimed: u64,

    /// Timestamp of first stake
    pub first_stake_time: i64,

    /// Timestamp of last stake action
    pub last_stake_time: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl Staker {
    /// Account size for allocation
    pub const SIZE: usize = 8 + // discriminator
        32 + // pool
        32 + // owner
        8 +  // staked_amount
        16 + // reward_debt (u128)
        8 +  // rewards_claimed
        8 +  // first_stake_time
        8 +  // last_stake_time
        1 +  // bump
        32;  // padding for future fields

    /// Calculate pending rewards for this staker
    /// Formula: pending = staked_amount * (pool_reward_per_token - reward_debt) / PRECISION
    pub fn calculate_pending_rewards(&self, pool_reward_per_token: u128) -> Result<u64> {
        if self.staked_amount == 0 {
            return Ok(0);
        }

        let reward_diff = pool_reward_per_token
            .checked_sub(self.reward_debt)
            .ok_or(StakingError::MathUnderflow)?;

        let pending = (self.staked_amount as u128)
            .checked_mul(reward_diff)
            .ok_or(StakingError::MathOverflow)?
            .checked_div(REWARD_PRECISION)
            .ok_or(StakingError::DivisionByZero)?;

        // Safely convert to u64 (should fit since rewards are in USDC)
        Ok(pending.min(u64::MAX as u128) as u64)
    }

    /// Update reward_debt to current pool reward_per_token
    /// Called after claiming or when stake amount changes
    pub fn update_reward_debt(&mut self, pool_reward_per_token: u128) {
        self.reward_debt = pool_reward_per_token;
    }

    /// Record a stake action
    pub fn record_stake(&mut self, amount: u64, pool_reward_per_token: u128) -> Result<()> {
        let clock = Clock::get()?;

        if self.staked_amount == 0 {
            self.first_stake_time = clock.unix_timestamp;
        }

        self.staked_amount = self
            .staked_amount
            .checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;

        self.last_stake_time = clock.unix_timestamp;

        // Important: Update reward_debt so new stake doesn't get retroactive rewards
        self.update_reward_debt(pool_reward_per_token);

        Ok(())
    }

    /// Record an unstake action
    pub fn record_unstake(&mut self, amount: u64, pool_reward_per_token: u128) -> Result<()> {
        require!(
            self.staked_amount >= amount,
            StakingError::InsufficientStake
        );

        self.staked_amount = self
            .staked_amount
            .checked_sub(amount)
            .ok_or(StakingError::MathUnderflow)?;

        self.last_stake_time = Clock::get()?.unix_timestamp;

        // Update reward_debt
        self.update_reward_debt(pool_reward_per_token);

        Ok(())
    }

    /// Record a claim action
    pub fn record_claim(&mut self, amount: u64, pool_reward_per_token: u128) -> Result<()> {
        self.rewards_claimed = self
            .rewards_claimed
            .checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;

        // Update reward_debt to prevent double-claiming
        self.update_reward_debt(pool_reward_per_token);

        Ok(())
    }
}
