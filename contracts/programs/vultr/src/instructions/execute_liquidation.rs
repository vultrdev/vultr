// =============================================================================
// Execute Liquidation Instruction
// =============================================================================
// Allows registered operators to execute liquidations and earn fees.
//
// This is a MOCK implementation for testing. In production, this would:
// 1. CPI into marginfi to execute actual liquidation
// 2. Receive collateral tokens
// 3. Swap collateral for deposit token (via Jupiter/Orca)
// 4. Calculate actual profit
//
// For now, this simulates a liquidation with a provided profit amount.
//
// Profit Distribution (per liquidation):
// - 5% -> Protocol fee vault
// - 15% -> Operator (transferred directly)
// - 80% -> Pool (increases share value for depositors)
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::VultrError;
use crate::state::{Operator, OperatorStatus, Pool};

/// Accounts required for the execute_liquidation instruction
#[derive(Accounts)]
pub struct ExecuteLiquidation<'info> {
    // =========================================================================
    // Signers
    // =========================================================================

    /// The operator executing the liquidation
    /// Must be a registered, active operator
    #[account(mut)]
    pub operator_authority: Signer<'info>,

    // =========================================================================
    // Pool Accounts
    // =========================================================================

    /// The pool to execute liquidation for
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump,
        constraint = !pool.is_paused @ VultrError::PoolPaused
    )]
    pub pool: Account<'info, Pool>,

    /// The Operator account (must be active)
    #[account(
        mut,
        seeds = [OPERATOR_SEED, pool.key().as_ref(), operator_authority.key().as_ref()],
        bump = operator.bump,
        constraint = operator.authority == operator_authority.key() @ VultrError::Unauthorized,
        constraint = operator.status == OperatorStatus::Active @ VultrError::OperatorNotActive
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

    /// Pool's main vault
    /// In a real liquidation, profits would be deposited here from collateral swap
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Pool's protocol fee vault
    /// Receives the 5% protocol fee
    #[account(
        mut,
        seeds = [PROTOCOL_FEE_VAULT_SEED, pool.key().as_ref()],
        bump = pool.protocol_fee_vault_bump
    )]
    pub protocol_fee_vault: Account<'info, TokenAccount>,

    /// Operator's token account for receiving their fee
    #[account(
        mut,
        constraint = operator_token_account.mint == deposit_mint.key() @ VultrError::InvalidDepositMint,
        constraint = operator_token_account.owner == operator_authority.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub operator_token_account: Account<'info, TokenAccount>,

    // =========================================================================
    // Programs
    // =========================================================================

    pub token_program: Program<'info, Token>,
}

/// Handler for the execute_liquidation instruction
///
/// # Arguments
/// * `ctx` - The instruction context with all accounts
/// * `profit` - The profit from the liquidation (in base units)
///
/// NOTE: In production, `profit` would be calculated from the actual liquidation.
/// This mock version accepts it as a parameter for testing.
pub fn handler_execute_liquidation(ctx: Context<ExecuteLiquidation>, profit: u64) -> Result<()> {
    // =========================================================================
    // Input Validation
    // =========================================================================

    require!(profit > 0, VultrError::InvalidAmount);

    // Check operator has minimum stake
    require!(
        ctx.accounts.operator.stake_amount >= MIN_OPERATOR_STAKE,
        VultrError::InsufficientStake
    );

    msg!("Executing liquidation with profit: {}", profit);

    // =========================================================================
    // Calculate Fee Distribution
    // =========================================================================

    let pool = &ctx.accounts.pool;
    let (protocol_fee, operator_fee, depositor_profit) = pool.calculate_fee_distribution(profit)?;

    msg!("Fee distribution:");
    msg!("  Protocol fee (5%): {}", protocol_fee);
    msg!("  Operator fee (15%): {}", operator_fee);
    msg!("  Depositor profit (80%): {}", depositor_profit);

    // =========================================================================
    // Transfer Protocol Fee: Vault -> Protocol Fee Vault
    // =========================================================================

    // The vault is owned by the pool PDA
    let deposit_mint_key = ctx.accounts.deposit_mint.key();
    let pool_seeds = &[
        POOL_SEED,
        deposit_mint_key.as_ref(),
        &[ctx.accounts.pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    if protocol_fee > 0 {
        let transfer_protocol_fee_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.protocol_fee_vault.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_protocol_fee_ctx, protocol_fee)?;
    }

    // =========================================================================
    // Transfer Operator Fee: Vault -> Operator Token Account
    // =========================================================================

    if operator_fee > 0 {
        let transfer_operator_fee_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.operator_token_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_operator_fee_ctx, operator_fee)?;
    }

    // =========================================================================
    // Update Pool State
    // =========================================================================

    let pool = &mut ctx.accounts.pool;

    // The depositor profit stays in the vault, increasing share value
    // We update total_deposits to reflect this
    pool.total_deposits = pool
        .total_deposits
        .checked_add(depositor_profit)
        .ok_or(VultrError::MathOverflow)?;

    // Track total profit for statistics
    pool.total_profit = pool
        .total_profit
        .checked_add(profit)
        .ok_or(VultrError::MathOverflow)?;

    // Track accumulated protocol fees
    pool.accumulated_protocol_fees = pool
        .accumulated_protocol_fees
        .checked_add(protocol_fee)
        .ok_or(VultrError::MathOverflow)?;

    // =========================================================================
    // Update Operator State
    // =========================================================================

    let operator = &mut ctx.accounts.operator;
    let clock = Clock::get()?;

    operator.record_liquidation(profit, operator_fee, clock.unix_timestamp)?;

    // =========================================================================
    // Log Results
    // =========================================================================

    msg!("Liquidation executed successfully!");
    msg!("Total pool profit: {}", pool.total_profit);
    msg!(
        "Operator total liquidations: {}",
        ctx.accounts.operator.total_liquidations
    );
    msg!(
        "Operator total fees earned: {}",
        ctx.accounts.operator.total_fees_earned
    );

    Ok(())
}
