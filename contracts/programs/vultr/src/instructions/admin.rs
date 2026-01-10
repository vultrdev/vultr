// =============================================================================
// Admin Instructions - SECURITY ENHANCED WITH TIMELOCKS
// =============================================================================
// Administrative functions that only the pool admin can call.
//
// SECURITY ENHANCEMENTS (FIX-4, FIX-5, FIX-7):
// - All sensitive changes require 24-hour timelock
// - Two-step process: propose -> wait 24h -> finalize
// - Admin can cancel pending changes
// - Pause now tracks timestamp for emergency withdrawal
// =============================================================================

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::VultrError;
use crate::state::Pool;

// =============================================================================
// Pause Pool (Updated for FIX-6: Emergency Withdrawal)
// =============================================================================

/// Accounts required for pause_pool instruction
#[derive(Accounts)]
pub struct PausePool<'info> {
    /// The admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to pause/unpause
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
}

/// Handler for pause_pool instruction
/// Now tracks pause_timestamp for emergency withdrawal feature
pub fn handler_pause_pool(ctx: Context<PausePool>, paused: bool) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    if pool.is_paused == paused {
        msg!(
            "Pool is already {}",
            if paused { "paused" } else { "unpaused" }
        );
        return Ok(());
    }

    pool.is_paused = paused;

    // SECURITY FIX-6: Track when pool was paused for emergency withdrawal
    if paused {
        pool.pause_timestamp = clock.unix_timestamp;
        msg!("Pool PAUSED at timestamp {}. Emergency withdrawals available after {} seconds.",
            pool.pause_timestamp, EMERGENCY_TIMELOCK_SECONDS);
    } else {
        pool.pause_timestamp = 0;
        msg!("Pool UNPAUSED");
    }

    msg!(
        "Pool {} by admin {}",
        if paused { "PAUSED" } else { "UNPAUSED" },
        ctx.accounts.admin.key()
    );

    Ok(())
}

// =============================================================================
// SECURITY FIX-4: Admin Transfer with Timelock
// =============================================================================

/// Accounts required for propose_admin_transfer instruction
#[derive(Accounts)]
pub struct ProposeAdminTransfer<'info> {
    /// The current admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to transfer admin for
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// The new admin
    /// CHECK: This is just the new admin address, we just store it
    pub new_admin: UncheckedAccount<'info>,
}

/// Propose an admin transfer (24-hour timelock)
pub fn handler_propose_admin_transfer(ctx: Context<ProposeAdminTransfer>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let new_admin = ctx.accounts.new_admin.key();
    let clock = Clock::get()?;

    // Validate new admin is not zero address
    require!(new_admin != Pubkey::default(), VultrError::InvalidAddress);

    // Validate not transferring to self
    require!(new_admin != pool.admin, VultrError::InvalidAuthority);

    // Set pending admin and timestamp
    pool.pending_admin = new_admin;
    pool.admin_change_timestamp = clock.unix_timestamp;

    msg!("Admin transfer PROPOSED by {}", ctx.accounts.admin.key());
    msg!("New admin will be: {}", new_admin);
    msg!("Timelock expires at: {} (in {} seconds)",
        clock.unix_timestamp + ADMIN_TIMELOCK_SECONDS, ADMIN_TIMELOCK_SECONDS);

    Ok(())
}

/// Accounts required for finalize_admin_transfer instruction
#[derive(Accounts)]
pub struct FinalizeAdminTransfer<'info> {
    /// The current admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to finalize admin transfer for
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
}

/// Finalize an admin transfer after timelock expires
pub fn handler_finalize_admin_transfer(ctx: Context<FinalizeAdminTransfer>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Check there's a pending change
    require!(pool.pending_admin != Pubkey::default(), VultrError::NoPendingChange);

    // Check timelock has expired
    let elapsed = clock.unix_timestamp - pool.admin_change_timestamp;
    require!(elapsed >= ADMIN_TIMELOCK_SECONDS, VultrError::TimelockNotExpired);

    // Check change hasn't expired (7 days max)
    require!(elapsed <= PENDING_CHANGE_EXPIRY_SECONDS, VultrError::TimelockExpired);

    // Apply the change
    let old_admin = pool.admin;
    pool.admin = pool.pending_admin;
    pool.pending_admin = Pubkey::default();
    pool.admin_change_timestamp = 0;

    msg!("Admin transfer FINALIZED!");
    msg!("Old admin: {}", old_admin);
    msg!("New admin: {}", pool.admin);

    Ok(())
}

/// Cancel pending admin transfer
pub fn handler_cancel_admin_transfer(ctx: Context<FinalizeAdminTransfer>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(pool.pending_admin != Pubkey::default(), VultrError::NoPendingChangeToCancel);

    let cancelled_admin = pool.pending_admin;
    pool.pending_admin = Pubkey::default();
    pool.admin_change_timestamp = 0;

    msg!("Admin transfer CANCELLED. Was going to: {}", cancelled_admin);

    Ok(())
}

// =============================================================================
// SECURITY FIX-5: Bot Wallet Update with Timelock
// =============================================================================

/// Accounts required for propose_bot_wallet instruction
#[derive(Accounts)]
pub struct ProposeBotWallet<'info> {
    /// The admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to update
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// The new bot wallet address
    /// CHECK: This is just the new bot wallet address, we just store it
    pub new_bot_wallet: UncheckedAccount<'info>,
}

/// Propose a bot wallet update (24-hour timelock)
pub fn handler_propose_bot_wallet(ctx: Context<ProposeBotWallet>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let new_bot_wallet = ctx.accounts.new_bot_wallet.key();
    let clock = Clock::get()?;

    // Validate new bot wallet is not zero address
    require!(new_bot_wallet != Pubkey::default(), VultrError::InvalidAddress);

    // Set pending bot wallet and timestamp
    pool.pending_bot_wallet = new_bot_wallet;
    pool.bot_wallet_change_timestamp = clock.unix_timestamp;

    msg!("Bot wallet update PROPOSED by admin {}", ctx.accounts.admin.key());
    msg!("New bot wallet will be: {}", new_bot_wallet);
    msg!("Timelock expires at: {} (in {} seconds)",
        clock.unix_timestamp + ADMIN_TIMELOCK_SECONDS, ADMIN_TIMELOCK_SECONDS);

    Ok(())
}

/// Accounts required for finalize_bot_wallet instruction
#[derive(Accounts)]
pub struct FinalizeBotWallet<'info> {
    /// The admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to finalize bot wallet update for
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
}

/// Finalize a bot wallet update after timelock expires
pub fn handler_finalize_bot_wallet(ctx: Context<FinalizeBotWallet>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Check there's a pending change
    require!(pool.pending_bot_wallet != Pubkey::default(), VultrError::NoPendingChange);

    // Check timelock has expired
    let elapsed = clock.unix_timestamp - pool.bot_wallet_change_timestamp;
    require!(elapsed >= ADMIN_TIMELOCK_SECONDS, VultrError::TimelockNotExpired);

    // Check change hasn't expired (7 days max)
    require!(elapsed <= PENDING_CHANGE_EXPIRY_SECONDS, VultrError::TimelockExpired);

    // Apply the change
    let old_bot_wallet = pool.bot_wallet;
    pool.bot_wallet = pool.pending_bot_wallet;
    pool.pending_bot_wallet = Pubkey::default();
    pool.bot_wallet_change_timestamp = 0;

    msg!("Bot wallet update FINALIZED!");
    msg!("Old bot wallet: {}", old_bot_wallet);
    msg!("New bot wallet: {}", pool.bot_wallet);

    Ok(())
}

/// Cancel pending bot wallet update
pub fn handler_cancel_bot_wallet(ctx: Context<FinalizeBotWallet>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(pool.pending_bot_wallet != Pubkey::default(), VultrError::NoPendingChangeToCancel);

    let cancelled_bot_wallet = pool.pending_bot_wallet;
    pool.pending_bot_wallet = Pubkey::default();
    pool.bot_wallet_change_timestamp = 0;

    msg!("Bot wallet update CANCELLED. Was going to: {}", cancelled_bot_wallet);

    Ok(())
}

// =============================================================================
// SECURITY FIX-7: Fee Update with Timelock
// =============================================================================

/// Accounts required for propose_fees instruction
#[derive(Accounts)]
pub struct ProposeFees<'info> {
    /// The admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to update fees for
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
}

/// Propose a fee update (24-hour timelock)
pub fn handler_propose_fees(
    ctx: Context<ProposeFees>,
    depositor_fee_bps: u16,
    staking_fee_bps: u16,
    treasury_fee_bps: u16,
) -> Result<()> {
    // Validation
    let total_bps = (depositor_fee_bps as u32)
        .checked_add(staking_fee_bps as u32)
        .ok_or(VultrError::MathOverflow)?
        .checked_add(treasury_fee_bps as u32)
        .ok_or(VultrError::MathOverflow)?;

    require!(total_bps == 10000, VultrError::InvalidFeeConfig);
    require!(depositor_fee_bps >= 5000, VultrError::FeeExceedsMax);
    require!(staking_fee_bps <= 3000, VultrError::FeeExceedsMax);
    require!(treasury_fee_bps <= 2000, VultrError::FeeExceedsMax);

    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Set pending fees and timestamp
    pool.pending_depositor_fee_bps = depositor_fee_bps;
    pool.pending_staking_fee_bps = staking_fee_bps;
    pool.pending_treasury_fee_bps = treasury_fee_bps;
    pool.fee_change_timestamp = clock.unix_timestamp;

    msg!("Fee update PROPOSED by admin {}", ctx.accounts.admin.key());
    msg!("New fees will be: depositor={}, staking={}, treasury={}",
        depositor_fee_bps, staking_fee_bps, treasury_fee_bps);
    msg!("Timelock expires at: {} (in {} seconds)",
        clock.unix_timestamp + ADMIN_TIMELOCK_SECONDS, ADMIN_TIMELOCK_SECONDS);

    Ok(())
}

/// Accounts required for finalize_fees instruction
#[derive(Accounts)]
pub struct FinalizeFees<'info> {
    /// The admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to finalize fee update for
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
}

/// Finalize a fee update after timelock expires
pub fn handler_finalize_fees(ctx: Context<FinalizeFees>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Check there's a pending change (all fees would be 0 if no pending)
    require!(
        pool.pending_depositor_fee_bps != 0 ||
        pool.pending_staking_fee_bps != 0 ||
        pool.pending_treasury_fee_bps != 0,
        VultrError::NoPendingChange
    );

    // Check timelock has expired
    let elapsed = clock.unix_timestamp - pool.fee_change_timestamp;
    require!(elapsed >= ADMIN_TIMELOCK_SECONDS, VultrError::TimelockNotExpired);

    // Check change hasn't expired (7 days max)
    require!(elapsed <= PENDING_CHANGE_EXPIRY_SECONDS, VultrError::TimelockExpired);

    // Apply the change
    let old_depositor = pool.depositor_fee_bps;
    let old_staking = pool.staking_fee_bps;
    let old_treasury = pool.treasury_fee_bps;

    pool.depositor_fee_bps = pool.pending_depositor_fee_bps;
    pool.staking_fee_bps = pool.pending_staking_fee_bps;
    pool.treasury_fee_bps = pool.pending_treasury_fee_bps;

    // Clear pending
    pool.pending_depositor_fee_bps = 0;
    pool.pending_staking_fee_bps = 0;
    pool.pending_treasury_fee_bps = 0;
    pool.fee_change_timestamp = 0;

    // Validate
    pool.validate_fees()?;

    msg!("Fee update FINALIZED!");
    msg!("Depositor fee: {} -> {}", old_depositor, pool.depositor_fee_bps);
    msg!("Staking fee: {} -> {}", old_staking, pool.staking_fee_bps);
    msg!("Treasury fee: {} -> {}", old_treasury, pool.treasury_fee_bps);

    Ok(())
}

/// Cancel pending fee update
pub fn handler_cancel_fees(ctx: Context<FinalizeFees>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(
        pool.pending_depositor_fee_bps != 0 ||
        pool.pending_staking_fee_bps != 0 ||
        pool.pending_treasury_fee_bps != 0,
        VultrError::NoPendingChangeToCancel
    );

    pool.pending_depositor_fee_bps = 0;
    pool.pending_staking_fee_bps = 0;
    pool.pending_treasury_fee_bps = 0;
    pool.fee_change_timestamp = 0;

    msg!("Fee update CANCELLED");

    Ok(())
}

// =============================================================================
// Legacy handlers (kept for backwards compatibility during migration)
// These will be removed in a future version
// =============================================================================

/// Accounts required for update_fees instruction (DEPRECATED - use propose/finalize)
#[derive(Accounts)]
pub struct UpdateFees<'info> {
    /// The admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to update fees for
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
}

/// DEPRECATED: Use propose_fees + finalize_fees instead
/// This is kept for backwards compatibility but will be removed
pub fn handler_update_fees(
    ctx: Context<UpdateFees>,
    depositor_fee_bps: u16,
    staking_fee_bps: u16,
    treasury_fee_bps: u16,
) -> Result<()> {
    // Validation
    let total_bps = (depositor_fee_bps as u32)
        .checked_add(staking_fee_bps as u32)
        .ok_or(VultrError::MathOverflow)?
        .checked_add(treasury_fee_bps as u32)
        .ok_or(VultrError::MathOverflow)?;

    require!(total_bps == 10000, VultrError::InvalidFeeConfig);
    require!(depositor_fee_bps >= 5000, VultrError::FeeExceedsMax);
    require!(staking_fee_bps <= 3000, VultrError::FeeExceedsMax);
    require!(treasury_fee_bps <= 2000, VultrError::FeeExceedsMax);

    let pool = &mut ctx.accounts.pool;

    pool.depositor_fee_bps = depositor_fee_bps;
    pool.staking_fee_bps = staking_fee_bps;
    pool.treasury_fee_bps = treasury_fee_bps;

    pool.validate_fees()?;

    msg!("WARNING: Using deprecated instant fee update. Use propose_fees/finalize_fees instead.");

    Ok(())
}

/// Accounts required for update_bot_wallet instruction (DEPRECATED)
#[derive(Accounts)]
pub struct UpdateBotWallet<'info> {
    /// The admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to update
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// The new bot wallet address
    /// CHECK: This is just the new bot wallet address, we just store it
    pub new_bot_wallet: UncheckedAccount<'info>,
}

/// DEPRECATED: Use propose_bot_wallet + finalize_bot_wallet instead
pub fn handler_update_bot_wallet(ctx: Context<UpdateBotWallet>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let new_bot_wallet = ctx.accounts.new_bot_wallet.key();

    require!(new_bot_wallet != Pubkey::default(), VultrError::InvalidAddress);

    pool.bot_wallet = new_bot_wallet;

    msg!("WARNING: Using deprecated instant bot wallet update. Use propose_bot_wallet/finalize_bot_wallet instead.");

    Ok(())
}

/// Accounts required for transfer_admin instruction (DEPRECATED)
#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    /// The current admin must sign
    #[account(
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool to transfer admin for
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// The new admin
    /// CHECK: This is just the new admin address, we just store it
    pub new_admin: UncheckedAccount<'info>,
}

/// DEPRECATED: Use propose_admin_transfer + finalize_admin_transfer instead
pub fn handler_transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let new_admin = ctx.accounts.new_admin.key();

    require!(new_admin != Pubkey::default(), VultrError::InvalidAddress);
    require!(new_admin != pool.admin, VultrError::InvalidAuthority);

    pool.admin = new_admin;

    msg!("WARNING: Using deprecated instant admin transfer. Use propose_admin_transfer/finalize_admin_transfer instead.");

    Ok(())
}
