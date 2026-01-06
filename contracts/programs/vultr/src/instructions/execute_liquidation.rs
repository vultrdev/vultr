// =============================================================================
// Execute Liquidation Instruction
// =============================================================================
// Allows registered operators to execute liquidations and earn fees.
//
// This instruction performs a complete liquidation flow:
// 1. Validates the target margin account is liquidatable
// 2. Transfers loan amount from vault to Marginfi
// 3. CPI into Marginfi to execute liquidation and receive collateral
// 4. Stores collateral in temp account for Jupiter swap (next instruction)
// 5. After swap (separate instruction), distributes profits
//
// IMPORTANT: This is a two-step process:
// - Step 1: execute_liquidation (Marginfi CPI) - THIS INSTRUCTION
// - Step 2: complete_liquidation (Jupiter swap + fee distribution) - SEPARATE
//
// The split is necessary because:
// - Marginfi liquidation and Jupiter swap are both compute-heavy
// - Single transaction would exceed compute budget
// - Allows for better error handling and monitoring
//
// Profit Distribution (per liquidation):
// - 5% -> Protocol fee vault
// - 15% -> Operator (transferred directly)
// - 80% -> Pool (increases share value for depositors)
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::VultrError;
use crate::state::{Operator, OperatorStatus, Pool};

/// Accounts required for the execute_liquidation instruction
///
/// This instruction performs a Marginfi liquidation via CPI.
/// Due to compute budget constraints, the Jupiter swap and fee distribution
/// happen in a separate instruction (complete_liquidation).
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
    // VULTR Pool Accounts
    // =========================================================================

    /// The VULTR pool
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

    /// Pool's main vault (source of liquidation capital)
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    // =========================================================================
    // Marginfi Protocol Accounts
    // =========================================================================

    /// Marginfi program
    /// CHECK: Verified against known Marginfi program ID in handler
    pub marginfi_program: UncheckedAccount<'info>,

    /// Marginfi group (protocol configuration)
    /// CHECK: Marginfi program validates this
    #[account(mut)]
    pub marginfi_group: UncheckedAccount<'info>,

    /// The margin account being liquidated (liquidatee)
    /// CHECK: Marginfi program validates this
    #[account(mut)]
    pub liquidatee_marginfi_account: UncheckedAccount<'info>,

    /// Asset bank (the collateral being seized)
    /// CHECK: Marginfi program validates this
    #[account(mut)]
    pub asset_bank: UncheckedAccount<'info>,

    /// Liability bank (the loan being repaid)
    /// CHECK: Marginfi program validates this
    #[account(mut)]
    pub liab_bank: UncheckedAccount<'info>,

    // =========================================================================
    // Token Accounts for Liquidation
    // =========================================================================

    /// Asset bank liquidity vault (where collateral comes from)
    /// CHECK: Marginfi program validates this
    #[account(mut)]
    pub asset_bank_liquidity_vault: UncheckedAccount<'info>,

    /// Liability bank liquidity vault (where loan repayment goes)
    /// CHECK: Marginfi program validates this
    #[account(mut)]
    pub liab_bank_liquidity_vault: UncheckedAccount<'info>,

    /// Liquidator collateral token account (receives seized collateral)
    /// This is controlled by the pool PDA
    #[account(
        mut,
        constraint = liquidator_collateral_account.owner == pool.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub liquidator_collateral_account: Account<'info, TokenAccount>,

    /// Bank insurance vault
    /// CHECK: Marginfi program validates this
    #[account(mut)]
    pub insurance_vault: UncheckedAccount<'info>,

    /// Insurance vault authority
    /// CHECK: Marginfi program validates this
    pub insurance_vault_authority: UncheckedAccount<'info>,

    // =========================================================================
    // Oracle Accounts
    // =========================================================================

    /// Asset bank oracle (for collateral pricing)
    /// CHECK: Marginfi program validates this
    pub asset_bank_oracle: UncheckedAccount<'info>,

    /// Liability bank oracle (for loan pricing)
    /// CHECK: Marginfi program validates this
    pub liab_bank_oracle: UncheckedAccount<'info>,

    // =========================================================================
    // Token Mints
    // =========================================================================

    /// The deposit token mint (USDC)
    pub deposit_mint: Account<'info, Mint>,

    /// The collateral token mint
    pub collateral_mint: Account<'info, Mint>,

    // =========================================================================
    // Programs
    // =========================================================================

    pub token_program: Program<'info, Token>,
}

/// Marginfi Program ID (mainnet)
const MARGINFI_PROGRAM_ID: &str = "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA";

/// Handler for the execute_liquidation instruction
///
/// # Arguments
/// * `ctx` - The instruction context with all accounts
/// * `asset_amount` - Amount of liability to repay (in deposit token base units)
///
/// # Flow
/// 1. Validates Marginfi program ID
/// 2. Transfers liability amount from vault to Marginfi
/// 3. Calls Marginfi liquidate instruction via CPI
/// 4. Receives collateral in liquidator_collateral_account
/// 5. Collateral is later swapped via complete_liquidation instruction
///
/// # Returns
/// The amount of collateral received (for logging/tracking)
pub fn handler_execute_liquidation(
    ctx: Context<ExecuteLiquidation>,
    asset_amount: u64,
) -> Result<()> {
    // =========================================================================
    // Input Validation
    // =========================================================================

    require!(asset_amount > 0, VultrError::InvalidAmount);

    // Verify Marginfi program ID
    let expected_marginfi_id = MARGINFI_PROGRAM_ID.parse::<Pubkey>()
        .map_err(|_| VultrError::InvalidAuthority)?;
    require!(
        ctx.accounts.marginfi_program.key() == expected_marginfi_id,
        VultrError::InvalidAuthority
    );

    // Check operator has minimum stake
    require!(
        ctx.accounts.operator.stake_amount >= MIN_OPERATOR_STAKE,
        VultrError::InsufficientStake
    );

    msg!("Executing Marginfi liquidation");
    msg!("Asset amount to liquidate: {}", asset_amount);
    msg!("Liquidatee margin account: {}", ctx.accounts.liquidatee_marginfi_account.key());

    // =========================================================================
    // Prepare PDA Signer Seeds
    // =========================================================================

    let deposit_mint_key = ctx.accounts.deposit_mint.key();
    let pool_seeds = &[
        POOL_SEED,
        deposit_mint_key.as_ref(),
        &[ctx.accounts.pool.bump],
    ];
    let _signer_seeds = &[&pool_seeds[..]];  // Will be used in actual CPI call

    // =========================================================================
    // Call Marginfi Liquidate Instruction via Manual CPI
    // =========================================================================

    // TODO: Implement actual Marginfi liquidation CPI
    //
    // The Marginfi liquidation instruction requires:
    // 1. Instruction discriminator (8 bytes) - from Marginfi IDL
    // 2. Instruction data: asset_amount (u64)
    //
    // Example structure (to be implemented):
    // ```
    // let mut instruction_data = Vec::with_capacity(16);
    // instruction_data.extend_from_slice(&MARGINFI_LIQUIDATE_DISCRIMINATOR);
    // instruction_data.extend_from_slice(&asset_amount.to_le_bytes());
    //
    // let account_infos = vec![
    //     ctx.accounts.marginfi_group.to_account_info(),
    //     ctx.accounts.liquidatee_marginfi_account.to_account_info(),
    //     ctx.accounts.asset_bank.to_account_info(),
    //     ctx.accounts.liab_bank.to_account_info(),
    //     ctx.accounts.asset_bank_liquidity_vault.to_account_info(),
    //     ctx.accounts.liab_bank_liquidity_vault.to_account_info(),
    //     ctx.accounts.liquidator_collateral_account.to_account_info(),
    //     ctx.accounts.vault.to_account_info(),
    //     ctx.accounts.insurance_vault.to_account_info(),
    //     ctx.accounts.insurance_vault_authority.to_account_info(),
    //     ctx.accounts.asset_bank_oracle.to_account_info(),
    //     ctx.accounts.liab_bank_oracle.to_account_info(),
    //     ctx.accounts.token_program.to_account_info(),
    // ];
    //
    // let liquidate_ix = solana_program::instruction::Instruction {
    //     program_id: ctx.accounts.marginfi_program.key(),
    //     accounts: account_metas, // Convert account_infos to AccountMeta
    //     data: instruction_data,
    // };
    //
    // solana_program::program::invoke_signed(
    //     &liquidate_ix,
    //     &account_infos,
    //     signer_seeds,
    // ).map_err(|_| VultrError::MarginfiCpiFailed)?;
    // ```
    //
    // For now, we return an error to indicate this needs implementation

    msg!("⚠️  WARNING: Marginfi liquidation CPI not yet implemented");
    msg!("This instruction structure is ready but requires Marginfi IDL integration");

    return Err(VultrError::MarginfiCpiFailed.into());

    // =========================================================================
    // Validate Collateral Receipt (POST-CPI)
    // =========================================================================

    // After successful CPI:
    // let collateral_received = ctx.accounts.liquidator_collateral_account.amount;
    // require!(collateral_received > 0, VultrError::InsufficientCollateral);
    //
    // msg!("Collateral received: {}", collateral_received);
    // msg!("Collateral mint: {}", ctx.accounts.collateral_mint.key());

    // =========================================================================
    // Update Operator State (Minimal)
    // =========================================================================

    // Note: Full profit distribution happens in complete_liquidation instruction
    // Here we just track that a liquidation was attempted

    // let operator = &mut ctx.accounts.operator;
    // let clock = Clock::get()?;
    // operator.total_liquidations = operator.total_liquidations
    //     .checked_add(1)
    //     .ok_or(VultrError::MathOverflow)?;
    // operator.last_liquidation_time = clock.unix_timestamp;

    // msg!("Liquidation executed successfully!");
    // msg!("Operator total liquidations: {}", operator.total_liquidations);
    // msg!("Collateral will be swapped in complete_liquidation instruction");

    // Ok(())
}
