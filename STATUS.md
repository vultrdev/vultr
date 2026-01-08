# VULTR Project Status

**Last Updated:** 2026-01-08
**Overall Completion:** ~95%
**Status:** Core complete, testing staking integration

---

## Project Overview

**VULTR** is a decentralized liquidation pool protocol on Solana:
- Depositors provide USDC capital and earn yield from liquidation profits
- Team-run bot monitors Marginfi and executes liquidations
- Profits distributed: **80% depositors** | **15% VLTR stakers** | **5% treasury**

**Program IDs (Devnet):**
- VULTR Pool: `7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe`
- VLTR Staking: `HGGgYd1djHrDSX1KyUiKtY9pbT9ocoGwDER6KyBBGzo4`

---

## Architecture

```
                    VULTR PROTOCOL FLOW

┌─────────────────────────────────────────────────────────┐
│                    USERS                                 │
├──────────────┬────────────────────┬─────────────────────┤
│   Depositors │                    │    VLTR Stakers     │
│   (USDC)     │                    │    (VLTR Token)     │
└──────┬───────┘                    └──────────┬──────────┘
       │                                       │
       │ deposit()                      stake()│
       ▼                                       ▼
┌──────────────────┐              ┌────────────────────────┐
│   VULTR POOL     │              │   VLTR STAKING         │
│   7EhoUeY...     │              │   HGGgYd1...           │
├──────────────────┤              ├────────────────────────┤
│ • vault (USDC)   │              │ • stake_vault (VLTR)   │
│ • share_mint     │   15% of     │ • reward_vault (USDC)  │
│ • staking_       │   profits    │ • reward_per_token     │
│   rewards_vault ─┼─────────────►│                        │
│ • treasury       │              │                        │
└────────┬─────────┘              └────────────────────────┘
         │                                     │
         │ record_profit()              claim()│
         │                                     │
┌────────┴─────────┐              ┌────────────┴───────────┐
│   LIQUIDATION    │              │   STAKING REWARDS      │
│   BOT            │              │   (USDC to stakers)    │
└──────────────────┘              └────────────────────────┘
```

---

## Component Status

### VULTR Pool Contract
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

### VLTR Staking Contract
| Instruction | Status | Description |
|-------------|--------|-------------|
| `initialize` | ✅ Done | Create staking pool with VLTR mint |
| `stake` | ✅ Done | Stake VLTR tokens to earn rewards |
| `unstake` | ✅ Done | Unstake VLTR (no cooldown) |
| `claim` | ✅ Done | Claim accumulated USDC rewards |
| `distribute` | ✅ Done | Admin distributes rewards to stakers |
| `pause_pool` | ✅ Done | Emergency pause |
| `transfer_admin` | ✅ Done | Transfer admin rights |
| `update_reward_vault` | ✅ Done | Update reward vault address |

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
| Frontend | ✅ Done | Vercel: `frontend-vultr7.vercel.app` |
| Staking UI | ✅ Done | Charts, forms, pool share visualization |
| Supabase | ✅ Done | Live for dapp data feeds |
| Devnet Deployment | ✅ Done | Both contracts deployed |

### Remaining
| Component | Status | Description |
|-----------|--------|-------------|
| VLTR Token | 🔄 Pending | Will launch on PumpFun |
| Staking Pool Init | 🔄 Pending | Need to initialize with VLTR mint |
| Bot Auto-Distribute | 🔄 Pending | Add distribute() call after record_profit |
| Mainnet | 🔄 Pending | After integration testing |

---

## Fee Distribution

```
Liquidation Profit (100%)
    │
    ├── 80% ──► Pool Vault (depositors)
    │           Share price increases automatically
    │
    ├── 15% ──► Staking Rewards Vault (VLTR stakers)
    │           Distributed via staking contract
    │
    └── 5% ───► Treasury (protocol revenue)
```

---

## State Structures

### Pool Account (VULTR)
```rust
pub struct Pool {
    pub admin: Pubkey,
    pub bot_wallet: Pubkey,
    pub deposit_mint: Pubkey,          // USDC
    pub share_mint: Pubkey,            // sVLTR
    pub vault: Pubkey,
    pub treasury: Pubkey,
    pub staking_rewards_vault: Pubkey,
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

### Staking Pool Account (VLTR Staking)
```rust
pub struct StakingPool {
    pub admin: Pubkey,
    pub vltr_mint: Pubkey,
    pub reward_mint: Pubkey,           // USDC
    pub stake_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub total_staked: u64,
    pub total_rewards_distributed: u64,
    pub reward_per_token: u128,        // Scaled by 1e18
    pub last_distribution_time: i64,
    pub staker_count: u32,
    pub is_paused: bool,
    pub bump: u8,
}
```

### Staker Account
```rust
pub struct Staker {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub staked_amount: u64,
    pub reward_debt: u128,
    pub rewards_claimed: u64,
    pub first_stake_time: i64,
    pub last_stake_time: i64,
    pub bump: u8,
}
```

---

## Next Steps

1. **Create Mock VLTR Token** (devnet testing)
2. **Initialize Staking Pool** with mock token
3. **Update Bot** to auto-distribute rewards
4. **Integration Test** full flow
5. **Launch VLTR on PumpFun**
6. **Mainnet Deployment**

---

## Key Files

```
contracts/programs/
├── vultr/src/                    # Main pool contract
│   ├── lib.rs
│   ├── instructions/
│   │   ├── deposit.rs
│   │   ├── withdraw.rs
│   │   ├── record_profit.rs
│   │   └── admin.rs
│   └── state/
│       ├── pool.rs
│       └── depositor.rs
└── vltr-staking/src/             # Staking contract
    ├── lib.rs
    ├── instructions/
    │   ├── stake.rs
    │   ├── unstake.rs
    │   ├── claim.rs
    │   └── distribute.rs
    └── state/
        ├── staking_pool.rs
        └── staker.rs

bot/src/
├── index.ts                      # Main bot loop
├── executor.ts                   # Liquidation execution
├── marginfi.ts                   # Position monitoring
└── vultr/
    ├── client.ts                 # Pool state fetching
    └── recordProfit.ts           # Profit distribution

frontend/src/
├── config/staking.ts             # Staking config (needs VLTR_MINT)
├── hooks/useStaking.ts           # Staking hooks
├── pages/Staking.tsx             # Staking page
└── components/staking/           # Staking components
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
