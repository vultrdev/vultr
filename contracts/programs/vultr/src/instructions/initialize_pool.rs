// =============================================================================
// Initialize Pool Instruction
// =============================================================================
// Creates a new VULTR liquidation pool. This is called once per deposit token
// (e.g., once to create a USDC pool).
//
// What this instruction does:
// 1. Creates the Pool PDA account to store pool state
// 2. Creates the vault token account to hold deposited tokens
// 3. Creates the share mint (VLTR token) for this pool
// 4. Creates the protocol fee vault
// 5. Sets initial configuration (admin, fees, etc.)
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::state::Pool;

/// Accounts required for the initialize_pool instruction.
///
/// This is an Anchor "Accounts" struct - it defines what accounts
/// the instruction needs and how to validate them.
#[derive(Accounts)]
pub struct InitializePool<'info> {
    // =========================================================================
    // Signers
    // =========================================================================

    /// The admin who will control the pool
    /// Must sign this transaction and will be stored as pool.admin
    /// This wallet should be a multisig in production!
    #[account(mut)]
    pub admin: Signer<'info>,

    // =========================================================================
    // Pool Account (PDA - created by this instruction)
    // =========================================================================

    /// The Pool account to create
    ///
    /// Constraints explained:
    /// - init: Create this account
    /// - payer = admin: Admin pays for account rent
    /// - space: Size of the account data
    /// - seeds: PDA derivation ["pool", deposit_mint]
    /// - bump: Anchor finds the bump automatically during init
    #[account(
        init,
        payer = admin,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, deposit_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    // =========================================================================
    // Token Mints
    // =========================================================================

    /// The token users will deposit (e.g., USDC)
    /// We just need to read its address, not modify it
    pub deposit_mint: Account<'info, Mint>,

    /// The share token mint (VLTR) - created by this instruction
    ///
    /// This is a PDA-controlled mint, meaning only this program can mint/burn
    /// The mint authority is set to the pool PDA
    #[account(
        init,
        payer = admin,
        mint::decimals = SHARE_DECIMALS,
        mint::authority = pool,
        seeds = [SHARE_MINT_SEED, pool.key().as_ref()],
        bump
    )]
    pub share_mint: Account<'info, Mint>,

    // =========================================================================
    // Token Accounts (Vaults)
    // =========================================================================

    /// The vault that holds deposited tokens
    /// This is a token account owned by the pool PDA
    #[account(
        init,
        payer = admin,
        token::mint = deposit_mint,
        token::authority = pool,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// The vault that accumulates protocol fees
    /// Separate from main vault for clear accounting
    #[account(
        init,
        payer = admin,
        token::mint = deposit_mint,
        token::authority = pool,
        seeds = [PROTOCOL_FEE_VAULT_SEED, pool.key().as_ref()],
        bump
    )]
    pub protocol_fee_vault: Account<'info, TokenAccount>,

    // =========================================================================
    // Programs
    // =========================================================================

    /// The System Program - required for creating accounts
    pub system_program: Program<'info, System>,

    /// The Token Program - required for creating token accounts and mints
    pub token_program: Program<'info, Token>,
}

/// Handler function for initialize_pool
///
/// This is where the actual logic lives. The accounts have already been
/// validated by Anchor based on the constraints in InitializePool.
pub fn handler_initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
    // Get the pool account (mutable reference so we can write to it)
    let pool = &mut ctx.accounts.pool;

    // =========================================================================
    // Store account references
    // =========================================================================

    pool.admin = ctx.accounts.admin.key();
    pool.deposit_mint = ctx.accounts.deposit_mint.key();
    pool.share_mint = ctx.accounts.share_mint.key();
    pool.vault = ctx.accounts.vault.key();
    pool.protocol_fee_vault = ctx.accounts.protocol_fee_vault.key();

    // =========================================================================
    // Initialize financial state
    // =========================================================================

    pool.total_deposits = 0;
    pool.total_shares = 0;
    pool.total_profit = 0;
    pool.accumulated_protocol_fees = 0;

    // =========================================================================
    // Set default fee configuration (can be updated by admin later)
    // =========================================================================

    pool.protocol_fee_bps = PROTOCOL_FEE_BPS;
    pool.operator_fee_bps = OPERATOR_FEE_BPS;
    pool.depositor_share_bps = DEPOSITOR_SHARE_BPS;

    // Validate that fees sum to 100%
    pool.validate_fees()?;

    // =========================================================================
    // Initialize operator tracking
    // =========================================================================

    pool.operator_count = 0;

    // =========================================================================
    // Set pool status
    // =========================================================================

    pool.is_paused = false;

    // =========================================================================
    // Store PDA bumps
    // These are stored so we don't have to recalculate them every time
    // =========================================================================

    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;
    pool.share_mint_bump = ctx.bumps.share_mint;
    pool.protocol_fee_vault_bump = ctx.bumps.protocol_fee_vault;

    // Log success message
    msg!("VULTR Pool initialized successfully!");
    msg!("Pool: {}", pool.key());
    msg!("Deposit Mint: {}", pool.deposit_mint);
    msg!("Share Mint: {}", pool.share_mint);
    msg!("Vault: {}", pool.vault);

    Ok(())
}
