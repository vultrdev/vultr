# VULTR - Solana Liquidation Pool Protocol

VULTR is a decentralized liquidation pool protocol on Solana where users deposit capital to earn yield from liquidation profits.

**"Circle. Wait. Feast."**

## Overview

- **Depositors** provide liquidity (USDC) and receive VLTR share tokens
- **Operators** stake capital and execute liquidations on lending protocols (Marginfi, Kamino, etc.)
- **Profits** are distributed: 80% to depositors, 15% to operators, 5% to protocol

## Project Structure

```
vultr/
├── contracts/           # Anchor smart contracts
│   ├── programs/vultr/  # Main program source
│   └── tests/           # Integration tests
├── sdk/                 # TypeScript SDK
└── bot/                 # Liquidation bot
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (v1.17+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (v0.32+)
- [Node.js](https://nodejs.org/) (v18+)

### Build & Test

```bash
# Build the smart contract
cd contracts
anchor build

# Run tests (23 tests)
anchor test
```

### Install SDK

```bash
cd sdk
npm install
npm run build
```

### Run Liquidation Bot

```bash
cd bot
npm install
cp .env.example .env
# Edit .env with your configuration
npm start -- --dry-run  # Simulation mode
```

## Smart Contract

### Instructions

| Instruction | Description |
|-------------|-------------|
| `initialize_pool` | Create a new liquidation pool |
| `deposit` | Deposit tokens and receive shares |
| `withdraw` | Burn shares and withdraw tokens + profits |
| `register_operator` | Stake tokens to become an operator |
| `deregister_operator` | Unstake and leave as operator |
| `execute_liquidation` | Execute a liquidation (operators only) |
| `pause_pool` | Pause/unpause the pool (admin only) |
| `update_fees` | Update fee configuration (admin only) |
| `withdraw_protocol_fees` | Withdraw accumulated fees (admin only) |
| `transfer_admin` | Transfer admin rights (admin only) |

### Share Economics

VULTR uses ERC-4626 style vault mechanics:

- **First deposit**: 1:1 share ratio
- **Subsequent deposits**: `shares = (deposit × total_shares) / total_value`
- **Withdrawals**: `amount = (shares × total_value) / total_shares`

Share value increases as liquidation profits accumulate.

### Fee Distribution

On each liquidation profit:
- **80%** stays in pool (increases share value for depositors)
- **15%** goes to the operator who executed the liquidation
- **5%** goes to protocol fee vault

## SDK Usage

```typescript
import { VultrClient, USDC_MINT_DEVNET } from "@vultr/sdk";
import { Connection, Keypair } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { BN } from "bn.js";

// Create client
const connection = new Connection("https://api.devnet.solana.com");
const wallet = new Wallet(Keypair.generate());
const client = new VultrClient({ connection, wallet });

// Get pool stats
const stats = await client.getPoolStats(USDC_MINT_DEVNET);
console.log("TVL:", stats.tvl.toString());

// Deposit 100 USDC
const tx = await client.deposit(USDC_MINT_DEVNET, new BN(100_000_000));

// Get user position
const position = await client.getUserPosition(USDC_MINT_DEVNET, wallet.publicKey);
console.log("Shares:", position.shares.toString());
console.log("Value:", position.value.toString());
```

## Bot Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `WALLET_PATH` | Path to operator keypair | (required) |
| `RPC_URL` | Solana RPC endpoint | mainnet-beta |
| `MIN_PROFIT_BPS` | Minimum profit threshold | 50 (0.5%) |
| `USE_JITO` | Enable Jito MEV protection | true |
| `DRY_RUN` | Simulation mode | true |

See `bot/.env.example` for all options.

## Development

### Running Tests

```bash
cd contracts
anchor test
```

### Building SDK

```bash
cd sdk
npm run build
```

### Building Bot

```bash
cd bot
npm run build
```

## Security

- All arithmetic uses checked math to prevent overflows
- PDA-based account derivation with stored bumps
- Access control on admin functions
- Operator stake requirement (10,000 USDC minimum)

## License

MIT

## Disclaimer

This software is provided as-is. Use at your own risk. Always audit smart contracts before deploying with real funds.
