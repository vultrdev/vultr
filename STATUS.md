# VULTR Project Status

**Last Updated:** 2026-01-08
**Overall Completion:** ~90%
**Status:** Core complete, staking contract needed

---

## Project Overview

**VULTR** is a decentralized liquidation pool protocol on Solana:
- Depositors provide USDC capital and earn yield from liquidation profits
- Team-run bot monitors Marginfi and executes liquidations
- Profits distributed: **80% depositors** | **15% VLTR stakers** | **5% treasury**

**Program ID (Devnet):** `7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe`

---

## Current Architecture (Simplified Design)

The protocol was redesigned to remove external operators:

**Old Design (Removed):**
- External operators register and stake
- 2-step liquidation: execute_liquidation + complete_liquidation
- Complex operator management

**New Design (Current):**
- Team runs the bot internally
- `bot_wallet` field authorizes the bot
- `record_profit` instruction distributes liquidation profits
- Direct execution: Marginfi -> Jupiter -> record_profit

---

## Component Status

### Smart Contract
| Instruction | Status | Description |
|-------------|--------|-------------|
| `initialize_pool` | ✅ Done | Create pool with deposit_mint, bot_wallet |
| `deposit` | ✅ Done | Deposit USDC, receive sVLTR shares |
| `withdraw` | ✅ Done | Burn shares, receive USDC + profits |
| `record_profit` | ✅ Done | Bot records profit, auto-distributes 80/15/5 |
| `pause_pool` | ✅ Done | Emergency pause |
| `resume_pool` | ✅ Done | Resume operations |
| `update_fees` | ✅ Done | Admin adjust fee split |
| `update_pool_cap` | ✅ Done | Admin adjust TVL cap |
| `update_bot_wallet` | ✅ Done | Admin rotate bot key |
| `transfer_admin` | ✅ Done | Transfer admin rights |

### Liquidation Bot
| Component | Status | Description |
|-----------|--------|-------------|
| Marginfi Client | ✅ Done | Position monitoring, liquidation detection |
| Pyth Oracle | ✅ Done | Real-time price feeds |
| Jupiter Swap | ✅ Done | Collateral -> USDC conversion |
| Profit Calculator | ✅ Done | Opportunity analysis |
| Executor | ✅ Done | Direct liquidation + record_profit |
| VULTR Client | ✅ Done | Pool state fetching, profit recording |

### Infrastructure
| Component | Status | Description |
|-----------|--------|-------------|
| Frontend | ✅ Done | Hosted on Vercel (separate repo) |
| Supabase | ✅ Done | Live for dapp data feeds |
| Devnet Deployment | ✅ Done | Contract deployed and tested |

### Remaining
| Component | Status | Description |
|-----------|--------|-------------|
| **Staking Contract** | ❌ Not started | VLTR token staking for 15% rewards |
| VLTR Token | Pending | Will launch on PumpFun |
| Mainnet | Pending | After staking contract |

---

## Fee Distribution

```
Liquidation Profit (100%)
    │
    ├── 80% ──► Pool Vault (depositors)
    │           Share price increases automatically
    │
    ├── 15% ──► Staking Rewards Vault (VLTR stakers)
    │           Requires staking contract to claim
    │
    └── 5% ───► Treasury (protocol revenue)
```

---

## State Structures

### Pool Account
```rust
pub struct Pool {
    pub admin: Pubkey,
    pub bot_wallet: Pubkey,           // Authorized bot
    pub deposit_mint: Pubkey,          // USDC
    pub share_mint: Pubkey,            // sVLTR
    pub vault: Pubkey,                 // Holds deposits
    pub treasury: Pubkey,              // 5% fees
    pub staking_rewards_vault: Pubkey, // 15% for stakers
    pub total_deposits: u64,
    pub total_shares: u64,
    pub total_profit: u64,
    pub total_liquidations: u64,
    pub depositor_fee_bps: u16,        // 8000 = 80%
    pub staking_fee_bps: u16,          // 1500 = 15%
    pub treasury_fee_bps: u16,         // 500 = 5%
    pub is_paused: bool,
    pub max_pool_size: u64,
    pub bump: u8,
}
```

### Depositor Account
```rust
pub struct Depositor {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub shares_minted: u64,
    pub total_deposited: u64,
    pub total_withdrawn: u64,
    pub deposit_count: u32,
    pub last_deposit_timestamp: i64,
    pub last_withdrawal_timestamp: i64,
    pub bump: u8,
}
```

---

## Next Steps

1. **Build Staking Contract**
   - Simple pro-rata rewards model
   - No unstaking cooldown
   - VLTR token from PumpFun

2. **Mainnet Testing**
   - Deploy both contracts
   - Test with real liquidations

3. **Launch**
   - VLTR token on PumpFun
   - Enable staking in frontend

---

## Key Files

```
contracts/programs/vultr/src/
├── lib.rs              # Program entry
├── constants.rs        # Fee configs, seeds
├── error.rs            # Error codes
├── state/
│   ├── pool.rs         # Pool account
│   └── depositor.rs    # User positions
└── instructions/
    ├── initialize_pool.rs
    ├── deposit.rs
    ├── withdraw.rs
    ├── record_profit.rs
    ├── admin.rs
    └── update_pool_cap.rs

bot/src/
├── index.ts            # Main bot loop
├── executor.ts         # Liquidation execution
├── marginfi.ts         # Position monitoring
├── oracle.ts           # Price feeds
├── calculator.ts       # Profit analysis
└── vultr/
    ├── client.ts       # Pool state fetching
    └── recordProfit.ts # Profit distribution
```

---

## Useful Commands

```bash
# Build contracts
cd contracts && anchor build

# Test contracts
cd contracts && anchor test

# Build bot
cd bot && npm run build

# Run bot (dry-run)
cd bot && npm start
```
