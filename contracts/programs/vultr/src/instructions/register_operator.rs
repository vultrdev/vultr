// =============================================================================
// Register Operator Instruction
// =============================================================================
// Allows a user to become a liquidation operator by staking deposit tokens.
//
// Requirements:
// - Must stake at least MIN_OPERATOR_STAKE (10,000 USDC)
// - Stake is transferred to the pool's vault
// - Operator gets an Operator account tracking their position
//
// Why stake?
// - Creates accountability - operators have skin in the game
// - Stake can be slashed for misbehavior (future feature)
// - Prevents spam registrations
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::VultrError;
use crate::state::{Operator, OperatorStatus, Pool};

/// Accounts required for the register_operator instruction
#[derive(Accounts)]
pub struct RegisterOperator<'info> {
    // =========================================================================
    // Signers
    // =========================================================================

    /// The user registering as an operator
    /// Must sign to authorize the stake transfer
    #[account(mut)]
    pub authority: Signer<'info>,

    // =========================================================================
    // Pool Accounts
    // =========================================================================

    /// The pool to register as an operator for
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump,
        constraint = !pool.is_paused @ VultrError::PoolPaused
    )]
    pub pool: Account<'info, Pool>,

    /// The new Operator account to create
    #[account(
        init,
        payer = authority,
        space = 8 + Operator::INIT_SPACE,
        seeds = [OPERATOR_SEED, pool.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub operator: Account<'info, Operator>,

    // =========================================================================
    // Token Mints
    // =========================================================================

    /// The deposit token mint
    pub deposit_mint: Account<'info, Mint>,

    // =========================================================================
    // Token Accounts
    // =========================================================================

    /// Operator's deposit token account (source of stake)
    #[account(
        mut,
        constraint = operator_deposit_account.mint == deposit_mint.key() @ VultrError::InvalidDepositMint,
        constraint = operator_deposit_account.owner == authority.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub operator_deposit_account: Account<'info, TokenAccount>,

    /// Pool's vault (destination for stake)
    /// Note: Operator stake goes into the main vault - it becomes part of pool capital
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    // =========================================================================
    // Programs
    // =========================================================================

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

/// Handler for the register_operator instruction
///
/// # Arguments
/// * `ctx` - The instruction context with all accounts
/// * `stake_amount` - Amount of deposit tokens to stake
pub fn handler_register_operator(ctx: Context<RegisterOperator>, stake_amount: u64) -> Result<()> {
    // =========================================================================
    // Input Validation
    // =========================================================================

    // Check stake meets minimum requirement
    require!(
        stake_amount >= MIN_OPERATOR_STAKE,
        VultrError::InsufficientStake
    );

    // Check operator has sufficient balance
    require!(
        ctx.accounts.operator_deposit_account.amount >= stake_amount,
        VultrError::InsufficientBalance
    );

    msg!(
        "Registering operator with stake of {} tokens",
        stake_amount
    );

    // =========================================================================
    // Transfer Stake: Operator -> Vault
    // =========================================================================

    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.operator_deposit_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
    );

    token::transfer(transfer_ctx, stake_amount)?;

    // =========================================================================
    // Initialize Operator Account
    // =========================================================================

    let operator = &mut ctx.accounts.operator;
    let clock = Clock::get()?;

    operator.pool = ctx.accounts.pool.key();
    operator.authority = ctx.accounts.authority.key();
    operator.stake_amount = stake_amount;
    operator.total_liquidations = 0;
    operator.total_profit_generated = 0;
    operator.total_fees_earned = 0;
    operator.last_liquidation_timestamp = 0;
    operator.registered_at = clock.unix_timestamp;
    operator.withdrawal_requested_at = 0;
    operator.status = OperatorStatus::Active;
    operator.bump = ctx.bumps.operator;

    // =========================================================================
    // Update Pool State
    // =========================================================================

    let pool = &mut ctx.accounts.pool;

    // Increment operator count
    pool.operator_count = pool
        .operator_count
        .checked_add(1)
        .ok_or(VultrError::MathOverflow)?;

    // Stake is added to total deposits (it becomes pool capital)
    // This means operator stake earns returns too!
    pool.total_deposits = pool
        .total_deposits
        .checked_add(stake_amount)
        .ok_or(VultrError::MathOverflow)?;

    // =========================================================================
    // Log Results
    // =========================================================================

    msg!("Operator registered successfully!");
    msg!("Operator: {}", ctx.accounts.authority.key());
    msg!("Stake amount: {}", stake_amount);
    msg!("Pool operator count: {}", pool.operator_count);

    Ok(())
}
