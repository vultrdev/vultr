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
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
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
    /// Boxed to reduce stack usage
    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump,
        constraint = !pool.is_paused @ VultrError::PoolPaused
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// The Operator account (must be active)
    /// Boxed to reduce stack usage
    #[account(
        mut,
        seeds = [OPERATOR_SEED, pool.key().as_ref(), operator_authority.key().as_ref()],
        bump = operator.bump,
        constraint = operator.authority == operator_authority.key() @ VultrError::Unauthorized,
        constraint = operator.status == OperatorStatus::Active @ VultrError::OperatorNotActive
    )]
    pub operator: Box<Account<'info, Operator>>,

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
    // Note: Most Jupiter accounts are passed via remaining_accounts to reduce
    // stack size and support variable swap routes. Only the program ID is
    // explicitly defined here.

    /// Jupiter aggregator program
    /// CHECK: Verified against known Jupiter program ID in handler
    pub jupiter_program: UncheckedAccount<'info>,

    // Additional Jupiter accounts (program authority, swap state, event authority,
    // DEX-specific accounts) should be passed via ctx.remaining_accounts.
    // The specific accounts needed depend on the swap route chosen by Jupiter.

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
/// * `jupiter_instruction_data` - Serialized Jupiter swap instruction data (built off-chain by bot)
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
    jupiter_instruction_data: Vec<u8>,
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
    // Call Jupiter Swap via CPI
    // =========================================================================
    //
    // Jupiter V6 swap flow:
    // 1. Bot builds complete Jupiter swap instruction off-chain using Jupiter SDK
    // 2. Bot passes instruction data as parameter: jupiter_instruction_data
    // 3. Bot passes all route-specific accounts via ctx.remaining_accounts
    // 4. We execute the CPI with pool PDA as signer (owner of collateral)
    //
    // The Jupiter instruction data includes:
    // - Instruction discriminator
    // - Route plan
    // - Swap parameters (amounts, slippage)
    //
    // The remaining_accounts include all accounts needed for the specific route:
    // - Token accounts for intermediate swaps
    // - AMM/DEX program accounts
    // - Oracle accounts
    // - etc.

    msg!("Executing Jupiter swap via CPI");
    msg!("Jupiter instruction data length: {} bytes", jupiter_instruction_data.len());
    msg!("Remaining accounts for swap route: {}", ctx.remaining_accounts.len());

    // Validate we have instruction data
    require!(
        !jupiter_instruction_data.is_empty(),
        VultrError::InvalidInstruction
    );

    // Validate we have remaining accounts for the route
    require!(
        !ctx.remaining_accounts.is_empty(),
        VultrError::MissingRequiredAccounts
    );

    // Record balance before swap for profit calculation
    let balance_before = ctx.accounts.swap_destination.amount;

    // Build account metas from remaining_accounts
    // The bot must pass these in the exact order Jupiter expects
    let account_metas: Vec<AccountMeta> = ctx.remaining_accounts
        .iter()
        .map(|acc| {
            if acc.is_writable {
                AccountMeta::new(*acc.key, acc.is_signer)
            } else {
                AccountMeta::new_readonly(*acc.key, acc.is_signer)
            }
        })
        .collect();

    // Build Jupiter swap instruction
    let swap_instruction = Instruction {
        program_id: ctx.accounts.jupiter_program.key(),
        accounts: account_metas,
        data: jupiter_instruction_data,
    };

    // Collect all account infos for CPI
    // We just pass the remaining_accounts directly since they contain all needed accounts
    let account_infos = ctx.remaining_accounts;

    // Execute Jupiter swap CPI with pool PDA as signer
    invoke_signed(
        &swap_instruction,
        account_infos,
        signer_seeds,
    ).map_err(|e| {
        msg!("Jupiter CPI failed: {:?}", e);
        VultrError::JupiterCpiFailed
    })?;

    msg!("✓ Jupiter swap executed successfully");

    // =========================================================================
    // Read Swap Result
    // =========================================================================

    // Reload swap_destination account to get updated balance
    ctx.accounts.swap_destination.reload()?;
    let balance_after = ctx.accounts.swap_destination.amount;

    // Calculate USDC received from swap
    let usdc_received = balance_after
        .checked_sub(balance_before)
        .ok_or(VultrError::ArithmeticError)?;

    msg!("USDC received from swap: {}", usdc_received);

    // Validate slippage protection
    require!(
        usdc_received >= min_output_amount,
        VultrError::SlippageExceeded
    );

    msg!("✓ Slippage check passed (min: {}, actual: {})", min_output_amount, usdc_received);

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
