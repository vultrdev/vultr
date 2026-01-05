// =============================================================================
// Deregister Operator Instruction
// =============================================================================
// Allows an operator to leave the protocol and recover their stake.
//
// Flow:
// 1. Operator calls deregister
// 2. Stake is transferred back from vault to operator
// 3. Operator account is closed (rent returned to operator)
// 4. Pool operator count is decremented
//
// Future improvements:
// - Add cooldown period before stake can be withdrawn
// - Check for pending liquidations
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::VultrError;
use crate::state::{Operator, Pool};

/// Accounts required for the deregister_operator instruction
#[derive(Accounts)]
pub struct DeregisterOperator<'info> {
    // =========================================================================
    // Signers
    // =========================================================================

    /// The operator deregistering
    /// Must sign to authorize stake withdrawal
    #[account(mut)]
    pub authority: Signer<'info>,

    // =========================================================================
    // Pool Accounts
    // =========================================================================

    /// The pool to deregister from
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// The Operator account to close
    ///
    /// close = authority: When the instruction succeeds, this account is closed
    /// and the rent is returned to the authority
    #[account(
        mut,
        seeds = [OPERATOR_SEED, pool.key().as_ref(), authority.key().as_ref()],
        bump = operator.bump,
        constraint = operator.authority == authority.key() @ VultrError::Unauthorized,
        close = authority
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

    /// Operator's deposit token account (destination for returned stake)
    #[account(
        mut,
        constraint = operator_deposit_account.mint == deposit_mint.key() @ VultrError::InvalidDepositMint,
        constraint = operator_deposit_account.owner == authority.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub operator_deposit_account: Account<'info, TokenAccount>,

    /// Pool's vault (source of stake return)
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    // =========================================================================
    // Programs
    // =========================================================================

    pub token_program: Program<'info, Token>,
}

/// Handler for the deregister_operator instruction
pub fn handler_deregister_operator(ctx: Context<DeregisterOperator>) -> Result<()> {
    let operator = &ctx.accounts.operator;
    let stake_amount = operator.stake_amount;

    // =========================================================================
    // Validation
    // =========================================================================

    // Check vault has sufficient funds to return stake
    require!(
        ctx.accounts.vault.amount >= stake_amount,
        VultrError::InsufficientBalance
    );

    msg!("Deregistering operator with stake of {} tokens", stake_amount);

    // =========================================================================
    // Transfer Stake: Vault -> Operator
    // =========================================================================

    // The vault is owned by the pool PDA, so we need PDA signing
    let deposit_mint_key = ctx.accounts.deposit_mint.key();
    let pool_seeds = &[
        POOL_SEED,
        deposit_mint_key.as_ref(),
        &[ctx.accounts.pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.operator_deposit_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer_seeds,
    );

    token::transfer(transfer_ctx, stake_amount)?;

    // =========================================================================
    // Update Pool State
    // =========================================================================

    let pool = &mut ctx.accounts.pool;

    // Decrement operator count
    pool.operator_count = pool
        .operator_count
        .checked_sub(1)
        .ok_or(VultrError::MathUnderflow)?;

    // Remove stake from total deposits
    pool.total_deposits = pool
        .total_deposits
        .checked_sub(stake_amount)
        .ok_or(VultrError::MathUnderflow)?;

    // =========================================================================
    // Log Results
    // =========================================================================

    // Note: Operator account is automatically closed by Anchor due to `close = authority`

    msg!("Operator deregistered successfully!");
    msg!("Operator: {}", ctx.accounts.authority.key());
    msg!("Stake returned: {}", stake_amount);
    msg!("Pool operator count: {}", pool.operator_count);
    msg!(
        "Total liquidations performed: {}",
        ctx.accounts.operator.total_liquidations
    );
    msg!(
        "Total fees earned: {}",
        ctx.accounts.operator.total_fees_earned
    );

    Ok(())
}
