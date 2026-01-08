use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

// Program ID - will be updated after first deploy
declare_id!("FdS5NH1z7uPsEFEjo7onEc1U8q2S6iwVEfdbrg5kS9yH");

#[program]
pub mod vltr_staking {
    use super::*;

    /// Initialize a new staking pool
    ///
    /// # Arguments
    /// * `ctx` - Context containing all required accounts
    ///
    /// # Accounts
    /// * `admin` - Pool admin (signer, payer)
    /// * `staking_pool` - Staking pool PDA to create
    /// * `vltr_mint` - VLTR token mint
    /// * `reward_mint` - Reward token mint (USDC)
    /// * `stake_vault` - Vault to hold staked VLTR
    /// * `reward_vault` - External reward vault
    ///
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler_initialize(ctx)
    }

    /// Stake VLTR tokens
    ///
    /// # Arguments
    /// * `ctx` - Context containing all required accounts
    /// * `amount` - Amount of VLTR to stake
    ///
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::stake::handler_stake(ctx, amount)
    }

    /// Unstake VLTR tokens (no cooldown)
    ///
    /// # Arguments
    /// * `ctx` - Context containing all required accounts
    /// * `amount` - Amount of VLTR to unstake
    ///
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        instructions::unstake::handler_unstake(ctx, amount)
    }

    /// Claim accumulated USDC rewards
    ///
    /// # Arguments
    /// * `ctx` - Context containing all required accounts
    ///
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handler_claim(ctx)
    }

    /// Distribute USDC rewards to stakers (admin only)
    ///
    /// This should be called after liquidation profits are recorded.
    /// It updates the reward_per_token so stakers can claim their share.
    ///
    /// # Arguments
    /// * `ctx` - Context containing all required accounts
    /// * `amount` - Amount of USDC to distribute
    ///
    pub fn distribute(ctx: Context<Distribute>, amount: u64) -> Result<()> {
        instructions::distribute::handler_distribute(ctx, amount)
    }

    /// Pause or unpause the staking pool (admin only)
    ///
    /// # Arguments
    /// * `ctx` - Context containing all required accounts
    /// * `paused` - Whether to pause (true) or unpause (false)
    ///
    pub fn pause_pool(ctx: Context<PausePool>, paused: bool) -> Result<()> {
        instructions::admin::pause_pool(ctx, paused)
    }

    /// Transfer admin rights to a new address (admin only)
    ///
    /// # Arguments
    /// * `ctx` - Context containing all required accounts
    ///
    pub fn transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
        instructions::admin::transfer_admin(ctx)
    }

    /// Update the reward vault address (admin only)
    ///
    /// # Arguments
    /// * `ctx` - Context containing all required accounts
    ///
    pub fn update_reward_vault(ctx: Context<UpdateRewardVault>) -> Result<()> {
        instructions::admin::update_reward_vault(ctx)
    }
}
