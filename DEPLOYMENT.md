# VULTR Devnet Deployment Guide

**Status:** Ready to deploy, awaiting sufficient devnet SOL
**Date:** 2026-01-06
**Program Built:** ✅ Yes
**Program Keypair:** ✅ Generated

---

## 🎯 Current Progress

### ✅ Completed Steps:

1. **Contract Built** ✅
   ```bash
   cd contracts && anchor build
   ```
   - Binary: `target/deploy/vultr.so`
   - Size: ~400KB (typical for Anchor programs)
   - Compilation: Successful

2. **Program Keypair Generated** ✅
   - Location: `contracts/target/deploy/vultr-keypair.json`
   - Program ID: `7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe`
   - Seed phrase saved (for recovery if needed)

3. **Test Wallet Prepared** ✅
   - Location: `bot/test-wallet.json`
   - Address: `2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj`
   - Balance: 2 SOL (need ~5 SOL total for deployment)

### ⏸️ Blocked Step:

**Funding Wallet:**
- **Issue:** Devnet airdrop rate limit reached
- **Required:** ~5 SOL total (4.13 SOL for deployment + 0.87 SOL buffer)
- **Current:** 2 SOL
- **Needed:** 3 more SOL

---

## 🚀 How to Complete Deployment

### Option 1: Wait for Airdrop Rate Limit (Recommended)

Devnet airdrops reset periodically. Wait 1-24 hours and try:

```bash
# Check current balance
solana balance -k bot/test-wallet.json --url devnet

# Request more SOL (may need multiple attempts)
solana airdrop 2 -k bot/test-wallet.json --url devnet
solana airdrop 1 -k bot/test-wallet.json --url devnet

# Verify you have ~5 SOL
solana balance -k bot/test-wallet.json --url devnet
```

### Option 2: Use Devnet Faucet Website

Visit one of these devnet faucets:
- https://faucet.solana.com/
- https://solfaucet.com/
- https://faucet.quicknode.com/solana/devnet

Enter address: `2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj`

### Option 3: Use Alternative Devnet Wallet

If you have another devnet wallet with SOL:

```bash
# Transfer SOL to test wallet
solana transfer --from your-wallet.json \
  2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj \
  5 \
  --url devnet
```

---

## 📋 Complete Deployment Steps

Once you have ~5 SOL in the test wallet, run:

### 1. Deploy Program

```bash
cd contracts

anchor deploy \
  --provider.cluster devnet \
  --provider.wallet ../bot/test-wallet.json \
  --program-keypair target/deploy/vultr-keypair.json \
  --program-name vultr
```

**Expected Output:**
```
Deploying cluster: https://api.devnet.solana.com
Upgrade authority: ../bot/test-wallet.json
Deploying program "vultr"...
Program path: /mnt/c/VULTR/vultr/contracts/target/deploy/vultr.so...
Program Id: 7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe
Deploy success
```

### 2. Update Program ID in Codebase

After successful deployment, update the program ID:

**File:** `contracts/Anchor.toml`
```toml
[programs.devnet]
vultr = "7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe"
```

**File:** `contracts/programs/vultr/src/lib.rs`
```rust
declare_id!("7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe");
```

**File:** `bot/.env.devnet`
```env
VULTR_PROGRAM_ID=7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe
```

**File:** `sdk/src/constants.ts`
```typescript
export const VULTR_PROGRAM_ID = new PublicKey(
  "7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe"
);
```

### 3. Regenerate IDL

```bash
cd contracts
anchor build
cp target/idl/vultr.json ../bot/src/idl/
cp target/idl/vultr.json ../sdk/src/idl/
```

### 4. Verify Deployment

```bash
# Check program exists
solana program show 7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe --url devnet

# Check upgrade authority
# Should show: 2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj
```

---

## 🔧 Post-Deployment: Initialize Pool

### 1. Get Devnet USDC

**Option A: Use SPL Token Faucet**
- Visit: https://spl-token-faucet.com/
- Select: USDC (devnet)
- Enter wallet: `2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj`
- Request: 1000 USDC

**Option B: Manual Token Creation**
```bash
# Create USDC token account
spl-token create-account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --url devnet

# Request from faucet or airdrop (if available)
```

### 2. Initialize Pool

**Create Script:** `sdk/scripts/initialize-devnet-pool.ts`

```typescript
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { VultrClient } from "../src/client";
import fs from "fs";

async function main() {
  // Load wallet
  const walletData = JSON.parse(
    fs.readFileSync("../../bot/test-wallet.json", "utf-8")
  );
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Create client
  const client = new VultrClient(connection, wallet);

  // Initialize pool
  console.log("Initializing VULTR pool on devnet...");
  const poolAddress = await client.initializePool({
    depositMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), // USDC
    protocolFeeBps: 500, // 5%
    operatorFeeBps: 1500, // 15%
    depositorShareBps: 8000, // 80%
    operatorCooldownSeconds: 0, // No cooldown for devnet testing
    maxSlippageBps: 300, // 3%
  });

  console.log("✅ Pool initialized!");
  console.log("Pool Address:", poolAddress.toBase58());
  console.log("Vault PDA will be derived from this pool");
}

main().catch(console.error);
```

**Run:**
```bash
cd sdk
npm install
npx ts-node scripts/initialize-devnet-pool.ts
```

### 3. Register as Operator

**Minimum Stake:** 10,000 USDC (10,000,000,000 base units)

```bash
cd sdk

# Create register script or use CLI
npx ts-node scripts/register-operator.ts \
  --pool <pool-address> \
  --stake 10000000000
```

---

## 🤖 Run the Bot

### 1. Configure Bot

**File:** `bot/.env`
```bash
cp .env.devnet .env
```

Ensure it has:
```env
RPC_URL=https://api.devnet.solana.com
VULTR_PROGRAM_ID=7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe
WALLET_PATH=./test-wallet.json
DRY_RUN=true  # Start with dry run!
```

### 2. Test Bot Components

```bash
cd bot
npx ts-node test-bot.ts
```

**Expected Output:**
- ✅ Config loaded
- ✅ Wallet loaded
- ✅ RPC connected
- ✅ Pyth Oracle initialized
- ✅ Marginfi client initialized

### 3. Run Bot

```bash
cd bot
npm start
```

**Expected Behavior:**
```
[Bot] Starting VULTR liquidation bot...
[Bot] Network: devnet
[Bot] Operator: 2784bs...dbrRj
[Bot] Dry Run: true

[Oracle] Initializing Pyth oracle client...
[Oracle] ✓ Pyth oracle client initialized

[Marginfi] Initializing Marginfi client...
[Marginfi] ✓ Marginfi client initialized

[Bot] ✓ Bot initialized successfully
[Bot] Starting main loop (poll interval: 5000ms)...

[Marginfi] Fetching liquidatable positions...
[Marginfi] Found 0 liquidatable accounts
[Bot] No opportunities found. Waiting 5s...
```

---

## 🧪 Test Liquidation Flow

To test the complete liquidation flow, you need a liquidatable position on Marginfi devnet.

### Option 1: Find Existing Position

The bot will automatically find liquidatable positions if they exist.

### Option 2: Create Test Position

1. **Use Marginfi Devnet UI:**
   - Visit Marginfi devnet interface (if available)
   - Create margin account
   - Deposit collateral
   - Borrow against it
   - Wait for price movement

2. **Monitor Bot:**
   - Bot polls every 5 seconds
   - Will detect when position becomes liquidatable
   - Executes 2-step liquidation:
     1. Marginfi CPI (acquire collateral)
     2. Jupiter swap (convert to USDC + distribute profit)

### Option 3: Disable Dry Run

Once you've verified everything works:

```env
# bot/.env
DRY_RUN=false
```

**⚠️ Warning:** This will execute real transactions!

---

## 📊 Monitoring

### Check Pool Status

```bash
solana account <pool-address> --url devnet
```

### Check Operator Status

```bash
solana account <operator-pda> --url devnet
```

### Check Liquidation History

Monitor bot logs:
```bash
cd bot
tail -f vultr-bot.log  # or check console output
```

Look for:
- `[Bot] Found N liquidatable positions`
- `[Executor] Executing 2-step liquidation...`
- `[Executor] Step 1: Marginfi liquidation...`
- `[Executor] Step 2: Jupiter swap...`
- `[Executor] ✓ Liquidation complete`

---

## ❌ Troubleshooting

### Deployment Fails

**Error:** "Insufficient funds"
- **Solution:** Get more devnet SOL (see funding options above)

**Error:** "Authority mismatch"
- **Solution:** Using wrong keypair. Use `test-wallet.json` as upgrade authority

### Pool Initialization Fails

**Error:** "Invalid mint"
- **Solution:** Ensure using correct devnet USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

**Error:** "Insufficient balance"
- **Solution:** Wallet needs SOL for transaction fees (~0.01 SOL per tx)

### Bot Can't Connect

**Error:** "Failed to fetch Marginfi accounts"
- **Solution:** Devnet RPC can be slow. Try:
  - Use paid RPC (Helius, QuickNode)
  - Increase timeouts in retry config
  - Wait and retry

**Error:** "No Pyth price feed"
- **Solution:** Some tokens don't have devnet price feeds. Bot falls back to Jupiter prices.

### No Liquidatable Positions

**Normal:** Devnet may have few/no liquidatable positions
- Markets are often healthy on devnet
- Competition from other bots
- Create your own test position (see above)

---

## ✅ Success Criteria

### Deployment Complete:
- ✅ Program deployed to devnet
- ✅ Program ID updated in all files
- ✅ Pool initialized with USDC
- ✅ Operator registered with 10K USDC stake

### Bot Running:
- ✅ Bot connects to devnet
- ✅ Fetches Marginfi positions
- ✅ Fetches Pyth prices
- ✅ Identifies liquidatable positions (when they exist)
- ✅ Dry-run mode shows execution simulation

### Liquidation Tested:
- ✅ Step 1: Marginfi CPI executes successfully
- ✅ Step 2: Jupiter swap executes successfully
- ✅ Profit calculated correctly
- ✅ Fees distributed (5% protocol, 15% operator, 80% pool)
- ✅ Share price increases after profitable liquidation

---

## 📝 Next Steps After Devnet Success

1. **Monitor for 24-48 hours**
   - Check for errors
   - Verify gas costs
   - Measure success rate
   - Document any issues

2. **Optimize**
   - Reduce compute units if possible
   - Optimize RPC calls
   - Tune retry parameters

3. **Prepare for Mainnet**
   - Security audit
   - Gas analysis
   - Risk assessment
   - Emergency procedures

4. **Mainnet Deployment**
   - Use production wallet
   - Use premium RPC
   - Start with small amounts
   - Gradual rollout

---

## 🆘 Getting Help

**Blocked on funding?**
- Try devnet faucets (listed above)
- Ask in Solana Discord #devnet-support
- Wait for airdrop rate limit reset (usually hours)

**Technical issues?**
- Check `bot/TESTING.md` for troubleshooting
- Review error logs carefully
- Verify all program IDs match
- Check devnet RPC status

**Questions?**
- Review documentation in `/docs`
- Check STATUS.md for current state
- Create GitHub issue for bugs

---

## 📌 Quick Reference

**Program ID:** `7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe`
**Deployer:** `2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj`
**Network:** Devnet
**RPC:** https://api.devnet.solana.com

**Required SOL:** ~5 SOL (for deployment + operations)
**Required USDC:** 10,000+ USDC (for operator stake)

**Status:** ⏸️ Ready to deploy (waiting for devnet SOL funding)
