// =============================================================================
// VULTR Protocol Test Suite - NEW SIMPLIFIED DESIGN
// =============================================================================
// Comprehensive tests for the VULTR liquidation pool protocol.
//
// Test Categories:
// 1. Pool Initialization
// 2. Deposits & Share Calculations
// 3. Withdrawals
// 4. Bot Profit Recording
// 5. Admin Functions
// 6. Edge Cases & Error Handling
//
// KEY CHANGES FROM OLD DESIGN:
// - No external operators - team runs the bot internally
// - record_profit instead of execute_liquidation
// - Bot wallet authorization instead of operator registration
// - External treasury and staking_rewards_vault
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { Vultr } from "../target/types/vultr";

// =============================================================================
// Constants (should match program constants)
// =============================================================================

const TREASURY_FEE_BPS = 500; // 5%
const STAKING_FEE_BPS = 1500; // 15%
const DEPOSITOR_FEE_BPS = 8000; // 80%
const BPS_DENOMINATOR = 10000;
const MIN_DEPOSIT_AMOUNT = new BN(1_000_000); // 1 USDC
const USDC_DECIMALS = 6;

// PDA Seeds
const POOL_SEED = Buffer.from("pool");
const VAULT_SEED = Buffer.from("vault");
const SHARE_MINT_SEED = Buffer.from("share_mint");
const DEPOSITOR_SEED = Buffer.from("depositor");

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Find PDA for pool account
 */
function findPoolPDA(
  depositMint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, depositMint.toBuffer()],
    programId
  );
}

/**
 * Find PDA for vault
 */
function findVaultPDA(
  pool: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, pool.toBuffer()],
    programId
  );
}

/**
 * Find PDA for share mint
 */
function findShareMintPDA(
  pool: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SHARE_MINT_SEED, pool.toBuffer()],
    programId
  );
}

/**
 * Find PDA for depositor account
 */
function findDepositorPDA(
  pool: PublicKey,
  owner: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DEPOSITOR_SEED, pool.toBuffer(), owner.toBuffer()],
    programId
  );
}

/**
 * Airdrop SOL to an account
 */
async function airdropSol(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  amount: number = 10
): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, amount * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig);
}

/**
 * Create a mock USDC mint for testing
 */
async function createMockUSDC(
  connection: anchor.web3.Connection,
  payer: Keypair
): Promise<PublicKey> {
  return await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    USDC_DECIMALS
  );
}

/**
 * Mint tokens to an account
 */
async function mintTokens(
  connection: anchor.web3.Connection,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  amount: number | BN
): Promise<void> {
  const amountBN = typeof amount === "number" ? new BN(amount) : amount;
  await mintTo(
    connection,
    payer,
    mint,
    destination,
    payer,
    BigInt(amountBN.toString())
  );
}

/**
 * Get token account balance
 */
async function getTokenBalance(
  connection: anchor.web3.Connection,
  tokenAccount: PublicKey
): Promise<BN> {
  const account = await getAccount(connection, tokenAccount);
  return new BN(account.amount.toString());
}

// =============================================================================
// Test Suite
// =============================================================================

describe("VULTR Protocol - New Simplified Design", () => {
  // Configure Anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vultr as Program<Vultr>;
  const connection = provider.connection;

  // Test accounts
  let admin: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let botWallet: Keypair;

  // Token mints
  let depositMint: PublicKey; // Mock USDC

  // PDAs
  let poolPDA: PublicKey;
  let poolBump: number;
  let vaultPDA: PublicKey;
  let shareMintPDA: PublicKey;

  // External token accounts (not PDAs)
  let treasury: PublicKey;
  let stakingRewardsVault: PublicKey;
  let botProfitSource: PublicKey;

  // User token accounts
  let user1DepositAccount: PublicKey;
  let user1ShareAccount: PublicKey;
  let user2DepositAccount: PublicKey;
  let user2ShareAccount: PublicKey;

  // ==========================================================================
  // Setup
  // ==========================================================================

  before(async () => {
    console.log("Setting up test environment...");

    // Create test keypairs
    admin = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    botWallet = Keypair.generate();

    // Airdrop SOL to all accounts
    await airdropSol(connection, admin.publicKey);
    await airdropSol(connection, user1.publicKey);
    await airdropSol(connection, user2.publicKey);
    await airdropSol(connection, botWallet.publicKey);

    // Create mock USDC mint
    depositMint = await createMockUSDC(connection, admin);
    console.log("Mock USDC mint:", depositMint.toBase58());

    // Derive PDAs
    [poolPDA, poolBump] = findPoolPDA(depositMint, program.programId);
    [vaultPDA] = findVaultPDA(poolPDA, program.programId);
    [shareMintPDA] = findShareMintPDA(poolPDA, program.programId);

    console.log("Pool PDA:", poolPDA.toBase58());
    console.log("Vault PDA:", vaultPDA.toBase58());
    console.log("Share Mint PDA:", shareMintPDA.toBase58());

    // Create external treasury account (owned by admin)
    const treasuryATA = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      depositMint,
      admin.publicKey
    );
    treasury = treasuryATA.address;
    console.log("Treasury:", treasury.toBase58());

    // Create staking rewards vault (must be owned by admin per security constraints)
    // In production, admin creates this account before initializing the pool
    const stakingATA = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      depositMint,
      admin.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    // Use a separate token account for staking rewards (not the same as treasury)
    const stakingVaultKeypair = Keypair.generate();
    stakingRewardsVault = await createAccount(
      connection,
      admin,
      depositMint,
      admin.publicKey, // owner must be admin
      stakingVaultKeypair
    );
    console.log("Staking Rewards Vault:", stakingRewardsVault.toBase58());

    // Create bot's profit source account
    const botATA = await getOrCreateAssociatedTokenAccount(
      connection,
      botWallet,
      depositMint,
      botWallet.publicKey
    );
    botProfitSource = botATA.address;
    console.log("Bot Profit Source:", botProfitSource.toBase58());

    // Create token accounts for user1
    const user1DepositATA = await getOrCreateAssociatedTokenAccount(
      connection,
      user1,
      depositMint,
      user1.publicKey
    );
    user1DepositAccount = user1DepositATA.address;

    // Create token accounts for user2
    const user2DepositATA = await getOrCreateAssociatedTokenAccount(
      connection,
      user2,
      depositMint,
      user2.publicKey
    );
    user2DepositAccount = user2DepositATA.address;

    // Mint initial USDC to test users
    // User1: 100,000 USDC
    await mintTokens(
      connection,
      admin,
      depositMint,
      user1DepositAccount,
      100_000_000_000
    );

    // User2: 50,000 USDC
    await mintTokens(
      connection,
      admin,
      depositMint,
      user2DepositAccount,
      50_000_000_000
    );

    // Bot wallet: 10,000 USDC (for simulating profits)
    await mintTokens(
      connection,
      admin,
      depositMint,
      botProfitSource,
      10_000_000_000
    );

    console.log("Test environment setup complete!");
  });

  // ==========================================================================
  // 1. Pool Initialization Tests
  // ==========================================================================

  describe("1. Pool Initialization", () => {
    it("should initialize pool with correct parameters", async () => {
      const tx = await program.methods
        .initializePool()
        .accounts({
          admin: admin.publicKey,
          pool: poolPDA,
          depositMint: depositMint,
          shareMint: shareMintPDA,
          vault: vaultPDA,
          treasury: treasury,
          stakingRewardsVault: stakingRewardsVault,
          botWallet: botWallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      console.log("Initialize pool tx:", tx);

      // Fetch pool account
      const pool = await program.account.pool.fetch(poolPDA);

      // Verify pool state
      assert.ok(pool.admin.equals(admin.publicKey), "Admin should match");
      assert.ok(pool.botWallet.equals(botWallet.publicKey), "Bot wallet should match");
      assert.ok(pool.depositMint.equals(depositMint), "Deposit mint should match");
      assert.ok(pool.shareMint.equals(shareMintPDA), "Share mint should match");
      assert.ok(pool.vault.equals(vaultPDA), "Vault should match");
      assert.ok(pool.treasury.equals(treasury), "Treasury should match");
      assert.ok(pool.stakingRewardsVault.equals(stakingRewardsVault), "Staking rewards vault should match");
      assert.equal(pool.totalDeposits.toNumber(), 0, "Total deposits should be 0");
      assert.equal(pool.totalShares.toNumber(), 0, "Total shares should be 0");
      assert.equal(pool.totalProfit.toNumber(), 0, "Total profit should be 0");
      assert.equal(pool.totalLiquidations.toNumber(), 0, "Total liquidations should be 0");
      assert.equal(pool.depositorFeeBps, DEPOSITOR_FEE_BPS, "Depositor fee should match");
      assert.equal(pool.stakingFeeBps, STAKING_FEE_BPS, "Staking fee should match");
      assert.equal(pool.treasuryFeeBps, TREASURY_FEE_BPS, "Treasury fee should match");
      assert.equal(pool.isPaused, false, "Pool should not be paused");
    });

    it("should fail to initialize pool twice", async () => {
      try {
        await program.methods
          .initializePool()
          .accounts({
            admin: admin.publicKey,
            pool: poolPDA,
            depositMint: depositMint,
            shareMint: shareMintPDA,
            vault: vaultPDA,
            treasury: treasury,
            stakingRewardsVault: stakingRewardsVault,
            botWallet: botWallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        // Expected to fail - account already exists
        console.log("Expected error:", err.message.substring(0, 100));
      }
    });
  });

  // ==========================================================================
  // 2. Deposit Tests
  // ==========================================================================

  describe("2. Deposits & Share Calculations", () => {
    before(async () => {
      // Create share token accounts for users
      const user1ShareATA = await getOrCreateAssociatedTokenAccount(
        connection,
        user1,
        shareMintPDA,
        user1.publicKey
      );
      user1ShareAccount = user1ShareATA.address;

      const user2ShareATA = await getOrCreateAssociatedTokenAccount(
        connection,
        user2,
        shareMintPDA,
        user2.publicKey
      );
      user2ShareAccount = user2ShareATA.address;
    });

    it("should allow first deposit with 1:1 share ratio", async () => {
      const depositAmount = new BN(10_000_000_000); // 10,000 USDC
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );

      const balanceBefore = await getTokenBalance(
        connection,
        user1DepositAccount
      );

      const tx = await program.methods
        .deposit(depositAmount, new BN(0))
        .accounts({
          depositor: user1.publicKey,
          pool: poolPDA,
          depositorAccount: depositorPDA,
          depositMint: depositMint,
          shareMint: shareMintPDA,
          userDepositAccount: user1DepositAccount,
          userShareAccount: user1ShareAccount,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      console.log("Deposit tx:", tx);

      // Check balances
      const balanceAfter = await getTokenBalance(
        connection,
        user1DepositAccount
      );
      const shareBalance = await getTokenBalance(connection, user1ShareAccount);
      const vaultBalance = await getTokenBalance(connection, vaultPDA);

      assert.equal(
        balanceBefore.sub(balanceAfter).toString(),
        depositAmount.toString(),
        "USDC should be deducted"
      );
      assert.equal(
        shareBalance.toString(),
        depositAmount.toString(),
        "First deposit: shares = deposit amount"
      );
      assert.equal(
        vaultBalance.toString(),
        depositAmount.toString(),
        "Vault should hold deposits"
      );

      // Check pool state
      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(
        pool.totalDeposits.toString(),
        depositAmount.toString(),
        "Pool total deposits should update"
      );
      assert.equal(
        pool.totalShares.toString(),
        depositAmount.toString(),
        "Pool total shares should update"
      );

      // Check depositor account
      const depositorAccount = await program.account.depositor.fetch(
        depositorPDA
      );
      assert.ok(
        depositorAccount.owner.equals(user1.publicKey),
        "Depositor owner should match"
      );
      assert.equal(
        depositorAccount.totalDeposited.toString(),
        depositAmount.toString(),
        "Total deposited should update"
      );
      assert.equal(depositorAccount.depositCount, 1, "Deposit count should be 1");
    });

    it("should calculate correct shares for second depositor", async () => {
      const depositAmount = new BN(5_000_000_000); // 5,000 USDC
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user2.publicKey,
        program.programId
      );

      // Get pool state before deposit
      const poolBefore = await program.account.pool.fetch(poolPDA);

      const tx = await program.methods
        .deposit(depositAmount, new BN(0))
        .accounts({
          depositor: user2.publicKey,
          pool: poolPDA,
          depositorAccount: depositorPDA,
          depositMint: depositMint,
          shareMint: shareMintPDA,
          userDepositAccount: user2DepositAccount,
          userShareAccount: user2ShareAccount,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      console.log("Second deposit tx:", tx);

      // Calculate expected shares
      // shares = (deposit * total_shares) / total_value
      const expectedShares = depositAmount
        .mul(poolBefore.totalShares)
        .div(poolBefore.totalDeposits);

      const shareBalance = await getTokenBalance(connection, user2ShareAccount);
      assert.equal(
        shareBalance.toString(),
        expectedShares.toString(),
        "Shares should be calculated proportionally"
      );

      // Check pool state
      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(
        pool.totalDeposits.toString(),
        poolBefore.totalDeposits.add(depositAmount).toString(),
        "Total deposits should increase"
      );
    });

    it("should fail deposit below minimum", async () => {
      const depositAmount = new BN(100); // Way below 1 USDC minimum
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );

      try {
        await program.methods
          .deposit(depositAmount, new BN(0))
          .accounts({
            depositor: user1.publicKey,
            pool: poolPDA,
            depositorAccount: depositorPDA,
            depositMint: depositMint,
            shareMint: shareMintPDA,
            userDepositAccount: user1DepositAccount,
            userShareAccount: user1ShareAccount,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(
          err.message.toLowerCase(),
          "below minimum",
          "Should fail with minimum deposit error"
        );
      }
    });
  });

  // ==========================================================================
  // 3. Bot Profit Recording Tests
  // ==========================================================================

  describe("3. Bot Profit Recording", () => {
    it("should record profit and distribute fees correctly", async () => {
      const profit = new BN(1_000_000_000); // 1,000 USDC profit

      const poolBefore = await program.account.pool.fetch(poolPDA);
      const treasuryBalanceBefore = await getTokenBalance(connection, treasury);
      const stakingBalanceBefore = await getTokenBalance(connection, stakingRewardsVault);
      const vaultBalanceBefore = await getTokenBalance(connection, vaultPDA);

      const tx = await program.methods
        .recordProfit(profit)
        .accounts({
          botWallet: botWallet.publicKey,
          pool: poolPDA,
          vault: vaultPDA,
          stakingRewardsVault: stakingRewardsVault,
          treasury: treasury,
          profitSource: botProfitSource,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([botWallet])
        .rpc();

      console.log("Record profit tx:", tx);

      // Calculate expected fee distribution
      const depositorShare = profit.muln(DEPOSITOR_FEE_BPS).divn(BPS_DENOMINATOR); // 80%
      const stakingShare = profit.muln(STAKING_FEE_BPS).divn(BPS_DENOMINATOR); // 15%
      const treasuryShare = profit.sub(depositorShare).sub(stakingShare); // 5%

      // Check vault received depositor share
      const vaultBalanceAfter = await getTokenBalance(connection, vaultPDA);
      assert.equal(
        vaultBalanceAfter.sub(vaultBalanceBefore).toString(),
        depositorShare.toString(),
        "Vault should receive 80%"
      );

      // Check staking rewards vault received staking share
      const stakingBalanceAfter = await getTokenBalance(connection, stakingRewardsVault);
      assert.equal(
        stakingBalanceAfter.sub(stakingBalanceBefore).toString(),
        stakingShare.toString(),
        "Staking vault should receive 15%"
      );

      // Check treasury received its share
      const treasuryBalanceAfter = await getTokenBalance(connection, treasury);
      assert.equal(
        treasuryBalanceAfter.sub(treasuryBalanceBefore).toString(),
        treasuryShare.toString(),
        "Treasury should receive 5%"
      );

      // Check pool state
      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(
        pool.totalDeposits.toString(),
        poolBefore.totalDeposits.add(depositorShare).toString(),
        "Total deposits should increase by depositor share"
      );
      assert.equal(
        pool.totalProfit.toString(),
        poolBefore.totalProfit.add(profit).toString(),
        "Total profit should be tracked"
      );
      assert.equal(
        pool.totalLiquidations.toNumber(),
        poolBefore.totalLiquidations.toNumber() + 1,
        "Total liquidations should increase"
      );
    });

    it("should fail profit recording from non-bot wallet", async () => {
      const profit = new BN(100_000_000);

      try {
        await program.methods
          .recordProfit(profit)
          .accounts({
            botWallet: user1.publicKey, // Wrong signer
            pool: poolPDA,
            vault: vaultPDA,
            stakingRewardsVault: stakingRewardsVault,
            treasury: treasury,
            profitSource: user1DepositAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        console.log("Expected error (non-bot):", err.message.substring(0, 80));
        assert.include(
          err.message.toLowerCase(),
          "unauthorized",
          "Should fail with unauthorized bot error"
        );
      }
    });

    it("should fail profit recording with zero amount", async () => {
      try {
        await program.methods
          .recordProfit(new BN(0))
          .accounts({
            botWallet: botWallet.publicKey,
            pool: poolPDA,
            vault: vaultPDA,
            stakingRewardsVault: stakingRewardsVault,
            treasury: treasury,
            profitSource: botProfitSource,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([botWallet])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(
          err.message.toLowerCase(),
          "profit",
          "Should fail with invalid profit error"
        );
      }
    });
  });

  // ==========================================================================
  // 4. Withdrawal Tests
  // ==========================================================================

  describe("4. Withdrawals & Profit Distribution", () => {
    it("should withdraw with profit included in share value", async () => {
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );

      // Get current state
      const pool = await program.account.pool.fetch(poolPDA);
      const shareBalanceBefore = await getTokenBalance(
        connection,
        user1ShareAccount
      );
      const depositBalanceBefore = await getTokenBalance(
        connection,
        user1DepositAccount
      );

      // Withdraw half of shares
      const sharesToBurn = shareBalanceBefore.divn(2);

      // Calculate expected withdrawal
      // withdrawal = (shares * total_value) / total_shares
      const expectedWithdrawal = sharesToBurn
        .mul(pool.totalDeposits)
        .div(pool.totalShares);

      const tx = await program.methods
        .withdraw(sharesToBurn, new BN(0))
        .accounts({
          withdrawer: user1.publicKey,
          pool: poolPDA,
          depositorAccount: depositorPDA,
          depositMint: depositMint,
          shareMint: shareMintPDA,
          userDepositAccount: user1DepositAccount,
          userShareAccount: user1ShareAccount,
          vault: vaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      console.log("Withdraw tx:", tx);

      // Check balances
      const shareBalanceAfter = await getTokenBalance(
        connection,
        user1ShareAccount
      );
      const depositBalanceAfter = await getTokenBalance(
        connection,
        user1DepositAccount
      );

      assert.equal(
        shareBalanceBefore.sub(shareBalanceAfter).toString(),
        sharesToBurn.toString(),
        "Shares should be burned"
      );

      const actualWithdrawal = depositBalanceAfter.sub(depositBalanceBefore);
      console.log("Expected withdrawal:", expectedWithdrawal.toString());
      console.log("Actual withdrawal:", actualWithdrawal.toString());

      // Allow for small rounding difference
      const diff = actualWithdrawal.sub(expectedWithdrawal).abs();
      assert.ok(diff.ltn(10), "Withdrawal amount should match (within rounding)");
    });

    it("should fail withdrawal of zero shares", async () => {
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );

      try {
        await program.methods
          .withdraw(new BN(0), new BN(0))
          .accounts({
            withdrawer: user1.publicKey,
            pool: poolPDA,
            depositorAccount: depositorPDA,
            depositMint: depositMint,
            shareMint: shareMintPDA,
            userDepositAccount: user1DepositAccount,
            userShareAccount: user1ShareAccount,
            vault: vaultPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(
          err.message.toLowerCase(),
          "amount",
          "Should fail with invalid amount"
        );
      }
    });
  });

  // ==========================================================================
  // 5. Admin Tests
  // ==========================================================================

  describe("5. Admin Functions", () => {
    it("should pause pool", async () => {
      const tx = await program.methods
        .pausePool(true)
        .accounts({
          admin: admin.publicKey,
          pool: poolPDA,
        })
        .signers([admin])
        .rpc();

      console.log("Pause pool tx:", tx);

      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(pool.isPaused, true, "Pool should be paused");
    });

    it("should fail deposit when paused", async () => {
      const depositAmount = new BN(1_000_000_000);
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );

      try {
        await program.methods
          .deposit(depositAmount, new BN(0))
          .accounts({
            depositor: user1.publicKey,
            pool: poolPDA,
            depositorAccount: depositorPDA,
            depositMint: depositMint,
            shareMint: shareMintPDA,
            userDepositAccount: user1DepositAccount,
            userShareAccount: user1ShareAccount,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(
          err.message.toLowerCase(),
          "paused",
          "Should fail with pool paused error"
        );
      }
    });

    it("should fail profit recording when paused", async () => {
      try {
        await program.methods
          .recordProfit(new BN(100_000_000))
          .accounts({
            botWallet: botWallet.publicKey,
            pool: poolPDA,
            vault: vaultPDA,
            stakingRewardsVault: stakingRewardsVault,
            treasury: treasury,
            profitSource: botProfitSource,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([botWallet])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(
          err.message.toLowerCase(),
          "paused",
          "Should fail with pool paused error"
        );
      }
    });

    it("should unpause pool", async () => {
      const tx = await program.methods
        .pausePool(false)
        .accounts({
          admin: admin.publicKey,
          pool: poolPDA,
        })
        .signers([admin])
        .rpc();

      console.log("Unpause pool tx:", tx);

      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(pool.isPaused, false, "Pool should be unpaused");
    });

    it("should update fees", async () => {
      const newDepositorFee = 7500; // 75%
      const newStakingFee = 2000; // 20%
      const newTreasuryFee = 500; // 5%

      const tx = await program.methods
        .updateFees(newDepositorFee, newStakingFee, newTreasuryFee)
        .accounts({
          admin: admin.publicKey,
          pool: poolPDA,
        })
        .signers([admin])
        .rpc();

      console.log("Update fees tx:", tx);

      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(pool.depositorFeeBps, newDepositorFee, "Depositor fee should update");
      assert.equal(pool.stakingFeeBps, newStakingFee, "Staking fee should update");
      assert.equal(pool.treasuryFeeBps, newTreasuryFee, "Treasury fee should update");

      // Reset fees back
      await program.methods
        .updateFees(DEPOSITOR_FEE_BPS, STAKING_FEE_BPS, TREASURY_FEE_BPS)
        .accounts({
          admin: admin.publicKey,
          pool: poolPDA,
        })
        .signers([admin])
        .rpc();
    });

    it("should fail update fees from non-admin", async () => {
      try {
        await program.methods
          .updateFees(8000, 1500, 500)
          .accounts({
            admin: user1.publicKey,
            pool: poolPDA,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(
          err.message.toLowerCase(),
          "admin",
          "Should fail with admin only error"
        );
      }
    });

    it("should fail update fees that don't sum to 100%", async () => {
      try {
        await program.methods
          .updateFees(5000, 1500, 500) // Sums to 70%
          .accounts({
            admin: admin.publicKey,
            pool: poolPDA,
          })
          .signers([admin])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(
          err.message.toLowerCase(),
          "fee",
          "Should fail with invalid fee error"
        );
      }
    });

    it("should update bot wallet", async () => {
      const newBotWallet = Keypair.generate();

      const tx = await program.methods
        .updateBotWallet()
        .accounts({
          admin: admin.publicKey,
          pool: poolPDA,
          newBotWallet: newBotWallet.publicKey,
        })
        .signers([admin])
        .rpc();

      console.log("Update bot wallet tx:", tx);

      const pool = await program.account.pool.fetch(poolPDA);
      assert.ok(pool.botWallet.equals(newBotWallet.publicKey), "Bot wallet should update");

      // Update back to original
      await program.methods
        .updateBotWallet()
        .accounts({
          admin: admin.publicKey,
          pool: poolPDA,
          newBotWallet: botWallet.publicKey,
        })
        .signers([admin])
        .rpc();
    });
  });

  // ==========================================================================
  // 6. Edge Cases
  // ==========================================================================

  describe("6. Edge Cases", () => {
    it("should handle multiple deposits from same user", async () => {
      const depositAmount = new BN(2_000_000_000); // 2,000 USDC
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );

      const depositorBefore = await program.account.depositor.fetch(depositorPDA);
      const depositCountBefore = depositorBefore.depositCount;

      await program.methods
        .deposit(depositAmount, new BN(0))
        .accounts({
          depositor: user1.publicKey,
          pool: poolPDA,
          depositorAccount: depositorPDA,
          depositMint: depositMint,
          shareMint: shareMintPDA,
          userDepositAccount: user1DepositAccount,
          userShareAccount: user1ShareAccount,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const depositorAfter = await program.account.depositor.fetch(depositorPDA);
      assert.equal(
        depositorAfter.depositCount,
        depositCountBefore + 1,
        "Deposit count should increase"
      );
      assert.ok(
        depositorAfter.totalDeposited.gt(depositorBefore.totalDeposited),
        "Total deposited should increase"
      );
    });

    it("should verify share price increases after profit", async () => {
      // Get share price before
      const poolBefore = await program.account.pool.fetch(poolPDA);
      const sharePriceBefore = poolBefore.totalDeposits
        .muln(1_000_000)
        .div(poolBefore.totalShares);

      // Record another profit
      const profit = new BN(500_000_000); // 500 USDC

      await program.methods
        .recordProfit(profit)
        .accounts({
          botWallet: botWallet.publicKey,
          pool: poolPDA,
          vault: vaultPDA,
          stakingRewardsVault: stakingRewardsVault,
          treasury: treasury,
          profitSource: botProfitSource,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([botWallet])
        .rpc();

      // Get share price after
      const poolAfter = await program.account.pool.fetch(poolPDA);
      const sharePriceAfter = poolAfter.totalDeposits
        .muln(1_000_000)
        .div(poolAfter.totalShares);

      console.log("Share price before:", sharePriceBefore.toString());
      console.log("Share price after:", sharePriceAfter.toString());

      assert.ok(
        sharePriceAfter.gt(sharePriceBefore),
        "Share price should increase after profit"
      );
    });
  });

  // ==========================================================================
  // Summary
  // ==========================================================================

  after(() => {
    console.log("\n===========================================");
    console.log("VULTR Protocol Test Suite Complete!");
    console.log("NEW SIMPLIFIED DESIGN - No External Operators");
    console.log("===========================================\n");
  });
});
