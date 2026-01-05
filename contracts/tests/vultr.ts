// =============================================================================
// VULTR Protocol Test Suite
// =============================================================================
// Comprehensive tests for the VULTR liquidation pool protocol.
//
// Test Categories:
// 1. Pool Initialization
// 2. Deposits & Share Calculations
// 3. Withdrawals & Profit Distribution
// 4. Operator Registration/Deregistration
// 5. Liquidation Execution
// 6. Admin Functions
// 7. Edge Cases & Error Handling
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

const PROTOCOL_FEE_BPS = 500; // 5%
const OPERATOR_FEE_BPS = 1500; // 15%
const DEPOSITOR_SHARE_BPS = 8000; // 80%
const BPS_DENOMINATOR = 10000;
const MIN_OPERATOR_STAKE = new BN(10_000_000_000); // 10,000 USDC
const MIN_DEPOSIT_AMOUNT = new BN(1_000_000); // 1 USDC
const USDC_DECIMALS = 6;

// PDA Seeds
const POOL_SEED = Buffer.from("pool");
const VAULT_SEED = Buffer.from("vault");
const SHARE_MINT_SEED = Buffer.from("share_mint");
const DEPOSITOR_SEED = Buffer.from("depositor");
const OPERATOR_SEED = Buffer.from("operator");
const PROTOCOL_FEE_VAULT_SEED = Buffer.from("protocol_fee_vault");

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
 * Find PDA for operator account
 */
function findOperatorPDA(
  pool: PublicKey,
  authority: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [OPERATOR_SEED, pool.toBuffer(), authority.toBuffer()],
    programId
  );
}

/**
 * Find PDA for protocol fee vault
 */
function findProtocolFeeVaultPDA(
  pool: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PROTOCOL_FEE_VAULT_SEED, pool.toBuffer()],
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

describe("VULTR Protocol", () => {
  // Configure Anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vultr as Program<Vultr>;
  const connection = provider.connection;

  // Test accounts
  let admin: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let operator1: Keypair;

  // Token mints
  let depositMint: PublicKey; // Mock USDC

  // PDAs
  let poolPDA: PublicKey;
  let poolBump: number;
  let vaultPDA: PublicKey;
  let shareMintPDA: PublicKey;
  let protocolFeeVaultPDA: PublicKey;

  // Token accounts
  let adminDepositAccount: PublicKey;
  let user1DepositAccount: PublicKey;
  let user1ShareAccount: PublicKey;
  let user2DepositAccount: PublicKey;
  let user2ShareAccount: PublicKey;
  let operator1DepositAccount: PublicKey;

  // ==========================================================================
  // Setup
  // ==========================================================================

  before(async () => {
    console.log("Setting up test environment...");

    // Create test keypairs
    admin = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    operator1 = Keypair.generate();

    // Airdrop SOL to all accounts
    await airdropSol(connection, admin.publicKey);
    await airdropSol(connection, user1.publicKey);
    await airdropSol(connection, user2.publicKey);
    await airdropSol(connection, operator1.publicKey);

    // Create mock USDC mint
    depositMint = await createMockUSDC(connection, admin);
    console.log("Mock USDC mint:", depositMint.toBase58());

    // Derive PDAs
    [poolPDA, poolBump] = findPoolPDA(depositMint, program.programId);
    [vaultPDA] = findVaultPDA(poolPDA, program.programId);
    [shareMintPDA] = findShareMintPDA(poolPDA, program.programId);
    [protocolFeeVaultPDA] = findProtocolFeeVaultPDA(poolPDA, program.programId);

    console.log("Pool PDA:", poolPDA.toBase58());
    console.log("Vault PDA:", vaultPDA.toBase58());
    console.log("Share Mint PDA:", shareMintPDA.toBase58());

    // Create token accounts for admin
    const adminATA = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      depositMint,
      admin.publicKey
    );
    adminDepositAccount = adminATA.address;

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

    // Create token accounts for operator1
    const operator1DepositATA = await getOrCreateAssociatedTokenAccount(
      connection,
      operator1,
      depositMint,
      operator1.publicKey
    );
    operator1DepositAccount = operator1DepositATA.address;

    // Mint initial USDC to test users
    // Admin: 1,000,000 USDC
    await mintTokens(
      connection,
      admin,
      depositMint,
      adminDepositAccount,
      1_000_000_000_000
    );

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

    // Operator1: 20,000 USDC (enough for min stake + extra)
    await mintTokens(
      connection,
      admin,
      depositMint,
      operator1DepositAccount,
      20_000_000_000
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
          protocolFeeVault: protocolFeeVaultPDA,
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
      assert.ok(
        pool.depositMint.equals(depositMint),
        "Deposit mint should match"
      );
      assert.ok(
        pool.shareMint.equals(shareMintPDA),
        "Share mint should match"
      );
      assert.ok(pool.vault.equals(vaultPDA), "Vault should match");
      assert.equal(
        pool.totalDeposits.toNumber(),
        0,
        "Total deposits should be 0"
      );
      assert.equal(pool.totalShares.toNumber(), 0, "Total shares should be 0");
      assert.equal(pool.totalProfit.toNumber(), 0, "Total profit should be 0");
      assert.equal(
        pool.protocolFeeBps,
        PROTOCOL_FEE_BPS,
        "Protocol fee should match"
      );
      assert.equal(
        pool.operatorFeeBps,
        OPERATOR_FEE_BPS,
        "Operator fee should match"
      );
      assert.equal(
        pool.depositorShareBps,
        DEPOSITOR_SHARE_BPS,
        "Depositor share should match"
      );
      assert.equal(pool.isPaused, false, "Pool should not be paused");
      assert.equal(pool.operatorCount, 0, "Operator count should be 0");
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
            protocolFeeVault: protocolFeeVaultPDA,
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
        .deposit(depositAmount)
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
        .deposit(depositAmount)
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
          .deposit(depositAmount)
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

    it("should fail deposit of zero amount", async () => {
      const depositAmount = new BN(0);
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );

      try {
        await program.methods
          .deposit(depositAmount)
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
          "amount",
          "Should fail with invalid amount error"
        );
      }
    });
  });

  // ==========================================================================
  // 3. Operator Tests
  // ==========================================================================

  describe("3. Operator Registration", () => {
    it("should register operator with sufficient stake", async () => {
      const stakeAmount = MIN_OPERATOR_STAKE;
      const [operatorPDA] = findOperatorPDA(
        poolPDA,
        operator1.publicKey,
        program.programId
      );

      const poolBefore = await program.account.pool.fetch(poolPDA);

      const tx = await program.methods
        .registerOperator(stakeAmount)
        .accounts({
          authority: operator1.publicKey,
          pool: poolPDA,
          operator: operatorPDA,
          depositMint: depositMint,
          operatorDepositAccount: operator1DepositAccount,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([operator1])
        .rpc();

      console.log("Register operator tx:", tx);

      // Check operator account
      const operator = await program.account.operator.fetch(operatorPDA);
      assert.ok(
        operator.authority.equals(operator1.publicKey),
        "Operator authority should match"
      );
      assert.equal(
        operator.stakeAmount.toString(),
        stakeAmount.toString(),
        "Stake amount should match"
      );
      assert.equal(
        operator.totalLiquidations,
        0,
        "Total liquidations should be 0"
      );
      assert.deepEqual(operator.status, { active: {} }, "Status should be active");

      // Check pool state
      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(pool.operatorCount, 1, "Operator count should increase");
      assert.equal(
        pool.totalDeposits.toString(),
        poolBefore.totalDeposits.add(stakeAmount).toString(),
        "Stake should be added to total deposits"
      );
    });

    it("should fail registration with insufficient stake", async () => {
      const insufficientStake = MIN_OPERATOR_STAKE.sub(new BN(1));
      const newOperator = Keypair.generate();
      await airdropSol(connection, newOperator.publicKey);

      // Create token account and mint tokens
      const newOperatorATA = await getOrCreateAssociatedTokenAccount(
        connection,
        newOperator,
        depositMint,
        newOperator.publicKey
      );
      await mintTokens(
        connection,
        admin,
        depositMint,
        newOperatorATA.address,
        insufficientStake
      );

      const [operatorPDA] = findOperatorPDA(
        poolPDA,
        newOperator.publicKey,
        program.programId
      );

      try {
        await program.methods
          .registerOperator(insufficientStake)
          .accounts({
            authority: newOperator.publicKey,
            pool: poolPDA,
            operator: operatorPDA,
            depositMint: depositMint,
            operatorDepositAccount: newOperatorATA.address,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([newOperator])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(
          err.message.toLowerCase(),
          "stake",
          "Should fail with insufficient stake error"
        );
      }
    });
  });

  // ==========================================================================
  // 4. Liquidation Tests
  // ==========================================================================

  describe("4. Liquidation Execution", () => {
    it("should execute liquidation and distribute profits correctly", async () => {
      const profit = new BN(1_000_000_000); // 1,000 USDC profit
      const [operatorPDA] = findOperatorPDA(
        poolPDA,
        operator1.publicKey,
        program.programId
      );

      const poolBefore = await program.account.pool.fetch(poolPDA);
      const operatorBalanceBefore = await getTokenBalance(
        connection,
        operator1DepositAccount
      );

      // Mint profit to vault (simulating liquidation proceeds)
      await mintTokens(connection, admin, depositMint, vaultPDA, profit);

      const tx = await program.methods
        .executeLiquidation(profit)
        .accounts({
          operatorAuthority: operator1.publicKey,
          pool: poolPDA,
          operator: operatorPDA,
          depositMint: depositMint,
          vault: vaultPDA,
          protocolFeeVault: protocolFeeVaultPDA,
          operatorTokenAccount: operator1DepositAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([operator1])
        .rpc();

      console.log("Execute liquidation tx:", tx);

      // Calculate expected fee distribution
      const protocolFee = profit.muln(PROTOCOL_FEE_BPS).divn(BPS_DENOMINATOR);
      const operatorFee = profit.muln(OPERATOR_FEE_BPS).divn(BPS_DENOMINATOR);
      const depositorProfit = profit.sub(protocolFee).sub(operatorFee);

      // Check operator received fee
      const operatorBalanceAfter = await getTokenBalance(
        connection,
        operator1DepositAccount
      );
      assert.equal(
        operatorBalanceAfter.sub(operatorBalanceBefore).toString(),
        operatorFee.toString(),
        "Operator should receive 15% fee"
      );

      // Check protocol fee vault
      const protocolFeeBalance = await getTokenBalance(
        connection,
        protocolFeeVaultPDA
      );
      assert.equal(
        protocolFeeBalance.toString(),
        protocolFee.toString(),
        "Protocol fee vault should receive 5%"
      );

      // Check pool state
      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(
        pool.totalDeposits.toString(),
        poolBefore.totalDeposits.add(depositorProfit).toString(),
        "Depositor profit should be added to total deposits"
      );
      assert.equal(
        pool.totalProfit.toString(),
        profit.toString(),
        "Total profit should be tracked"
      );

      // Check operator stats
      const operator = await program.account.operator.fetch(operatorPDA);
      assert.equal(
        operator.totalLiquidations,
        1,
        "Total liquidations should increase"
      );
      assert.equal(
        operator.totalFeesEarned.toString(),
        operatorFee.toString(),
        "Total fees earned should update"
      );
    });

    it("should fail liquidation from non-operator", async () => {
      const profit = new BN(100_000_000);
      const [fakeOperatorPDA] = findOperatorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );

      try {
        await program.methods
          .executeLiquidation(profit)
          .accounts({
            operatorAuthority: user1.publicKey,
            pool: poolPDA,
            operator: fakeOperatorPDA,
            depositMint: depositMint,
            vault: vaultPDA,
            protocolFeeVault: protocolFeeVaultPDA,
            operatorTokenAccount: user1DepositAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        // Expected - operator account doesn't exist
        console.log("Expected error (non-operator):", err.message.substring(0, 50));
      }
    });
  });

  // ==========================================================================
  // 5. Withdrawal Tests
  // ==========================================================================

  describe("5. Withdrawals & Profit Distribution", () => {
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
        .withdraw(sharesToBurn)
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

      // Check depositor account updated
      const depositorAccount = await program.account.depositor.fetch(
        depositorPDA
      );
      assert.equal(
        depositorAccount.totalWithdrawn.toString(),
        actualWithdrawal.toString(),
        "Total withdrawn should update"
      );
    });

    it("should fail withdrawal of zero shares", async () => {
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );

      try {
        await program.methods
          .withdraw(new BN(0))
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

    it("should fail withdrawal with insufficient shares", async () => {
      const [depositorPDA] = findDepositorPDA(
        poolPDA,
        user1.publicKey,
        program.programId
      );
      const currentShares = await getTokenBalance(connection, user1ShareAccount);
      const tooManyShares = currentShares.add(new BN(1_000_000_000));

      try {
        await program.methods
          .withdraw(tooManyShares)
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
          "insufficient",
          "Should fail with insufficient shares"
        );
      }
    });
  });

  // ==========================================================================
  // 6. Admin Tests
  // ==========================================================================

  describe("6. Admin Functions", () => {
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
          .deposit(depositAmount)
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
      const newProtocolFee = 400; // 4%
      const newOperatorFee = 1600; // 16%
      const newDepositorShare = 8000; // 80%

      const tx = await program.methods
        .updateFees(newProtocolFee, newOperatorFee, newDepositorShare)
        .accounts({
          admin: admin.publicKey,
          pool: poolPDA,
        })
        .signers([admin])
        .rpc();

      console.log("Update fees tx:", tx);

      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(pool.protocolFeeBps, newProtocolFee, "Protocol fee should update");
      assert.equal(pool.operatorFeeBps, newOperatorFee, "Operator fee should update");
      assert.equal(
        pool.depositorShareBps,
        newDepositorShare,
        "Depositor share should update"
      );

      // Reset fees back
      await program.methods
        .updateFees(PROTOCOL_FEE_BPS, OPERATOR_FEE_BPS, DEPOSITOR_SHARE_BPS)
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
          .updateFees(600, 1400, 8000)
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
          .updateFees(500, 1500, 7000) // Sums to 90%
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

    it("should withdraw protocol fees", async () => {
      // Create admin token account for share mint
      const adminDepositATA = await getOrCreateAssociatedTokenAccount(
        connection,
        admin,
        depositMint,
        admin.publicKey
      );

      const feeBalanceBefore = await getTokenBalance(
        connection,
        protocolFeeVaultPDA
      );
      const adminBalanceBefore = await getTokenBalance(
        connection,
        adminDepositATA.address
      );

      if (feeBalanceBefore.gtn(0)) {
        const tx = await program.methods
          .withdrawProtocolFees()
          .accounts({
            admin: admin.publicKey,
            pool: poolPDA,
            depositMint: depositMint,
            protocolFeeVault: protocolFeeVaultPDA,
            adminTokenAccount: adminDepositATA.address,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();

        console.log("Withdraw protocol fees tx:", tx);

        const feeBalanceAfter = await getTokenBalance(
          connection,
          protocolFeeVaultPDA
        );
        const adminBalanceAfter = await getTokenBalance(
          connection,
          adminDepositATA.address
        );

        assert.equal(
          feeBalanceAfter.toNumber(),
          0,
          "Fee vault should be empty"
        );
        assert.equal(
          adminBalanceAfter.sub(adminBalanceBefore).toString(),
          feeBalanceBefore.toString(),
          "Admin should receive all fees"
        );
      } else {
        console.log("No protocol fees to withdraw");
      }
    });
  });

  // ==========================================================================
  // 7. Operator Deregistration Tests
  // ==========================================================================

  describe("7. Operator Deregistration", () => {
    it("should deregister operator and return stake", async () => {
      const [operatorPDA] = findOperatorPDA(
        poolPDA,
        operator1.publicKey,
        program.programId
      );

      const operatorBefore = await program.account.operator.fetch(operatorPDA);
      const stakeAmount = operatorBefore.stakeAmount;
      const balanceBefore = await getTokenBalance(
        connection,
        operator1DepositAccount
      );

      const tx = await program.methods
        .deregisterOperator()
        .accounts({
          authority: operator1.publicKey,
          pool: poolPDA,
          operator: operatorPDA,
          depositMint: depositMint,
          operatorDepositAccount: operator1DepositAccount,
          vault: vaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([operator1])
        .rpc();

      console.log("Deregister operator tx:", tx);

      // Check balance returned
      const balanceAfter = await getTokenBalance(
        connection,
        operator1DepositAccount
      );
      assert.equal(
        balanceAfter.sub(balanceBefore).toString(),
        stakeAmount.toString(),
        "Stake should be returned"
      );

      // Check pool state
      const pool = await program.account.pool.fetch(poolPDA);
      assert.equal(pool.operatorCount, 0, "Operator count should decrease");

      // Operator account should be closed
      try {
        await program.account.operator.fetch(operatorPDA);
        assert.fail("Operator account should be closed");
      } catch (err) {
        // Expected - account doesn't exist
        console.log("Operator account correctly closed");
      }
    });
  });

  // ==========================================================================
  // 8. Edge Cases
  // ==========================================================================

  describe("8. Edge Cases", () => {
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
        .deposit(depositAmount)
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
      // Re-register operator for this test
      const stakeAmount = MIN_OPERATOR_STAKE;
      const [operatorPDA] = findOperatorPDA(
        poolPDA,
        operator1.publicKey,
        program.programId
      );

      await program.methods
        .registerOperator(stakeAmount)
        .accounts({
          authority: operator1.publicKey,
          pool: poolPDA,
          operator: operatorPDA,
          depositMint: depositMint,
          operatorDepositAccount: operator1DepositAccount,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([operator1])
        .rpc();

      // Get share price before
      const poolBefore = await program.account.pool.fetch(poolPDA);
      const sharePriceBefore = poolBefore.totalDeposits
        .muln(1_000_000)
        .div(poolBefore.totalShares);

      // Execute another liquidation with profit
      const profit = new BN(500_000_000); // 500 USDC
      await mintTokens(connection, admin, depositMint, vaultPDA, profit);

      await program.methods
        .executeLiquidation(profit)
        .accounts({
          operatorAuthority: operator1.publicKey,
          pool: poolPDA,
          operator: operatorPDA,
          depositMint: depositMint,
          vault: vaultPDA,
          protocolFeeVault: protocolFeeVaultPDA,
          operatorTokenAccount: operator1DepositAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([operator1])
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
    console.log("===========================================\n");
  });
});
