// =============================================================================
// Deposit Instruction
// =============================================================================
// Allows users to deposit tokens into the VULTR pool and receive shares in return.
//
// Flow:
// 1. User specifies amount of deposit tokens to deposit
// 2. Program calculates shares to mint based on current pool value
// 3. Deposit tokens are transferred from user to vault
// 4. Share tokens are minted to user's share account
// 5. Depositor account is updated with statistics
//
// Share calculation:
// - First deposit: shares = deposit amount (1:1)
// - Later deposits: shares = (deposit * total_shares) / total_pool_value
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::VultrError;
use crate::state::{Depositor, Pool};

/// Accounts required for the deposit instruction
#[derive(Accounts)]
pub struct DepositToPool<'info> {
    // =========================================================================
    // Signers
    // =========================================================================

    /// The user depositing tokens
    /// Must sign to authorize the token transfer
    #[account(mut)]
    pub depositor: Signer<'info>,

    // =========================================================================
    // Pool Accounts
    // =========================================================================

    /// The pool to deposit into
    ///
    /// Constraints:
    /// - seeds: Validates this is the correct pool PDA
    /// - bump: Validates using stored bump
    /// - constraint: Pool must not be paused
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump,
        constraint = !pool.is_paused @ VultrError::PoolPaused
    )]
    pub pool: Account<'info, Pool>,

    /// The depositor's state account (tracks their deposits/shares)
    ///
    /// init_if_needed: Creates the account if it doesn't exist yet
    /// This means first-time depositors automatically get a Depositor account
    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + Depositor::INIT_SPACE,
        seeds = [DEPOSITOR_SEED, pool.key().as_ref(), depositor.key().as_ref()],
        bump
    )]
    pub depositor_account: Account<'info, Depositor>,

    // =========================================================================
    // Token Mints
    // =========================================================================

    /// The deposit token mint (e.g., USDC)
    /// Used to validate token accounts
    pub deposit_mint: Account<'info, Mint>,

    /// The share token mint (VLTR)
    /// Program will mint new shares to the user
    #[account(
        mut,
        seeds = [SHARE_MINT_SEED, pool.key().as_ref()],
        bump = pool.share_mint_bump
    )]
    pub share_mint: Account<'info, Mint>,

    // =========================================================================
    // Token Accounts
    // =========================================================================

    /// User's deposit token account (source of funds)
    #[account(
        mut,
        constraint = user_deposit_account.mint == deposit_mint.key() @ VultrError::InvalidDepositMint,
        constraint = user_deposit_account.owner == depositor.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub user_deposit_account: Account<'info, TokenAccount>,

    /// User's share token account (destination for minted shares)
    #[account(
        mut,
        constraint = user_share_account.mint == share_mint.key() @ VultrError::InvalidShareMint,
        constraint = user_share_account.owner == depositor.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    /// Pool's vault (destination for deposited tokens)
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

/// Handler for the deposit instruction
///
/// # Arguments
/// * `ctx` - The instruction context with all accounts
/// * `amount` - Amount of deposit tokens to deposit (in base units)
/// * `min_shares_out` - Minimum shares to receive (slippage protection, 0 to skip)
pub fn handler_deposit(ctx: Context<DepositToPool>, amount: u64, min_shares_out: u64) -> Result<()> {
    // =========================================================================
    // Input Validation
    // =========================================================================

    // Check amount is greater than 0
    require!(amount > 0, VultrError::InvalidAmount);

    // Check minimum deposit
    require!(amount >= MIN_DEPOSIT_AMOUNT, VultrError::BelowMinimumDeposit);

    // Check maximum single deposit
    require!(amount <= MAX_DEPOSIT_AMOUNT, VultrError::ExceedsMaxDeposit);

    // Check user has sufficient balance
    require!(
        ctx.accounts.user_deposit_account.amount >= amount,
        VultrError::InsufficientBalance
    );

    // =========================================================================
    // First Deposit Protection (Share Price Inflation Attack Prevention)
    // =========================================================================

    let pool = &ctx.accounts.pool;

    // If this is the first deposit (pool is empty), require larger minimum
    // This prevents the share price inflation attack where:
    // 1. Attacker deposits 1 token, gets 1 share
    // 2. Attacker transfers many tokens directly to vault (not through deposit)
    // 3. Share price becomes inflated, next depositor gets ~0 shares
    if pool.total_shares == 0 {
        require!(
            amount >= MIN_FIRST_DEPOSIT,
            VultrError::BelowMinimumDeposit
        );
        msg!("First deposit - requiring minimum of {} tokens", MIN_FIRST_DEPOSIT);
    }

    // =========================================================================
    // Calculate Shares to Mint
    // =========================================================================

    let shares_to_mint = pool.calculate_shares_to_mint(amount)?;

    // Ensure we're minting at least MIN_SHARES_MINTED (prevent rounding attacks)
    // This protects against attacks where share price is manipulated such that
    // deposit_amount / share_price rounds down to 0 or very small number
    require!(
        shares_to_mint >= MIN_SHARES_MINTED,
        VultrError::ShareAmountZero
    );

    // Slippage protection: ensure user receives at least min_shares_out
    // This protects against share price changes between tx submission and execution
    if min_shares_out > 0 {
        require!(
            shares_to_mint >= min_shares_out,
            VultrError::SlippageExceeded
        );
    }

    // Check pool size limit
    let new_total = pool
        .total_deposits
        .checked_add(amount)
        .ok_or(VultrError::MathOverflow)?;
    require!(new_total <= pool.max_pool_size, VultrError::ExceedsMaxPoolSize);

    msg!("Depositing {} tokens for {} shares", amount, shares_to_mint);

    // =========================================================================
    // Transfer Deposit Tokens: User -> Vault
    // =========================================================================

    // Create the transfer instruction
    // This transfers tokens from the user's account to the vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_deposit_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        },
    );

    // Execute the transfer
    token::transfer(transfer_ctx, amount)?;

    // =========================================================================
    // Mint Share Tokens to User
    // =========================================================================

    // The share mint authority is the pool PDA, so we need to sign with PDA seeds
    let deposit_mint_key = ctx.accounts.deposit_mint.key();
    let pool_seeds = &[
        POOL_SEED,
        deposit_mint_key.as_ref(),
        &[ctx.accounts.pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    // Create the mint instruction with PDA signer
    let mint_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.share_mint.to_account_info(),
            to: ctx.accounts.user_share_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer_seeds,
    );

    // Execute the mint
    token::mint_to(mint_ctx, shares_to_mint)?;

    // =========================================================================
    // Update Depositor Account (do this first to avoid borrow issues)
    // =========================================================================

    // Capture keys before mutable borrows
    let pool_key = ctx.accounts.pool.key();
    let depositor_key = ctx.accounts.depositor.key();
    let depositor_bump = ctx.bumps.depositor_account;

    // Get current timestamp
    let clock = Clock::get()?;

    let depositor_account = &mut ctx.accounts.depositor_account;

    // If this is a new depositor account, initialize it
    if depositor_account.owner == Pubkey::default() {
        depositor_account.pool = pool_key;
        depositor_account.owner = depositor_key;
        depositor_account.bump = depositor_bump;
    }

    // Record the deposit
    depositor_account.record_deposit(amount, shares_to_mint, clock.unix_timestamp)?;

    // =========================================================================
    // Update Pool State
    // =========================================================================

    let pool = &mut ctx.accounts.pool;

    pool.total_deposits = pool
        .total_deposits
        .checked_add(amount)
        .ok_or(VultrError::MathOverflow)?;

    pool.total_shares = pool
        .total_shares
        .checked_add(shares_to_mint)
        .ok_or(VultrError::MathOverflow)?;

    // =========================================================================
    // Log Results
    // =========================================================================

    msg!("Deposit successful!");
    msg!("Amount deposited: {}", amount);
    msg!("Shares minted: {}", shares_to_mint);
    msg!("New pool total deposits: {}", pool.total_deposits);
    msg!("New pool total shares: {}", pool.total_shares);

    Ok(())
}
