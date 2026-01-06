// =============================================================================
// Withdraw Instruction
// =============================================================================
// Allows users to withdraw their deposit tokens by burning their shares.
//
// Flow:
// 1. User specifies number of shares to burn
// 2. Program calculates withdrawal amount based on current share price
// 3. Share tokens are burned from user's account
// 4. Deposit tokens are transferred from vault to user
// 5. Depositor account is updated with statistics
//
// Withdrawal calculation:
// withdrawal_amount = (shares_to_burn * total_pool_value) / total_shares
//
// This automatically includes any profits from liquidations!
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::VultrError;
use crate::state::{Depositor, Pool};

/// Accounts required for the withdraw instruction
#[derive(Accounts)]
pub struct Withdraw<'info> {
    // =========================================================================
    // Signers
    // =========================================================================

    /// The user withdrawing tokens
    /// Must sign to authorize share burning
    #[account(mut)]
    pub withdrawer: Signer<'info>,

    // =========================================================================
    // Pool Accounts
    // =========================================================================

    /// The pool to withdraw from
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump,
        constraint = !pool.is_paused @ VultrError::PoolPaused
    )]
    pub pool: Account<'info, Pool>,

    /// The withdrawer's depositor state account
    #[account(
        mut,
        seeds = [DEPOSITOR_SEED, pool.key().as_ref(), withdrawer.key().as_ref()],
        bump = depositor_account.bump,
        constraint = depositor_account.owner == withdrawer.key() @ VultrError::Unauthorized
    )]
    pub depositor_account: Account<'info, Depositor>,

    // =========================================================================
    // Token Mints
    // =========================================================================

    /// The deposit token mint (e.g., USDC)
    #[account(
        constraint = deposit_mint.key() == pool.deposit_mint @ VultrError::InvalidDepositMint
    )]
    pub deposit_mint: Account<'info, Mint>,

    /// The share token mint (VLTR)
    /// Program will burn shares from user
    #[account(
        mut,
        seeds = [SHARE_MINT_SEED, pool.key().as_ref()],
        bump = pool.share_mint_bump
    )]
    pub share_mint: Account<'info, Mint>,

    // =========================================================================
    // Token Accounts
    // =========================================================================

    /// User's deposit token account (destination for withdrawn tokens)
    #[account(
        mut,
        constraint = user_deposit_account.mint == deposit_mint.key() @ VultrError::InvalidDepositMint,
        constraint = user_deposit_account.owner == withdrawer.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub user_deposit_account: Account<'info, TokenAccount>,

    /// User's share token account (source of shares to burn)
    #[account(
        mut,
        constraint = user_share_account.mint == share_mint.key() @ VultrError::InvalidShareMint,
        constraint = user_share_account.owner == withdrawer.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    /// Pool's vault (source of withdrawal tokens)
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

/// Handler for the withdraw instruction
///
/// # Arguments
/// * `ctx` - The instruction context with all accounts
/// * `shares_to_burn` - Number of share tokens to burn
pub fn handler_withdraw(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> {
    // =========================================================================
    // Input Validation
    // =========================================================================

    // Check amount is greater than 0
    require!(shares_to_burn > 0, VultrError::InvalidAmount);

    // Check user has sufficient shares
    require!(
        ctx.accounts.user_share_account.amount >= shares_to_burn,
        VultrError::InsufficientShares
    );

    // Check pool has shares to burn
    require!(
        ctx.accounts.pool.total_shares >= shares_to_burn,
        VultrError::InsufficientShares
    );

    // =========================================================================
    // Calculate Withdrawal Amount
    // =========================================================================

    let pool = &ctx.accounts.pool;
    let withdrawal_amount = pool.calculate_withdrawal_amount(shares_to_burn)?;

    // Check vault has sufficient funds
    require!(
        ctx.accounts.vault.amount >= withdrawal_amount,
        VultrError::InsufficientBalance
    );

    msg!(
        "Withdrawing {} tokens for {} shares",
        withdrawal_amount,
        shares_to_burn
    );

    // =========================================================================
    // Burn Share Tokens from User
    // =========================================================================

    // User signs for the burn (they own the shares)
    let burn_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Burn {
            mint: ctx.accounts.share_mint.to_account_info(),
            from: ctx.accounts.user_share_account.to_account_info(),
            authority: ctx.accounts.withdrawer.to_account_info(),
        },
    );

    // Execute the burn
    token::burn(burn_ctx, shares_to_burn)?;

    // =========================================================================
    // Transfer Deposit Tokens: Vault -> User
    // =========================================================================

    // The vault is owned by the pool PDA, so we need PDA signing
    let deposit_mint_key = ctx.accounts.deposit_mint.key();
    let pool_seeds = &[
        POOL_SEED,
        deposit_mint_key.as_ref(),
        &[ctx.accounts.pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    // Create the transfer instruction with PDA signer
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user_deposit_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer_seeds,
    );

    // Execute the transfer
    token::transfer(transfer_ctx, withdrawal_amount)?;

    // =========================================================================
    // Update Pool State
    // =========================================================================

    let pool = &mut ctx.accounts.pool;

    pool.total_deposits = pool
        .total_deposits
        .checked_sub(withdrawal_amount)
        .ok_or(VultrError::MathUnderflow)?;

    pool.total_shares = pool
        .total_shares
        .checked_sub(shares_to_burn)
        .ok_or(VultrError::MathUnderflow)?;

    // =========================================================================
    // Update Depositor Account
    // =========================================================================

    let depositor_account = &mut ctx.accounts.depositor_account;

    // Get current timestamp
    let clock = Clock::get()?;

    // Record the withdrawal
    depositor_account.record_withdrawal(withdrawal_amount, clock.unix_timestamp)?;

    // =========================================================================
    // Log Results
    // =========================================================================

    msg!("Withdrawal successful!");
    msg!("Shares burned: {}", shares_to_burn);
    msg!("Amount withdrawn: {}", withdrawal_amount);
    msg!("New pool total deposits: {}", pool.total_deposits);
    msg!("New pool total shares: {}", pool.total_shares);

    Ok(())
}
