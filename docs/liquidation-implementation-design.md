# VULTR Liquidation Implementation Design

**Phase**: 2.1 Research & Design
**Date**: January 6, 2026
**Status**: Design Complete - Ready for Implementation

---

## Executive Summary

This document outlines the technical design for implementing real liquidation execution in the VULTR protocol. The implementation replaces the current mock liquidation with actual CPI calls to Marginfi (for liquidation) and Jupiter (for collateral-to-USDC swaps).

---

## 1. Architecture Overview

### Current Flow (Mock)
```
1. Accept profit: u64 parameter
2. Assume profit already in vault
3. Distribute fees (80/15/5)
4. Update state
```

### New Flow (Production)
```
1. Receive liquidation parameters (margin account, max collateral, min output)
2. CPI to Marginfi → Execute liquidation, receive collateral
3. CPI to Jupiter → Swap collateral to USDC
4. Calculate actual profit from swap result
5. Transfer USDC to vault
6. Distribute fees (80/15/5)
7. Update state
```

---

## 2. Marginfi Integration

### Program Details
- **Program ID**: `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`
- **Instruction**: `lending_account_liquidate`
- **Network**: Mainnet-beta

### Liquidation Mechanics
- **Trigger**: Health factor < 1.0 (using maintenance weights)
- **Fee Structure**: 5% total (2.5% to liquidator, 2.5% to insurance fund)
- **Partial Liquidation**: System sells 10-20% of collateral to restore health
- **Price Oracle**: Uses "low bias" pricing (spot price - confidence interval)

### Required Accounts
```rust
pub struct LendingAccountLiquidate<'info> {
    pub marginfi_group: Account<'info, MarginfiGroup>,

    // Asset being seized
    pub asset_bank: Account<'info, Bank>,

    // Liability being paid
    pub liab_bank: Account<'info, Bank>,

    // Liquidator (VULTR pool operator)
    pub liquidator_marginfi_account: Account<'info, MarginfiAccount>,
    pub signer: Signer<'info>,

    // Account being liquidated
    pub liquidatee_marginfi_account: Account<'info, MarginAccount>,

    // Vault authorities and accounts
    pub bank_liquidity_vault_authority: UncheckedAccount<'info>,  // PDA
    pub bank_liquidity_vault: Account<'info, TokenAccount>,
    pub bank_insurance_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
```

### Instruction Parameters
```rust
// asset_amount: Amount of collateral to liquidate (u64)
marginfi::cpi::lending_account_liquidate(
    ctx,
    asset_amount
)?;
```

### Post-Liquidation
- Collateral transferred to liquidator's token account
- Liability reduced on liquidatee's account
- System verifies health improved
- Emits `LendingAccountLiquidateEvent`

---

## 3. Jupiter Integration

### Integration Options

**Option A: jupiter-cpi crate** (Recommended)
- Official Anchor CPI client
- Auto-generated from Jupiter IDL
- Repository: https://github.com/jup-ag/jupiter-cpi
- Compatible with Anchor programs

**Option B: jupiter_interface crate**
- Community-maintained
- Compatible with anchor >=0.30.1
- Repository: https://github.com/cianyyz/jupiter_interface

**Option C: Manual CPI via invoke_signed**
- Example: https://github.com/jup-ag/sol-swap-cpi
- More manual but most flexible
- Requires handling remaining_accounts

### Swap Flow (Using jupiter-cpi)
```rust
// 1. Prepare swap instruction
use jupiter_cpi;

let swap_accounts = jupiter_cpi::accounts::Route {
    user_transfer_authority: pool_authority,
    user_source_token_account: collateral_temp_account,
    user_destination_token_account: usdc_vault,
    // ... additional accounts via remaining_accounts
};

// 2. Execute swap
let swap_result = jupiter_cpi::cpi::route(
    ctx.accounts.jupiter_program.to_account_info(),
    swap_accounts,
    route_data,  // Serialized route from Jupiter API
    in_amount,
    min_out_amount  // Slippage protection
)?;

// 3. Extract result
let usdc_received = swap_result.amount_out;
```

### Slippage Protection
- Calculate `min_output_amount = expected * (1 - max_slippage_bps / 10000)`
- Store `max_slippage_bps` in Pool state (default: 300 = 3%)
- Transaction fails if output < min_output

---

## 4. VULTR Instruction Redesign

### New Instruction: `execute_liquidation`

#### Parameters
```rust
pub fn handler_execute_liquidation(
    ctx: Context<ExecuteLiquidation>,
    // Marginfi parameters
    margin_account: Pubkey,          // Target margin account to liquidate
    asset_amount: u64,               // Amount of collateral to seize

    // Jupiter parameters
    route_data: Vec<u8>,             // Serialized Jupiter route
    min_output_amount: u64,          // Slippage protection
) -> Result<()>
```

#### Account Structure
```rust
#[derive(Accounts)]
pub struct ExecuteLiquidation<'info> {
    // ========== VULTR Accounts ==========
    #[account(mut)]
    pub operator_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.deposit_mint.as_ref()],
        bump = pool.bump,
        constraint = !pool.is_paused @ VultrError::PoolPaused
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [OPERATOR_SEED, pool.key().as_ref(), operator_authority.key().as_ref()],
        bump = operator.bump,
        constraint = operator.status == OperatorStatus::Active @ VultrError::OperatorNotActive
    )]
    pub operator: Account<'info, Operator>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [PROTOCOL_FEE_VAULT_SEED, pool.key().as_ref()],
        bump = pool.protocol_fee_vault_bump
    )]
    pub protocol_fee_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = operator_token_account.mint == pool.deposit_mint @ VultrError::InvalidDepositMint,
        constraint = operator_token_account.owner == operator_authority.key() @ VultrError::InvalidTokenAccountOwner
    )]
    pub operator_token_account: Account<'info, TokenAccount>,

    // ========== Marginfi Accounts ==========
    /// CHECK: Marginfi program
    pub marginfi_program: UncheckedAccount<'info>,

    /// CHECK: Marginfi group
    #[account(mut)]
    pub marginfi_group: UncheckedAccount<'info>,

    /// CHECK: Asset bank (collateral)
    #[account(mut)]
    pub asset_bank: UncheckedAccount<'info>,

    /// CHECK: Liability bank (debt)
    #[account(mut)]
    pub liab_bank: UncheckedAccount<'info>,

    /// CHECK: VULTR's marginfi account (as liquidator)
    #[account(mut)]
    pub liquidator_marginfi_account: UncheckedAccount<'info>,

    /// CHECK: Target marginfi account (liquidatee)
    #[account(mut)]
    pub liquidatee_marginfi_account: UncheckedAccount<'info>,

    // Marginfi vaults
    /// CHECK: Bank liquidity vault authority
    pub bank_liquidity_vault_authority: UncheckedAccount<'info>,

    /// CHECK: Bank liquidity vault
    #[account(mut)]
    pub bank_liquidity_vault: UncheckedAccount<'info>,

    /// CHECK: Bank insurance vault
    #[account(mut)]
    pub bank_insurance_vault: UncheckedAccount<'info>,

    // ========== Collateral Handling ==========
    /// Temporary account to receive collateral from Marginfi
    #[account(
        init_if_needed,
        payer = operator_authority,
        associated_token::mint = collateral_mint,
        associated_token::authority = pool
    )]
    pub collateral_temp_account: Account<'info, TokenAccount>,

    pub collateral_mint: Account<'info, Mint>,

    // ========== Jupiter Accounts ==========
    /// CHECK: Jupiter program
    pub jupiter_program: UncheckedAccount<'info>,

    // Additional Jupiter accounts passed via remaining_accounts

    // ========== Programs ==========
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
```

### Implementation Steps

```rust
pub fn handler_execute_liquidation(
    ctx: Context<ExecuteLiquidation>,
    margin_account: Pubkey,
    asset_amount: u64,
    route_data: Vec<u8>,
    min_output_amount: u64,
) -> Result<()> {
    // =========================================================================
    // Step 1: Validate Inputs
    // =========================================================================
    require!(asset_amount > 0, VultrError::InvalidAmount);
    require!(min_output_amount > 0, VultrError::InvalidAmount);
    require!(
        ctx.accounts.operator.stake_amount >= MIN_OPERATOR_STAKE,
        VultrError::InsufficientStake
    );

    msg!("Executing liquidation on margin account: {}", margin_account);
    msg!("Asset amount: {}, Min output: {}", asset_amount, min_output_amount);

    // =========================================================================
    // Step 2: CPI to Marginfi - Execute Liquidation
    // =========================================================================
    let marginfi_accounts = marginfi::cpi::accounts::LendingAccountLiquidate {
        marginfi_group: ctx.accounts.marginfi_group.to_account_info(),
        asset_bank: ctx.accounts.asset_bank.to_account_info(),
        liab_bank: ctx.accounts.liab_bank.to_account_info(),
        liquidator_marginfi_account: ctx.accounts.liquidator_marginfi_account.to_account_info(),
        signer: ctx.accounts.operator_authority.to_account_info(),
        liquidatee_marginfi_account: ctx.accounts.liquidatee_marginfi_account.to_account_info(),
        bank_liquidity_vault_authority: ctx.accounts.bank_liquidity_vault_authority.to_account_info(),
        bank_liquidity_vault: ctx.accounts.bank_liquidity_vault.to_account_info(),
        bank_insurance_vault: ctx.accounts.bank_insurance_vault.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };

    let marginfi_ctx = CpiContext::new(
        ctx.accounts.marginfi_program.to_account_info(),
        marginfi_accounts,
    );

    marginfi::cpi::lending_account_liquidate(marginfi_ctx, asset_amount)?;

    msg!("Marginfi liquidation successful, collateral received");

    // =========================================================================
    // Step 3: Get Collateral Amount
    // =========================================================================
    ctx.accounts.collateral_temp_account.reload()?;
    let collateral_received = ctx.accounts.collateral_temp_account.amount;

    require!(collateral_received > 0, VultrError::InsufficientCollateral);
    msg!("Collateral received: {}", collateral_received);

    // =========================================================================
    // Step 4: CPI to Jupiter - Swap Collateral to USDC
    // =========================================================================
    let pool_seeds = &[
        POOL_SEED,
        ctx.accounts.pool.deposit_mint.as_ref(),
        &[ctx.accounts.pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    let jupiter_accounts = jupiter_cpi::accounts::Route {
        user_transfer_authority: ctx.accounts.pool.to_account_info(),
        user_source_token_account: ctx.accounts.collateral_temp_account.to_account_info(),
        user_destination_token_account: ctx.accounts.vault.to_account_info(),
        // Additional accounts passed via remaining_accounts
    };

    let jupiter_ctx = CpiContext::new_with_signer(
        ctx.accounts.jupiter_program.to_account_info(),
        jupiter_accounts,
        signer_seeds,
    );

    let swap_result = jupiter_cpi::cpi::route(
        jupiter_ctx,
        route_data,
        collateral_received,
        min_output_amount,
    )?;

    let usdc_received = swap_result.amount_out;
    msg!("Swap completed: {} USDC received", usdc_received);

    // Validate slippage
    require!(
        usdc_received >= min_output_amount,
        VultrError::SlippageExceeded
    );

    // =========================================================================
    // Step 5: Calculate Profit
    // =========================================================================
    // In Marginfi liquidation, the liquidator pays off debt and receives collateral at a discount
    // Profit = USDC received from swap - debt paid (if any) - gas costs
    // For simplicity, we consider the full USDC received as profit since
    // the Marginfi liquidation already handles the debt payment internally

    let profit = usdc_received; // Simplified for this implementation

    msg!("Calculated profit: {}", profit);

    // =========================================================================
    // Step 6: Distribute Fees (Existing Logic)
    // =========================================================================
    let (protocol_fee, operator_fee, depositor_profit) =
        ctx.accounts.pool.calculate_fee_distribution(profit)?;

    msg!("Fee distribution:");
    msg!("  Protocol fee (5%): {}", protocol_fee);
    msg!("  Operator fee (15%): {}", operator_fee);
    msg!("  Depositor profit (80%): {}", depositor_profit);

    // Transfer protocol fee: Vault -> Protocol Fee Vault
    if protocol_fee > 0 {
        let transfer_protocol_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.protocol_fee_vault.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_protocol_ctx, protocol_fee)?;
    }

    // Transfer operator fee: Vault -> Operator Token Account
    if operator_fee > 0 {
        let transfer_operator_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.operator_token_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_operator_ctx, operator_fee)?;
    }

    // =========================================================================
    // Step 7: Update Pool State
    // =========================================================================
    let pool = &mut ctx.accounts.pool;

    pool.total_deposits = pool
        .total_deposits
        .checked_add(depositor_profit)
        .ok_or(VultrError::MathOverflow)?;

    pool.total_profit = pool
        .total_profit
        .checked_add(profit)
        .ok_or(VultrError::MathOverflow)?;

    pool.accumulated_protocol_fees = pool
        .accumulated_protocol_fees
        .checked_add(protocol_fee)
        .ok_or(VultrError::MathOverflow)?;

    // =========================================================================
    // Step 8: Update Operator State
    // =========================================================================
    let operator = &mut ctx.accounts.operator;
    let clock = Clock::get()?;

    operator.record_liquidation(profit, operator_fee, clock.unix_timestamp)?;

    msg!("Liquidation executed successfully!");
    msg!("Total pool profit: {}", pool.total_profit);

    Ok(())
}
```

---

## 5. Dependencies

### Cargo.toml Additions
```toml
[dependencies]
anchor-lang = "0.30.1"
anchor-spl = "0.30.1"

# Marginfi integration
marginfi = { git = "https://github.com/mrgnlabs/marginfi-v2", features = ["cpi"] }

# Jupiter integration (choose one)
jupiter-cpi = { git = "https://github.com/jup-ag/jupiter-cpi" }
# OR
jupiter_interface = "0.1.0"  # From crates.io
```

### IDL Requirements
- Marginfi IDL: Pulled from git dependency
- Jupiter IDL: Pulled from git dependency or crates.io

---

## 6. Error Codes

### New Errors to Add
```rust
#[error_code]
pub enum VultrError {
    // Existing errors...

    #[msg("Liquidation failed: account not liquidatable")]
    NotLiquidatable = 6070,

    #[msg("Liquidation failed: insufficient collateral received")]
    InsufficientCollateral = 6071,

    #[msg("Swap slippage exceeded maximum allowed")]
    SlippageExceeded = 6072,

    #[msg("Invalid liquidation: no profit generated")]
    NoProfit = 6073,

    #[msg("Invalid margin account")]
    InvalidMarginAccount = 6074,

    #[msg("Invalid collateral mint")]
    InvalidCollateralMint = 6075,
}
```

---

## 7. Pool State Updates

### Add Slippage Configuration
```rust
pub struct Pool {
    // Existing fields...

    /// Maximum slippage tolerance in basis points (e.g., 300 = 3%)
    pub max_slippage_bps: u16,

    /// Add 2 bytes to account size
}
```

### New Admin Instruction: `update_slippage_tolerance`
```rust
pub fn handler_update_slippage_tolerance(
    ctx: Context<UpdateSlippageTolerance>,
    max_slippage_bps: u16,
) -> Result<()> {
    require!(max_slippage_bps <= 1000, VultrError::InvalidSlippageTolerance); // Max 10%

    ctx.accounts.pool.max_slippage_bps = max_slippage_bps;

    msg!("Updated slippage tolerance to {} bps", max_slippage_bps);
    Ok(())
}
```

---

## 8. Testing Strategy

### Unit Tests
- ✅ Fee distribution calculation (already exists)
- ⚠️ New: Slippage calculation
- ⚠️ New: Profit calculation from swap result

### Integration Tests
1. **Mock Marginfi Liquidation**
   - Test with fake Marginfi program
   - Verify collateral transfer

2. **Mock Jupiter Swap**
   - Test with fake Jupiter program
   - Verify USDC output

3. **Full Flow Test**
   - Use mainnet-fork with real programs
   - Find actual liquidatable position
   - Execute full liquidation
   - Verify fee distribution

### Devnet Tests
1. Deploy to devnet
2. Create test liquidation scenario
3. Execute via bot
4. Verify results

---

## 9. Security Considerations

### Input Validation
- ✅ Validate `asset_amount > 0`
- ✅ Validate `min_output_amount > 0`
- ✅ Validate operator has sufficient stake
- ✅ Validate margin account is liquidatable (done by Marginfi)
- ✅ Validate slippage within tolerance

### Account Validation
- ✅ Verify all account ownership
- ✅ Verify PDA derivation
- ✅ Use UncheckedAccount with caution (only for external programs)
- ✅ Validate token mints match

### CPI Security
- ✅ Use proper signer seeds
- ✅ Validate external program IDs
- ✅ Handle CPI errors gracefully
- ✅ Verify post-CPI state changes

### Economic Security
- ✅ Slippage protection prevents MEV
- ✅ Operator cooldown prevents exit scamming
- ✅ Fee distribution prevents manipulation
- ⚠️ Consider front-running protection (Jito bundles in bot)

---

## 10. Deployment Checklist

### Pre-Deployment
- [ ] All dependencies added to Cargo.toml
- [ ] Program compiles without errors
- [ ] All tests pass
- [ ] Error codes documented
- [ ] Slippage configuration added to Pool
- [ ] Admin instruction for slippage added

### Devnet Deployment
- [ ] Deploy program to devnet
- [ ] Initialize test pool with USDC
- [ ] Register test operator
- [ ] Create test liquidation scenario
- [ ] Execute test liquidation successfully
- [ ] Verify fee distribution correct
- [ ] Verify state updates correct

### Mainnet Preparation
- [ ] Security audit completed
- [ ] All issues resolved
- [ ] Documentation updated
- [ ] Integration tests on mainnet-fork pass
- [ ] Emergency pause tested
- [ ] Monitoring set up

---

## 11. Timeline Estimate

| Task | Estimated Time |
|------|----------------|
| Add dependencies | 30 minutes |
| Update account structure | 2 hours |
| Implement Marginfi CPI | 4 hours |
| Implement Jupiter CPI | 4 hours |
| Add error codes | 1 hour |
| Add slippage config | 2 hours |
| Update tests | 4 hours |
| Update documentation | 2 hours |
| **TOTAL** | **~20 hours** |

---

## 12. References

- [Marginfi v2 Documentation](https://docs.marginfi.com/mfi-v2)
- [Marginfi v2 GitHub](https://github.com/mrgnlabs/marginfi-v2)
- [Jupiter CPI Example](https://github.com/jup-ag/sol-swap-cpi)
- [Jupiter CPI Crate](https://github.com/jup-ag/jupiter-cpi)
- [Jupiter Developers](https://dev.jup.ag/docs/routing)
- [jupiter_interface Crate](https://lib.rs/crates/jupiter_interface)

---

## 13. Next Steps

1. **Phase 2.2**: Add Marginfi and Jupiter dependencies to Cargo.toml
2. **Phase 2.3**: Implement account structure changes
3. **Phase 2.4**: Implement Marginfi liquidation CPI
4. **Phase 2.5**: Implement Jupiter swap CPI
5. **Phase 2.6**: Add error codes
6. **Phase 2.7**: Add slippage configuration
7. **Phase 2.8**: Update tests
8. **Phase 2.9**: Update documentation

**Estimated Completion**: End of Week 1 (5 days from now)

---

## Conclusion

The design is comprehensive and ready for implementation. The critical path is clear, and all necessary information has been gathered from official sources. The implementation will transform VULTR from a test protocol to a production-ready liquidation pool.

**Ready to proceed with Phase 2.2: Add Dependencies**
