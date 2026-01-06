// =============================================================================
// Admin Instructions
// =============================================================================
// Administrative functions that only the pool admin can call.
//
// Functions:
// - pause_pool: Emergency pause/unpause
// - update_fees: Adjust fee percentages
// - withdraw_protocol_fees: Collect accumulated protocol fees
// - transfer_admin: Transfer admin rights to new address
//
// Security:
// - All functions require admin signature
// - Admin should be a multisig in production
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

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

    // Check if already in the desired state
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
/// * `ctx` - The instruction context
/// * `protocol_fee_bps` - New protocol fee (0-10000)
/// * `operator_fee_bps` - New operator fee (0-10000)
/// * `depositor_share_bps` - New depositor share (0-10000)
///
/// Note: All three must sum to exactly 10000 (100%)
pub fn handler_update_fees(
    ctx: Context<UpdateFees>,
    protocol_fee_bps: u16,
    operator_fee_bps: u16,
    depositor_share_bps: u16,
) -> Result<()> {
    // =========================================================================
    // Validation
    // =========================================================================

    // Check fees sum to 100%
    let total_bps = (protocol_fee_bps as u32)
        .checked_add(operator_fee_bps as u32)
        .ok_or(VultrError::MathOverflow)?
        .checked_add(depositor_share_bps as u32)
        .ok_or(VultrError::MathOverflow)?;

    require!(total_bps == 10000, VultrError::InvalidFeeConfig);

    // Optional: Add maximum limits for individual fees
    // e.g., protocol fee shouldn't exceed 20%
    require!(protocol_fee_bps <= 2000, VultrError::FeeExceedsMax);
    require!(operator_fee_bps <= 3000, VultrError::FeeExceedsMax);

    // =========================================================================
    // Update Pool State
    // =========================================================================

    let pool = &mut ctx.accounts.pool;

    let old_protocol = pool.protocol_fee_bps;
    let old_operator = pool.operator_fee_bps;
    let old_depositor = pool.depositor_share_bps;

    pool.protocol_fee_bps = protocol_fee_bps;
    pool.operator_fee_bps = operator_fee_bps;
    pool.depositor_share_bps = depositor_share_bps;

    // Validate the new configuration
    pool.validate_fees()?;

    // =========================================================================
    // Log Results
    // =========================================================================

    msg!("Fees updated by admin {}", ctx.accounts.admin.key());
    msg!(
        "Protocol fee: {} -> {} BPS",
        old_protocol,
        protocol_fee_bps
    );
    msg!("Operator fee: {} -> {} BPS", old_operator, operator_fee_bps);
    msg!(
        "Depositor share: {} -> {} BPS",
        old_depositor,
        depositor_share_bps
    );

    Ok(())
}

// =============================================================================
// Update Operator Cooldown
// =============================================================================

/// Accounts required for update_operator_cooldown instruction
#[derive(Accounts)]
pub struct UpdateOperatorCooldown<'info> {
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
}

/// Handler for update_operator_cooldown instruction
///
/// # Arguments
/// * `cooldown_seconds` - Cooldown in seconds (0 = immediate after request)
pub fn handler_update_operator_cooldown(
    ctx: Context<UpdateOperatorCooldown>,
    cooldown_seconds: i64,
) -> Result<()> {
    require!(cooldown_seconds >= 0, VultrError::InvalidAmount);

    let pool = &mut ctx.accounts.pool;
    let old = pool.operator_cooldown_seconds;
    pool.operator_cooldown_seconds = cooldown_seconds;

    msg!(
        "Operator cooldown updated by admin {}: {}s -> {}s",
        ctx.accounts.admin.key(),
        old,
        cooldown_seconds
    );

    Ok(())
}

// =============================================================================
// Withdraw Protocol Fees
// =============================================================================

/// Accounts required for withdraw_protocol_fees instruction
#[derive(Accounts)]
pub struct WithdrawProtocolFees<'info> {
    /// The admin must sign
    #[account(
        mut,
        constraint = admin.key() == pool.admin @ VultrError::AdminOnly
    )]
    pub admin: Signer<'info>,

    /// The pool
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// The deposit mint
    pub deposit_mint: Account<'info, Mint>,

    /// The protocol fee vault (source)
    #[account(
        mut,
        seeds = [PROTOCOL_FEE_VAULT_SEED, pool.key().as_ref()],
        bump = pool.protocol_fee_vault_bump
    )]
    pub protocol_fee_vault: Account<'info, TokenAccount>,

    /// Admin's token account (destination)
    #[account(
        mut,
        constraint = admin_token_account.mint == deposit_mint.key() @ VultrError::InvalidDepositMint,
        constraint = admin_token_account.owner == admin.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub admin_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Handler for withdraw_protocol_fees instruction
///
/// Withdraws accumulated protocol fees to the admin's token account.
pub fn handler_withdraw_protocol_fees(ctx: Context<WithdrawProtocolFees>) -> Result<()> {
    let amount = ctx.accounts.protocol_fee_vault.amount;

    // Check there are fees to withdraw
    require!(amount > 0, VultrError::InsufficientBalance);

    msg!("Withdrawing {} protocol fees", amount);

    // =========================================================================
    // Transfer Fees: Protocol Fee Vault -> Admin
    // =========================================================================

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
            from: ctx.accounts.protocol_fee_vault.to_account_info(),
            to: ctx.accounts.admin_token_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer_seeds,
    );

    token::transfer(transfer_ctx, amount)?;

    // =========================================================================
    // Reset Accumulated Fees Tracker
    // =========================================================================

    let pool = &mut ctx.accounts.pool;
    pool.accumulated_protocol_fees = 0;

    // =========================================================================
    // Log Results
    // =========================================================================

    msg!("Protocol fees withdrawn successfully!");
    msg!("Amount: {}", amount);
    msg!("Recipient: {}", ctx.accounts.admin.key());

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

    /// The new admin (doesn't need to sign - it's a gift!)
    /// CHECK: This is just the new admin address, we just store it
    pub new_admin: UncheckedAccount<'info>,
}

/// Handler for transfer_admin instruction
///
/// # Arguments
/// * `ctx` - The instruction context
///
/// NOTE: In production, consider a two-step transfer where new admin must accept
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
