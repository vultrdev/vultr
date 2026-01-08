# Option 2 Implementation - Simplified Single-Step Liquidation

## Summary
Implemented simplified single-step liquidation flow for devnet testing. Marginfi integration can be added later.

## Changes Made

### 1. Share Token Renaming ✅
- **File**: `contracts/programs/vultr/src/state/pool.rs`
- Changed: "VLTR token" → "sVLTR token" in comments
- Purpose: Differentiate share token (sVLTR) from governance token (VLTR)

### 2. Per-Pool Max Size ✅
- **Files**:
  - `contracts/programs/vultr/src/state/pool.rs` - Added `max_pool_size: u64` field
  - `contracts/programs/vultr/src/constants.rs` - Added `DEFAULT_POOL_SIZE` (500K USDC)
  - `contracts/programs/vultr/src/instructions/initialize_pool.rs` - Set default to 500K
  - `contracts/programs/vultr/src/instructions/deposit.rs` - Check pool.max_pool_size instead of global constant

- **Default Cap**: 500,000 USDC (500_000_000_000 with 6 decimals)
- **Purpose**: High capital efficiency and attractive APY at launch
- **Admin Control**: Can be raised via `update_pool_cap` instruction

### 3. Update Pool Cap Admin Instruction ✅
- **File**: `contracts/programs/vultr/src/instructions/update_pool_cap.rs` (NEW)
- **Function**: `update_pool_cap(new_cap: u64)`
- **Constraints**:
  - new_cap <= MAX_POOL_SIZE (1B USDC hard limit)
  - new_cap >= current total_deposits (can't reduce below TVL)
  - new_cap != old_cap (prevent spam)
- **Error**: Added `InvalidPoolCap` to error.rs

### 4. Simplified Liquidation Flow ✅
- **File**: `contracts/programs/vultr/src/instructions/complete_liquidation.rs`
- **Changed**: 2-step → single-step liquidation

#### Old Flow (2-step):
```
1. execute_liquidation: Marginfi CPI → collateral to pool account
2. complete_liquidation: Swap collateral → distribute profits
```

#### New Flow (single-step):
```
1. complete_liquidation:
   - Transfer collateral from operator → pool temp account
   - Swap via Jupiter
   - Distribute profits
```

#### Parameter Changes:
**OLD:**
- `min_output_amount: u64`
- `liquidation_cost: u64`
- `jupiter_instruction_data: Vec<u8>`

**NEW:**
- `collateral_amount: u64` (how much collateral to swap)
- `min_output_amount: u64` (slippage protection)
- `expected_profit: u64` (validation - must meet this minimum)
- `jupiter_instruction_data: Vec<u8>`

#### Account Changes:
**ADDED:**
- `collateral_temp: Account<'info, TokenAccount>` - Pool-owned temp account for collateral

**MODIFIED:**
- `collateral_source` - Now operator-owned (was pool-owned)

#### Profit Calculation:
**OLD:** `profit = usdc_received - liquidation_cost`
**NEW:** `profit = usdc_received` (operator's external costs are their business)

### 5. Updated lib.rs ✅
- Updated `complete_liquidation` function signature with new parameters
- Updated documentation to reflect single-step flow

## Compilation Status
✅ **SUCCESS** - All contracts compile without errors

## Next Steps
1. Update bot (bot/src/executor.ts) for single-step flow
2. Generate new IDL with updated parameters
3. Deploy to devnet
4. Test liquidation flow

## Future Enhancements
- Add Marginfi CPI back as separate `execute_liquidation` instruction
- Or integrate Marginfi liquidation in bot before calling `complete_liquidation`
- Add support for multiple collateral tokens
- Implement liquidation queue/priority system

## Pool Economics
- **Initial Cap**: 500K USDC
- **Target**: High APY for early depositors
- **Growth Path**: Admin raises cap as TVL fills and liquidation volume increases
- **Self-Regulating**: High APY → deposits increase → APY normalizes → equilibrium

## Testing Plan
1. Deploy to devnet
2. Initialize pool with 500K cap
3. Register test operator
4. Add test depositors
5. Manually obtain collateral tokens (mock or real Marginfi liquidation)
6. Call `complete_liquidation` with collateral
7. Verify:
   - Jupiter swap executes
   - Fees distributed 5/15/80
   - Share price increases
   - Operator receives fee

