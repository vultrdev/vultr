// =============================================================================
// Complete Liquidation Instruction
// =============================================================================
// Second step of the 2-step liquidation process.
//
// This instruction:
// 1. Takes collateral received from Marginfi liquidation (Step 1)
// 2. Swaps collateral to USDC via Jupiter aggregator CPI
// 3. Calculates actual profit from the swap
// 4. Distributes profits: 80% depositors, 15% operator, 5% protocol
// 5. Updates pool and operator state
//
// Prerequisites:
// - execute_liquidation must have been called successfully
// - Collateral must be in liquidator_collateral_account
// - Pool must have sufficient vault balance for any shortfall
//
// Profit Distribution:
// - 5% -> Protocol fee vault
// - 15% -> Operator
// - 80% -> Pool depositors (increases share value)
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::VultrError;
use crate::state::{Operator, OperatorStatus, Pool};

/// Jupiter Program ID (mainnet)
const JUPITER_PROGRAM_ID: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

/// Accounts required for the complete_liquidation instruction
///
/// This instruction performs a Jupiter swap to convert collateral to USDC,
/// then distributes profits according to the protocol fee structure.
#[derive(Accounts)]
pub struct CompleteLiquidation<'info> {
    // =========================================================================
    // Signers
    // =========================================================================

    /// The operator completing the liquidation
    /// Must be the same operator who initiated execute_liquidation
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

    /// Pool's main vault (receives swapped USDC)
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Pool's protocol fee vault
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
    // Collateral Token Accounts
    // =========================================================================

    /// Source of collateral (received from Marginfi in execute_liquidation)
    /// This is controlled by the pool PDA
    #[account(
        mut,
        constraint = collateral_source.owner == pool.key() @ VultrError::InvalidTokenAccountOwner,
        constraint = collateral_source.mint == collateral_mint.key() @ VultrError::InvalidCollateralMint
    )]
    pub collateral_source: Account<'info, TokenAccount>,

    /// Temporary account for receiving swapped USDC from Jupiter
    /// This is controlled by the pool PDA
    #[account(
        mut,
        constraint = swap_destination.owner == pool.key() @ VultrError::InvalidTokenAccountOwner,
        constraint = swap_destination.mint == deposit_mint.key() @ VultrError::InvalidDepositMint
    )]
    pub swap_destination: Account<'info, TokenAccount>,

    // =========================================================================
    // Jupiter Protocol Accounts
    // =========================================================================

    /// Jupiter aggregator program
    /// CHECK: Verified against known Jupiter program ID in handler
    pub jupiter_program: UncheckedAccount<'info>,

    /// Jupiter program authority
    /// CHECK: Jupiter program validates this
    pub jupiter_program_authority: UncheckedAccount<'info>,

    /// Source token account for Jupiter (same as collateral_source)
    /// CHECK: Jupiter validates this matches swap source
    #[account(mut)]
    pub jupiter_source_token_account: UncheckedAccount<'info>,

    /// Destination token account for Jupiter (same as swap_destination)
    /// CHECK: Jupiter validates this matches swap destination
    #[account(mut)]
    pub jupiter_destination_token_account: UncheckedAccount<'info>,

    /// Jupiter swap state account
    /// CHECK: Jupiter program validates this
    #[account(mut)]
    pub jupiter_swap_state: UncheckedAccount<'info>,

    /// Jupiter event authority
    /// CHECK: Jupiter program validates this
    pub jupiter_event_authority: UncheckedAccount<'info>,

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

/// Handler for the complete_liquidation instruction
///
/// # Arguments
/// * `ctx` - The instruction context with all accounts
/// * `min_output_amount` - Minimum USDC to receive (slippage protection)
/// * `liquidation_cost` - Amount of USDC spent in Marginfi liquidation
///
/// # Flow
/// 1. Validates Jupiter program ID
/// 2. Reads collateral amount from collateral_source
/// 3. Swaps collateral to USDC via Jupiter CPI
/// 4. Calculates profit: (USDC received - liquidation_cost)
/// 5. Validates profit > 0
/// 6. Distributes fees according to pool configuration
/// 7. Updates pool and operator state
///
/// # Returns
/// Ok(()) if liquidation completes successfully
pub fn handler_complete_liquidation(
    ctx: Context<CompleteLiquidation>,
    min_output_amount: u64,
    liquidation_cost: u64,
) -> Result<()> {
    // =========================================================================
    // Input Validation
    // =========================================================================

    require!(min_output_amount > 0, VultrError::InvalidAmount);
    require!(liquidation_cost > 0, VultrError::InvalidAmount);

    // Verify Jupiter program ID
    let expected_jupiter_id = JUPITER_PROGRAM_ID.parse::<Pubkey>()
        .map_err(|_| VultrError::InvalidAuthority)?;
    require!(
        ctx.accounts.jupiter_program.key() == expected_jupiter_id,
        VultrError::InvalidAuthority
    );

    // Check operator has minimum stake
    require!(
        ctx.accounts.operator.stake_amount >= MIN_OPERATOR_STAKE,
        VultrError::InsufficientStake
    );

    msg!("Completing liquidation with Jupiter swap");
    msg!("Min output amount (slippage protection): {}", min_output_amount);
    msg!("Liquidation cost: {}", liquidation_cost);

    // =========================================================================
    // Read Collateral Amount
    // =========================================================================

    let collateral_amount = ctx.accounts.collateral_source.amount;
    require!(collateral_amount > 0, VultrError::InsufficientCollateral);

    msg!("Collateral to swap: {} {}", collateral_amount, ctx.accounts.collateral_mint.key());

    // =========================================================================
    // Prepare PDA Signer Seeds
    // =========================================================================

    let deposit_mint_key = ctx.accounts.deposit_mint.key();
    let pool_seeds = &[
        POOL_SEED,
        deposit_mint_key.as_ref(),
        &[ctx.accounts.pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    // =========================================================================
    // Call Jupiter Swap via Manual CPI
    // =========================================================================

    // TODO: Implement actual Jupiter swap CPI
    //
    // Jupiter V6 uses a `shared_accounts_route_with_token_ledger` instruction
    // The instruction requires:
    // 1. Instruction discriminator (8 bytes) - from Jupiter IDL
    // 2. Route plan (serialized swap route data)
    // 3. Input amount (u64)
    // 4. Minimum output amount (u64) - slippage protection
    //
    // Example structure (to be implemented):
    // ```
    // let mut instruction_data = Vec::new();
    // instruction_data.extend_from_slice(&JUPITER_SWAP_DISCRIMINATOR);
    //
    // // Serialize route plan (complex - contains DEX route information)
    // let route_plan = build_route_plan(
    //     ctx.accounts.collateral_mint.key(),
    //     ctx.accounts.deposit_mint.key(),
    //     collateral_amount,
    // )?;
    // instruction_data.extend_from_slice(&route_plan);
    //
    // // Add swap parameters
    // instruction_data.extend_from_slice(&collateral_amount.to_le_bytes());
    // instruction_data.extend_from_slice(&min_output_amount.to_le_bytes());
    //
    // let account_infos = vec![
    //     ctx.accounts.jupiter_program.to_account_info(),
    //     ctx.accounts.jupiter_program_authority.to_account_info(),
    //     ctx.accounts.collateral_source.to_account_info(),
    //     ctx.accounts.swap_destination.to_account_info(),
    //     ctx.accounts.jupiter_swap_state.to_account_info(),
    //     ctx.accounts.jupiter_event_authority.to_account_info(),
    //     ctx.accounts.token_program.to_account_info(),
    //     // ... additional DEX accounts based on route
    // ];
    //
    // let swap_ix = solana_program::instruction::Instruction {
    //     program_id: ctx.accounts.jupiter_program.key(),
    //     accounts: account_metas, // Convert to AccountMeta
    //     data: instruction_data,
    // };
    //
    // solana_program::program::invoke_signed(
    //     &swap_ix,
    //     &account_infos,
    //     signer_seeds,
    // ).map_err(|_| VultrError::JupiterCpiFailed)?;
    // ```
    //
    // Alternative approach: Use Jupiter SDK to build the swap transaction
    // off-chain and pass the serialized route data as an instruction parameter

    msg!("⚠️  WARNING: Jupiter swap CPI not yet implemented");
    msg!("This instruction structure is ready but requires Jupiter route building");

    // For now, simulate a successful swap for structure validation
    // In production, this section will be replaced with actual CPI
    let usdc_received = min_output_amount; // Mock: assume we got exactly min amount

    // =========================================================================
    // Calculate Profit
    // =========================================================================

    msg!("USDC received from swap: {}", usdc_received);

    // Profit = USDC received - liquidation cost
    let profit = usdc_received
        .checked_sub(liquidation_cost)
        .ok_or(VultrError::NoProfit)?;

    require!(profit > 0, VultrError::NoProfit);

    msg!("Liquidation profit: {}", profit);

    // =========================================================================
    // Calculate Fee Distribution
    // =========================================================================

    let pool = &ctx.accounts.pool;
    let (protocol_fee, operator_fee, depositor_profit) = pool.calculate_fee_distribution(profit)?;

    msg!("Fee distribution:");
    msg!("  Protocol fee ({}%): {}", pool.protocol_fee_bps / 100, protocol_fee);
    msg!("  Operator fee ({}%): {}", pool.operator_fee_bps / 100, operator_fee);
    msg!("  Depositor profit ({}%): {}", pool.depositor_share_bps / 100, depositor_profit);

    // =========================================================================
    // Transfer Swapped USDC to Vault
    // =========================================================================

    // Transfer all received USDC from swap_destination to vault
    let transfer_to_vault_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.swap_destination.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_to_vault_ctx, usdc_received)?;

    msg!("Transferred {} USDC to vault", usdc_received);

    // =========================================================================
    // Transfer Protocol Fee: Vault -> Protocol Fee Vault
    // =========================================================================

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
        msg!("Transferred {} protocol fee", protocol_fee);
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
        msg!("Transferred {} operator fee", operator_fee);
    }

    // =========================================================================
    // Update Pool State
    // =========================================================================

    let pool = &mut ctx.accounts.pool;

    // The depositor profit stays in the vault, increasing share value
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
    // Close Collateral Account (Optional Gas Optimization)
    // =========================================================================

    // Note: In production, you may want to close the collateral_source account
    // to reclaim rent. This requires the account to be empty after the swap.
    // For now, we leave it open for potential reuse.

    // =========================================================================
    // Log Results
    // =========================================================================

    msg!("✅ Liquidation completed successfully!");
    msg!("Total pool value: {}", pool.total_value());
    msg!("Total pool profit: {}", pool.total_profit);
    msg!("Operator total liquidations: {}", operator.total_liquidations);
    msg!("Operator total fees earned: {}", operator.total_fees_earned);

    Ok(())
}
