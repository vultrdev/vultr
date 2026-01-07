# Devnet Faucet Guide - Getting SOL for Deployment

**Status:** Automated faucet access not possible (require web forms/CAPTCHAs)
**Required:** 3 more SOL (have 2, need 5 total)
**Wallet:** `2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj`

---

## 🔍 Faucet Investigation Results

I've investigated the available devnet faucets, and here's what I found:

### 1. Official Solana Faucet
**URL:** https://faucet.solana.com/

**Findings:**
- ✅ Official Solana Foundation faucet
- ✅ Supports devnet
- ❌ Web form only (no API/CLI)
- ⏱️ Rate limit: 2 requests per 8 hours
- 🔓 Can unlock higher limits by connecting GitHub account
- 💧 Amount: Variable (typically 1-2 SOL per request)

**Why CLI Failed:**
The `solana airdrop` command uses this faucet under the hood, and we've hit the rate limit.

### 2. QuickNode Faucet
**URL:** https://faucet.quicknode.com/solana/devnet

**Findings:**
- ✅ Reliable faucet service
- ✅ Supports devnet (1 SOL per drip)
- ❌ Web form only (requires wallet connection)
- ⏱️ Rate limit: 1 drip per 12 hours
- ⚠️ Requires: 0.05 SOL on mainnet (we don't have this)
- ⏳ Current delay: ~3 hours average processing time

**Why Not Available:**
Requires holding 0.05 SOL on mainnet as anti-spam measure.

### 3. SolFaucet.com
**URL:** https://solfaucet.com/

**Findings:**
- ✅ Simple web interface
- ✅ Supports devnet
- ❌ Web form only (button-driven)
- ⏱️ Rate limit: Unknown (not documented)
- 💧 Amount: Unknown (likely 1-2 SOL)
- 🤖 Likely has CAPTCHA/anti-bot measures

**Status:** Requires manual web interaction

---

## ✅ Manual Solution (Recommended)

Since all faucets require web interaction, here's what you need to do:

### Step 1: Visit Faucet Website

**Option A: Official Solana Faucet (Recommended)**
1. Visit: https://faucet.solana.com/
2. Select: "Devnet"
3. Enter wallet: `2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj`
4. Click: "Confirm Airdrop"
5. Wait for confirmation
6. **Tip:** Connect GitHub account for higher limits

**Option B: SolFaucet.com**
1. Visit: https://solfaucet.com/
2. Select: "Devnet"
3. Enter wallet: `2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj`
4. Click request button
5. Complete any CAPTCHA if present

### Step 2: Verify Balance

After requesting from faucet, check balance:

```bash
cd /mnt/c/VULTR/vultr/bot
solana balance -k test-wallet.json --url devnet
```

**Target:** 5 SOL (need 3 more requests)

### Step 3: Repeat if Needed

If you get 1-2 SOL per request:
- Try multiple faucets (different rate limits)
- Wait for rate limit reset
- Request again until you have ~5 SOL

---

## 🚀 Once Funded: Deploy Immediately

When balance reaches ~5 SOL:

```bash
# Verify you have enough
solana balance -k test-wallet.json --url devnet
# Should show: ~5 SOL

# Deploy program (takes ~2 minutes)
cd contracts
anchor deploy \
  --provider.cluster devnet \
  --provider.wallet ../bot/test-wallet.json \
  --program-keypair target/deploy/vultr-keypair.json \
  --program-name vultr

# Expected output:
# Program Id: 7EhoUeYzjKJB27aoMA4tXoLc9kj6bESVyzwjsN2rUbAe
# Deploy success
```

After successful deployment, follow `DEPLOYMENT.md` steps 2-8.

---

## 🔄 Alternative: Wait for Rate Limit Reset

If you prefer not to use web faucets, you can wait:

**Solana CLI Airdrop:**
- Rate limit resets periodically (varies, typically 1-24 hours)
- Check every few hours:

```bash
# Try every 2-4 hours
solana airdrop 1 -k test-wallet.json --url devnet
```

**When it works:**
```
Requesting airdrop of 1 SOL
Signature: <transaction-signature>
1 SOL
```

Repeat 3 times to get the needed 3 SOL.

---

## 📊 Cost Breakdown

Why we need 5 SOL:

| Item | Cost | Notes |
|------|------|-------|
| Program Deployment | ~4.13 SOL | Rent for program account |
| Transaction Fees | ~0.005 SOL | Multiple transactions |
| Pool Initialization | ~0.01 SOL | Creating pool accounts |
| Operator Registration | ~0.01 SOL | Creating operator account |
| Testing Buffer | ~0.845 SOL | Additional operations |
| **Total** | **~5 SOL** | Safe amount for complete testing |

---

## 🎯 Quick Start (After Funding)

Once you have 5 SOL:

1. **Deploy (2 min)**
   ```bash
   cd contracts && anchor deploy <flags>
   ```

2. **Update IDs (2 min)**
   - Edit 4 files with new program ID
   - Regenerate IDL

3. **Get USDC (5 min)**
   - Visit: https://spl-token-faucet.com/
   - Request devnet USDC

4. **Initialize Pool (1 min)**
   ```bash
   cd sdk && npx ts-node scripts/initialize-pool.ts
   ```

5. **Register Operator (1 min)**
   ```bash
   npx ts-node scripts/register-operator.ts
   ```

6. **Run Bot (immediate)**
   ```bash
   cd bot && npm start
   ```

**Total time from funding to running bot: ~15 minutes**

See `DEPLOYMENT.md` for detailed instructions.

---

## 🆘 Still Blocked?

If you can't get devnet SOL after trying faucets:

### Option 1: Discord Community
Ask in Solana Discord:
- Channel: #devnet-support
- Post: "Need devnet SOL for testing. Wallet: 2784bs...dbrRj"
- Community members often help

### Option 2: Twitter/Social
Tweet at:
- @solana
- @SolanaFndn
- Tag: #SolanaDevnet
- Include wallet address

### Option 3: Alternative Testing
Instead of devnet, you could:
1. **Localnet:** Deploy to local validator (no SOL needed)
   - Limited: No Marginfi/Jupiter integration
   - Good for: Pool mechanics testing
2. **Mainnet Fork:** Use solana-test-validator with mainnet fork
   - Realistic: Real Marginfi/Jupiter data
   - Complex: Requires more setup

---

## 📝 Summary

**Current Status:**
- ✅ Contract built and ready
- ✅ Program keypair generated
- ✅ Deployment command prepared
- ⏸️ Need 3 more SOL (manual faucet interaction required)

**Action Required:**
1. Visit https://faucet.solana.com/ or https://solfaucet.com/
2. Enter wallet: `2784bsTeTCiaW4XcuwyA8xjhavS9HA4MEbvRE4fdbrRj`
3. Request 3 separate times (or 2 times if 2 SOL per request)
4. Verify balance reaches ~5 SOL
5. Run deployment command from `DEPLOYMENT.md`

**Time Estimate:**
- Manual faucet requests: 5-10 minutes
- Deployment after funding: 15 minutes
- Total: 20-25 minutes to fully deployed and running

The protocol is 100% ready to deploy - just needs that manual faucet interaction! 🚀
