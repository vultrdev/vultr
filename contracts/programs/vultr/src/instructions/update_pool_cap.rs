// =============================================================================
// Update Pool Cap Instruction
// =============================================================================
// Allows the admin to adjust the maximum pool size (TVL cap) for this pool.
//
// This is critical for managing capital efficiency:
// - Start with lower cap (e.g., 500K USDC) for high APY at launch
// - Gradually raise cap as liquidation volume grows
// - Ensure pool size matches available liquidation opportunities
//
// Security: Only callable by pool admin
// =============================================================================

use anchor_lang::prelude::*;
use crate::state::Pool;
use crate::error::VultrError;
use crate::constants::MAX_POOL_SIZE;

/// Update the maximum pool size cap
///
/// # Arguments
/// * `new_cap` - New maximum pool size in base units (e.g., USDC with 6 decimals)
///
/// # Security
/// - Only admin can call this
/// - New cap cannot exceed global MAX_POOL_SIZE (1B USDC)
/// - New cap must be >= current total_deposits (cannot reduce below current TVL)
///
/// # Example
/// ```
/// // Raise cap from 500K to 1M USDC
/// update_pool_cap(ctx, 1_000_000_000_000) // 1M * 10^6
/// ```
#[derive(Accounts)]
pub struct UpdatePoolCap<'info> {
    /// The pool account to update
    #[account(
        mut,
        has_one = admin @ VultrError::Unauthorized
    )]
    pub pool: Account<'info, Pool>,

    /// The admin authority (must match pool.admin)
    pub admin: Signer<'info>,
}

pub fn handler_update_pool_cap(
    ctx: Context<UpdatePoolCap>,
    new_cap: u64,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let old_cap = pool.max_pool_size;

    // =========================================================================
    // Validation
    // =========================================================================

    // New cap must be greater than zero (prevent division by zero in utilization calc)
    require!(
        new_cap > 0,
        VultrError::InvalidPoolCap
    );

    // New cap cannot exceed global maximum
    require!(
        new_cap <= MAX_POOL_SIZE,
        VultrError::ExceedsMaxPoolSize
    );

    // New cap must be at least as large as current deposits
    // (Cannot reduce cap below current TVL - would break deposits)
    require!(
        new_cap >= pool.total_deposits,
        VultrError::InvalidPoolCap
    );

    // Require meaningful change (prevent spam)
    require!(
        new_cap != old_cap,
        VultrError::InvalidPoolCap
    );

    // =========================================================================
    // Update Pool Cap
    // =========================================================================

    pool.max_pool_size = new_cap;

    // =========================================================================
    // Logging
    // =========================================================================

    msg!("Pool cap updated successfully");
    msg!("Old cap: {}", old_cap);
    msg!("New cap: {}", new_cap);
    msg!("Current TVL: {}", pool.total_deposits);
    msg!("Utilization: {}%", (pool.total_deposits as u128 * 100 / new_cap as u128));

    Ok(())
}
