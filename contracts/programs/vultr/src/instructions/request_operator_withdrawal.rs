// =============================================================================
// Request Operator Withdrawal Instruction
// =============================================================================
// Starts the operator stake withdrawal flow.
//
// This is the FIRST step of a two-step withdrawal:
// 1. request_operator_withdrawal: sets status = Withdrawing and stores timestamp
// 2. deregister_operator: after cooldown passes, returns stake and closes account
//
// Cooldown is configured on the Pool as `operator_cooldown_seconds`.
// On devnet/testing, this can be set to 0 for immediate withdrawal.
// =============================================================================

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::VultrError;
use crate::state::{Operator, OperatorStatus, Pool};

/// Accounts required for request_operator_withdrawal instruction
#[derive(Accounts)]
pub struct RequestOperatorWithdrawal<'info> {
    /// Operator authority requesting withdrawal
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The pool the operator belongs to
    #[account(
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// The operator account to update
    #[account(
        mut,
        seeds = [OPERATOR_SEED, pool.key().as_ref(), authority.key().as_ref()],
        bump = operator.bump,
        constraint = operator.authority == authority.key() @ VultrError::Unauthorized,
        constraint = operator.status == OperatorStatus::Active @ VultrError::OperatorNotActive
    )]
    pub operator: Account<'info, Operator>,
}

/// Handler for request_operator_withdrawal
pub fn handler_request_operator_withdrawal(
    ctx: Context<RequestOperatorWithdrawal>,
) -> Result<()> {
    let operator = &mut ctx.accounts.operator;
    let clock = Clock::get()?;

    // Set withdrawing state and store request time
    operator.status = OperatorStatus::Withdrawing;
    operator.withdrawal_requested_at = clock.unix_timestamp;

    msg!(
        "Operator withdrawal requested at {} (cooldown {}s)",
        operator.withdrawal_requested_at,
        ctx.accounts.pool.operator_cooldown_seconds
    );

    Ok(())
}

