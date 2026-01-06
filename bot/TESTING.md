# VULTR Bot Testing Guide

This guide covers testing the VULTR liquidation bot from local development to production deployment.

## Table of Contents

1. [Component Testing](#component-testing)
2. [Devnet Testing](#devnet-testing)
3. [Mainnet Testing](#mainnet-testing)
4. [Performance Testing](#performance-testing)
5. [Monitoring](#monitoring)

---

## Component Testing

### Prerequisites

- Node.js v20.18.1+ installed
- Dependencies installed: `npm install`
- Test wallet created: `solana-keygen new -o test-wallet.json`

### Run Component Tests

Test bot initialization and component integration without running the full bot:

```bash
# Using devnet configuration
cp .env.devnet .env

# Run test script
npx ts-node test-bot.ts
```

This will test:
- ✅ Configuration loading
- ✅ Wallet loading
- ✅ RPC connection
- ✅ Pyth Oracle Client initialization
- ✅ Marginfi Client initialization
- ✅ Price fetching (SOL)
- ✅ Position fetching (may timeout on devnet - this is normal)

### Expected Output

```
==================================================
VULTR Bot Component Test
==================================================

[1/5] Loading configuration...
✓ Config loaded successfully
  RPC: https://api.devnet.solana.com
  Dry Run: true
  Min Profit: 10bps

[2/5] Loading wallet...
✓ Wallet loaded successfully

[3/5] Testing RPC connection...
✓ Connected to Solana 1.18.x
  Current slot: 123456789

[4/5] Testing Pyth Oracle Client...
✓ Pyth Oracle initialized
  Fetching SOL price...
  ✓ SOL price: $102.34 (source: jupiter)

[5/5] Testing Marginfi Client...
  Initializing Marginfi client...
✓ Marginfi client initialized
  Fetching liquidatable positions...
  ! Fetch timed out after 60s
  This is normal on devnet with many accounts

==================================================
✓ All components initialized successfully!
==================================================
```

---

## Devnet Testing

### 1. Setup Devnet Environment

```bash
# Use devnet configuration
cp .env.devnet .env

# Create test wallet (already done if you ran component tests)
solana-keygen new -o test-wallet.json

# Fund wallet with devnet SOL
solana airdrop 2 -k test-wallet.json --url devnet

# Check balance
solana balance -k test-wallet.json --url devnet
```

### 2. Deploy VULTR Program to Devnet

```bash
cd ../contracts

# Build program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Note the program ID and update .env
# VULTR_PROGRAM_ID=<your-program-id>
```

### 3. Initialize Pool on Devnet

```bash
cd ../sdk

# Update config for devnet
# Edit scripts/initialize-pool.ts to use devnet

# Run initialization
npm run initialize-pool
```

### 4. Register as Operator

You need to register your test wallet as an operator with stake:

```bash
# Get devnet USDC
# Visit: https://spl-token-faucet.com/

# Approve and register operator
npm run register-operator
```

### 5. Run Bot on Devnet

```bash
cd ../bot

# Ensure DRY_RUN=true for initial testing
# Edit .env: DRY_RUN=true

# Start bot
npm start
```

### Expected Behavior (Dry Run Mode)

```
[Bot] Starting VULTR liquidation bot...
[Bot] Configuration:
  Network: devnet
  Operator: 2784bs...dbrRj
  Pool: <pool-address>
  Dry Run: true

[Oracle] Initializing Pyth oracle client...
[Oracle] ✓ Pyth oracle client initialized

[Marginfi] Initializing Marginfi client...
[Marginfi] ✓ Marginfi client initialized (group: 4qp6Fx6t...)

[Bot] ✓ Bot initialized successfully
[Bot] Starting main loop (poll interval: 5000ms)...

[Marginfi] Fetching liquidatable positions from Marginfi...
[Marginfi] Found 1234 total margin accounts
[Marginfi] Fetched 1234 margin account data
[Marginfi] Found 0 liquidatable accounts
[Bot] Found 0 liquidatable positions

[Bot] No opportunities found. Waiting 5s...
```

### 6. Test with Real Liquidation (Advanced)

To test real liquidation on devnet:

1. **Create a liquidatable position:**
   - Open a Marginfi margin account on devnet
   - Deposit collateral
   - Borrow against it
   - Wait for price movement or manipulate your test position

2. **Disable dry run:**
   ```bash
   # Edit .env
   DRY_RUN=false
   ```

3. **Run bot:**
   ```bash
   npm start
   ```

4. **Monitor execution:**
   - Check bot logs for liquidation attempts
   - Verify transactions on Solana Explorer (devnet)
   - Check profit distribution

---

## Mainnet Testing

### ⚠️ WARNING: Real Money Involved

Before running on mainnet:
- [ ] Thoroughly test on devnet
- [ ] Complete security audit
- [ ] Test with small amounts first
- [ ] Monitor continuously
- [ ] Have emergency stop procedures

### 1. Mainnet Configuration

```bash
# Use mainnet configuration
cp .env.example .env

# Edit .env with your mainnet values
nano .env
```

Key changes for mainnet:
```env
# Use a premium RPC (Helius, Triton, QuickNode)
RPC_URL=https://mainnet.helius-rpc.com/?api-key=<your-key>

# Use production wallet
WALLET_PATH=/secure/path/to/production-wallet.json

# Conservative profit threshold
MIN_PROFIT_BPS=50  # 0.5%

# Enable Jito for MEV protection
USE_JITO=true
JITO_TIP_LAMPORTS=10000

# Start with dry run
DRY_RUN=true
```

### 2. Dry Run on Mainnet

Always start with dry run to verify everything works:

```bash
# DRY_RUN=true in .env
npm start
```

Monitor for 24 hours to ensure:
- Bot finds real opportunities
- Profit calculations are accurate
- No errors or crashes
- RPC rate limits are respected

### 3. Go Live (Gradual Rollout)

**Phase 1: Small amounts**
```env
DRY_RUN=false
MAX_POSITION_SIZE=10000000000  # 10K USDC
```

Run for 1 week, monitor:
- Successful liquidation rate
- Actual profit vs expected
- Gas costs
- Competition from other bots

**Phase 2: Increase limits**
```env
MAX_POSITION_SIZE=100000000000  # 100K USDC
```

**Phase 3: Full production**
```env
MAX_POSITION_SIZE=1000000000000  # 1M USDC
```

### 4. Mainnet Monitoring

Use tools to monitor bot performance:

**Logs:**
```bash
# Tail logs
tail -f bot.log

# Filter for liquidations
grep "liquidation" bot.log

# Check errors
grep "ERROR" bot.log
```

**Metrics to track:**
- Liquidations attempted / successful
- Average profit per liquidation
- Success rate
- Execution time
- RPC errors
- Position scan time

---

## Performance Testing

### 1. Position Scanning Performance

Test how quickly the bot can scan Marginfi positions:

```typescript
// Add to test-bot.ts
const start = Date.now();
const positions = await marginfi.fetchLiquidatablePositions();
const scanTime = Date.now() - start;

console.log(`Scanned ${positions.length} positions in ${scanTime}ms`);
console.log(`Rate: ${(positions.length / scanTime * 1000).toFixed(2)} positions/sec`);
```

**Target performance:**
- Scan time: < 30 seconds for all accounts
- Rate: > 50 positions/second

### 2. RPC Rate Limit Testing

Test RPC rate limiting:

```bash
# Set aggressive polling
RPC_RATE_LIMIT_MS=10  # Very fast

npm start
```

Monitor for:
- Rate limit errors (429)
- Automatic backoff working
- Successful retries

### 3. Liquidation Execution Speed

Test execution speed in dry run:

```typescript
// Time from opportunity detection to execution
console.time("liquidation");
await executor.execute(opportunity);
console.timeEnd("liquidation");
```

**Target execution:**
- Detection to execution: < 5 seconds
- Step 1 (Marginfi): < 2 seconds
- Step 2 (Jupiter): < 3 seconds

---

## Monitoring

### 1. Log Monitoring

Set up log aggregation:

```bash
# Install log monitoring (optional)
npm install -g pm2

# Start with pm2
pm2 start dist/index.js --name vultr-bot

# Monitor logs
pm2 logs vultr-bot

# Monitor metrics
pm2 monit
```

### 2. Alert Setup

Set up alerts for:
- Bot crashes
- No liquidations for > 6 hours
- Error rate > 10%
- Wallet balance < 0.1 SOL
- RPC connection failures

### 3. Health Checks

Create a health check endpoint:

```typescript
// health.ts
import express from 'express';

const app = express();

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    lastLiquidation: state.lastLiquidationAt,
    liquidationsSuccessful: state.liquidationsSuccessful,
    balance: state.operatorBalance.toString(),
  });
});

app.listen(3000);
```

### 4. Dashboard (Optional)

Consider building a simple dashboard:
- Current opportunities
- Recent liquidations
- Profit tracking
- Bot health status

---

## Troubleshooting

### Issue: Bot can't connect to RPC

**Solution:**
- Check RPC_URL is correct
- Verify RPC endpoint is accessible
- Try alternative RPC provider
- Check firewall settings

### Issue: Marginfi client initialization fails

**Solution:**
- Verify Marginfi program ID is correct
- Check Marginfi group address
- Ensure RPC endpoint supports getProgramAccounts
- Try with mainnet RPC endpoint

### Issue: No liquidatable positions found

**Possible causes:**
- No positions are actually liquidatable (markets are healthy)
- Competition from other bots
- MIN_PROFIT_BPS set too high
- Oracle prices not updating

**Solution:**
- Lower MIN_PROFIT_BPS for testing
- Check Marginfi UI for liquidatable positions
- Verify oracle prices are fetching correctly

### Issue: "Rate limit" errors

**Solution:**
- Increase RPC_RATE_LIMIT_MS
- Use premium RPC provider
- Enable RPC_MAX_RETRIES
- Consider multiple RPC endpoints

### Issue: Liquidation execution fails

**Solution:**
- Check operator has sufficient stake
- Verify operator is registered
- Check pool has sufficient liquidity
- Review transaction logs for specific error
- Verify all Marginfi account references are correct

---

## Next Steps

After successful testing:

1. **Security Audit**
   - Engage professional auditors
   - Review all CPI account validations
   - Test edge cases
   - Verify fee calculations

2. **Documentation**
   - Document all configurations
   - Create runbook for operations
   - Document emergency procedures
   - Create FAQ for operators

3. **Production Deployment**
   - Deploy to secure server
   - Set up monitoring
   - Configure alerts
   - Create backup operator

4. **Community Launch**
   - Announce to community
   - Publish audit report
   - Create operator onboarding guide
   - Set up support channel

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/your-org/vultr/issues
- Discord: Your Discord link
- Docs: https://your-docs-site.com
