// =============================================================================
// Admin Instructions - NEW SIMPLIFIED DESIGN
// =============================================================================
// Administrative functions that only the pool admin can call.
//
// KEY CHANGES FROM OLD DESIGN:
// - Removed: update_operator_cooldown, update_slippage_tolerance
// - Removed: withdraw_protocol_fees (treasury is now external)
// - Added: update_bot_wallet (change authorized bot address)
// - Updated: update_fees uses new field names (staking_fee_bps, etc.)
// =============================================================================

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::VultrError;
use crate::state::Pool;

// =============================================================================
// Pause Pool
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
///
/// # Arguments
/// * `ctx` - The instruction context
/// * `paused` - true to pause, false to unpause
pub fn handler_pause_pool(ctx: Context<PausePool>, paused: bool) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    if pool.is_paused == paused {
        msg!(
            "Pool is already {}",
            if paused { "paused" } else { "unpaused" }
        );
        return Ok(());
    }

    pool.is_paused = paused;

    msg!(
        "Pool {} by admin {}",
        if paused { "PAUSED" } else { "UNPAUSED" },
        ctx.accounts.admin.key()
    );

    Ok(())
}

// =============================================================================
// Update Fees
// =============================================================================

/// Accounts required for update_fees instruction
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

/// Handler for update_fees instruction
///
/// # Arguments
/// * `depositor_fee_bps` - Depositor share (default 8000 = 80%)
/// * `staking_fee_bps` - VLTR staker share (default 1500 = 15%)
/// * `treasury_fee_bps` - Treasury share (default 500 = 5%)
///
/// Note: All three must sum to exactly 10000 (100%)
pub fn handler_update_fees(
    ctx: Context<UpdateFees>,
    depositor_fee_bps: u16,
    staking_fee_bps: u16,
    treasury_fee_bps: u16,
) -> Result<()> {
    // =========================================================================
    // Validation
    // =========================================================================

    // Check fees sum to 100%
    let total_bps = (depositor_fee_bps as u32)
        .checked_add(staking_fee_bps as u32)
        .ok_or(VultrError::MathOverflow)?
        .checked_add(treasury_fee_bps as u32)
        .ok_or(VultrError::MathOverflow)?;

    require!(total_bps == 10000, VultrError::InvalidFeeConfig);

    // Depositor share should be at least 50%
    require!(depositor_fee_bps >= 5000, VultrError::FeeExceedsMax);

    // Staking and treasury shares have reasonable limits
    require!(staking_fee_bps <= 3000, VultrError::FeeExceedsMax);
    require!(treasury_fee_bps <= 2000, VultrError::FeeExceedsMax);

    // =========================================================================
    // Update Pool State
    // =========================================================================

    let pool = &mut ctx.accounts.pool;

    let old_depositor = pool.depositor_fee_bps;
    let old_staking = pool.staking_fee_bps;
    let old_treasury = pool.treasury_fee_bps;

    pool.depositor_fee_bps = depositor_fee_bps;
    pool.staking_fee_bps = staking_fee_bps;
    pool.treasury_fee_bps = treasury_fee_bps;

    // Validate the new configuration
    pool.validate_fees()?;

    // =========================================================================
    // Log Results
    // =========================================================================

    msg!("Fees updated by admin {}", ctx.accounts.admin.key());
    msg!(
        "Depositor fee: {} -> {} BPS",
        old_depositor,
        depositor_fee_bps
    );
    msg!("Staking fee: {} -> {} BPS", old_staking, staking_fee_bps);
    msg!(
        "Treasury fee: {} -> {} BPS",
        old_treasury,
        treasury_fee_bps
    );

    Ok(())
}

// =============================================================================
// Update Bot Wallet
// =============================================================================

/// Accounts required for update_bot_wallet instruction
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

/// Handler for update_bot_wallet instruction
///
/// Updates the authorized bot wallet address. Useful for key rotation
/// or when upgrading the bot.
pub fn handler_update_bot_wallet(ctx: Context<UpdateBotWallet>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let old_bot_wallet = pool.bot_wallet;
    let new_bot_wallet = ctx.accounts.new_bot_wallet.key();

    // Validate new bot wallet is not zero address
    require!(
        new_bot_wallet != Pubkey::default(),
        VultrError::InvalidAuthority
    );

    pool.bot_wallet = new_bot_wallet;

    msg!("Bot wallet updated by admin {}", ctx.accounts.admin.key());
    msg!("Old bot wallet: {}", old_bot_wallet);
    msg!("New bot wallet: {}", new_bot_wallet);

    Ok(())
}

// =============================================================================
// Transfer Admin
// =============================================================================

/// Accounts required for transfer_admin instruction
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

/// Handler for transfer_admin instruction
pub fn handler_transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let old_admin = pool.admin;
    let new_admin = ctx.accounts.new_admin.key();

    // Validate new admin is not zero address
    require!(
        new_admin != Pubkey::default(),
        VultrError::InvalidAuthority
    );

    // Validate not transferring to self
    require!(new_admin != old_admin, VultrError::InvalidAuthority);

    pool.admin = new_admin;

    msg!("Admin transferred!");
    msg!("Old admin: {}", old_admin);
    msg!("New admin: {}", new_admin);

    Ok(())
}
