// =============================================================================
// Initialize Pool Instruction - NEW SIMPLIFIED DESIGN
// =============================================================================
// Creates a new VULTR liquidation pool.
//
// KEY CHANGES FROM OLD DESIGN:
// - Added bot_wallet parameter (the team's bot wallet address)
// - Added staking_rewards_vault (external account for VLTR staker rewards)
// - Treasury is now an external account (not a PDA)
// - Removed operator-related configuration
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::state::Pool;

/// Accounts required for the initialize_pool instruction.
#[derive(Accounts)]
pub struct InitializePool<'info> {
    // =========================================================================
    // Signers
    // =========================================================================

    /// The admin who will control the pool
    /// Must sign this transaction and will be stored as pool.admin
    #[account(mut)]
    pub admin: Signer<'info>,

    // =========================================================================
    // Pool Account (PDA - created by this instruction)
    // =========================================================================

    /// The Pool account to create
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
    pub deposit_mint: Account<'info, Mint>,

    /// The share token mint (sVLTR) - created by this instruction
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
    // Token Accounts
    // =========================================================================

    /// The vault that holds deposited tokens (PDA-owned)
    #[account(
        init,
        payer = admin,
        token::mint = deposit_mint,
        token::authority = pool,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// The treasury account for protocol fees (5%)
    /// This is an EXTERNAL token account, not a PDA
    /// Admin should create this beforehand and must own it
    #[account(
        constraint = treasury.mint == deposit_mint.key() @ crate::error::VultrError::InvalidDepositMint,
        constraint = treasury.owner == admin.key() @ crate::error::VultrError::InvalidTokenAccountOwner,
    )]
    pub treasury: Account<'info, TokenAccount>,

    /// The staking rewards vault for VLTR stakers (15%)
    /// This is an EXTERNAL token account, not a PDA
    /// Admin should create this beforehand and must own it
    #[account(
        constraint = staking_rewards_vault.mint == deposit_mint.key() @ crate::error::VultrError::InvalidDepositMint,
        constraint = staking_rewards_vault.owner == admin.key() @ crate::error::VultrError::InvalidTokenAccountOwner,
    )]
    pub staking_rewards_vault: Account<'info, TokenAccount>,

    /// The bot wallet address that will be authorized to call record_profit
    /// This is just checked as a valid pubkey
    /// CHECK: This is the team's bot wallet address, validated by admin
    pub bot_wallet: UncheckedAccount<'info>,

    // =========================================================================
    // Programs
    // =========================================================================

    /// The System Program - required for creating accounts
    pub system_program: Program<'info, System>,

    /// The Token Program - required for creating token accounts and mints
    pub token_program: Program<'info, Token>,
}

/// Handler function for initialize_pool
pub fn handler_initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // =========================================================================
    // Store account references
    // =========================================================================

    pool.admin = ctx.accounts.admin.key();
    pool.bot_wallet = ctx.accounts.bot_wallet.key();
    pool.deposit_mint = ctx.accounts.deposit_mint.key();
    pool.share_mint = ctx.accounts.share_mint.key();
    pool.vault = ctx.accounts.vault.key();
    pool.treasury = ctx.accounts.treasury.key();
    pool.staking_rewards_vault = ctx.accounts.staking_rewards_vault.key();

    // =========================================================================
    // Initialize financial state
    // =========================================================================

    pool.total_deposits = 0;
    pool.total_shares = 0;
    pool.total_profit = 0;
    pool.total_liquidations = 0;

    // =========================================================================
    // Set default fee configuration (80/15/5 split)
    // =========================================================================

    pool.depositor_fee_bps = DEPOSITOR_FEE_BPS;   // 80%
    pool.staking_fee_bps = STAKING_FEE_BPS;       // 15%
    pool.treasury_fee_bps = TREASURY_FEE_BPS;     // 5%

    // Validate that fees sum to 100%
    pool.validate_fees()?;

    // =========================================================================
    // Set pool status and configuration
    // =========================================================================

    pool.is_paused = false;
    pool.max_pool_size = DEFAULT_POOL_SIZE;

    // =========================================================================
    // Store PDA bumps
    // =========================================================================

    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;
    pool.share_mint_bump = ctx.bumps.share_mint;

    // Log success message
    msg!("VULTR Pool initialized successfully!");
    msg!("Pool: {}", pool.key());
    msg!("Bot Wallet: {}", pool.bot_wallet);
    msg!("Deposit Mint: {}", pool.deposit_mint);
    msg!("Share Mint: {}", pool.share_mint);
    msg!("Vault: {}", pool.vault);
    msg!("Treasury: {}", pool.treasury);
    msg!("Staking Rewards: {}", pool.staking_rewards_vault);

    Ok(())
}
