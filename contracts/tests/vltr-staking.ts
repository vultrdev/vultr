import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VltrStaking } from "../target/types/vltr_staking";
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
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("vltr-staking", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.VltrStaking as Program<VltrStaking>;

  // Test accounts
  let admin: Keypair;
  let user1: Keypair;
  let user2: Keypair;

  // Token mints
  let vltrMint: PublicKey;
  let usdcMint: PublicKey;

  // Token accounts
  let adminVltrAccount: PublicKey;
  let adminUsdcAccount: PublicKey;
  let user1VltrAccount: PublicKey;
  let user1UsdcAccount: PublicKey;
  let user2VltrAccount: PublicKey;
  let user2UsdcAccount: PublicKey;

  // PDAs
  let stakingPool: PublicKey;
  let stakingPoolBump: number;
  let stakeVault: PublicKey;
  let stakeVaultBump: number;
  let rewardVault: PublicKey;
  let rewardVaultOwner: Keypair; // Owner of reward vault for signing
  let user1Staker: PublicKey;
  let user2Staker: PublicKey;

  // Constants
  const VLTR_DECIMALS = 6;
  const USDC_DECIMALS = 6;
  const INITIAL_VLTR_SUPPLY = 1_000_000 * 10 ** VLTR_DECIMALS; // 1M VLTR
  const INITIAL_USDC_SUPPLY = 100_000 * 10 ** USDC_DECIMALS; // 100K USDC

  before(async () => {
    // Create test accounts
    admin = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();

    // Airdrop SOL to accounts
    const airdropAmount = 10 * LAMPORTS_PER_SOL;
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, airdropAmount)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user1.publicKey, airdropAmount)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user2.publicKey, airdropAmount)
    );

    // Create VLTR mint (simulating PumpFun token)
    vltrMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      VLTR_DECIMALS
    );

    // Create USDC mint
    usdcMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      USDC_DECIMALS
    );

    // Create token accounts using associated token accounts
    const adminVltrAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      vltrMint,
      admin.publicKey
    );
    adminVltrAccount = adminVltrAta.address;

    const adminUsdcAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      usdcMint,
      admin.publicKey
    );
    adminUsdcAccount = adminUsdcAta.address;

    const user1VltrAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin, // payer
      vltrMint,
      user1.publicKey
    );
    user1VltrAccount = user1VltrAta.address;

    const user1UsdcAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin, // payer
      usdcMint,
      user1.publicKey
    );
    user1UsdcAccount = user1UsdcAta.address;

    const user2VltrAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin, // payer
      vltrMint,
      user2.publicKey
    );
    user2VltrAccount = user2VltrAta.address;

    const user2UsdcAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin, // payer
      usdcMint,
      user2.publicKey
    );
    user2UsdcAccount = user2UsdcAta.address;

    // Mint initial tokens
    await mintTo(
      provider.connection,
      admin,
      vltrMint,
      user1VltrAccount,
      admin,
      INITIAL_VLTR_SUPPLY / 2
    );
    await mintTo(
      provider.connection,
      admin,
      vltrMint,
      user2VltrAccount,
      admin,
      INITIAL_VLTR_SUPPLY / 2
    );
    await mintTo(
      provider.connection,
      admin,
      usdcMint,
      adminUsdcAccount,
      admin,
      INITIAL_USDC_SUPPLY
    );

    // Create reward vault (simulating staking_rewards_vault from main pool)
    // Must be owned by admin per security constraints
    rewardVaultOwner = admin; // Use admin as owner
    const rewardVaultKeypair = Keypair.generate();
    rewardVault = await createAccount(
      provider.connection,
      admin,
      usdcMint,
      admin.publicKey, // owner must be admin
      rewardVaultKeypair
    );

    // Derive PDAs
    [stakingPool, stakingPoolBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), vltrMint.toBuffer()],
      program.programId
    );

    [stakeVault, stakeVaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_vault"), stakingPool.toBuffer()],
      program.programId
    );

    [user1Staker] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("staker"),
        stakingPool.toBuffer(),
        user1.publicKey.toBuffer(),
      ],
      program.programId
    );

    [user2Staker] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("staker"),
        stakingPool.toBuffer(),
        user2.publicKey.toBuffer(),
      ],
      program.programId
    );

    console.log("=== Test Setup ===");
    console.log("Admin:", admin.publicKey.toBase58());
    console.log("User1:", user1.publicKey.toBase58());
    console.log("User2:", user2.publicKey.toBase58());
    console.log("VLTR Mint:", vltrMint.toBase58());
    console.log("USDC Mint:", usdcMint.toBase58());
    console.log("Staking Pool PDA:", stakingPool.toBase58());
    console.log("Stake Vault PDA:", stakeVault.toBase58());
    console.log("==================\n");
  });

  describe("Initialize Staking Pool", () => {
    it("should initialize staking pool", async () => {
      await program.methods
        .initialize()
        .accountsStrict({
          admin: admin.publicKey,
          stakingPool: stakingPool,
          vltrMint: vltrMint,
          rewardMint: usdcMint,
          stakeVault: stakeVault,
          rewardVault: rewardVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Verify pool state
      const poolAccount = await program.account.stakingPool.fetch(stakingPool);

      assert.equal(poolAccount.admin.toBase58(), admin.publicKey.toBase58());
      assert.equal(poolAccount.vltrMint.toBase58(), vltrMint.toBase58());
      assert.equal(poolAccount.rewardMint.toBase58(), usdcMint.toBase58());
      assert.equal(poolAccount.stakeVault.toBase58(), stakeVault.toBase58());
      assert.equal(poolAccount.rewardVault.toBase58(), rewardVault.toBase58());
      assert.equal(poolAccount.totalStaked.toNumber(), 0);
      assert.equal(poolAccount.totalRewardsDistributed.toNumber(), 0);
      assert.equal(poolAccount.stakerCount.toNumber(), 0);
      assert.equal(poolAccount.isPaused, false);

      console.log("✅ Staking pool initialized successfully");
    });
  });

  describe("Stake", () => {
    const stakeAmount1 = 100_000 * 10 ** VLTR_DECIMALS; // 100K VLTR
    const stakeAmount2 = 50_000 * 10 ** VLTR_DECIMALS; // 50K VLTR

    it("should allow user1 to stake VLTR", async () => {
      const user1VltrBefore = await getAccount(
        provider.connection,
        user1VltrAccount
      );

      await program.methods
        .stake(new anchor.BN(stakeAmount1))
        .accountsStrict({
          user: user1.publicKey,
          stakingPool: stakingPool,
          staker: user1Staker,
          vltrMint: vltrMint,
          userVltrAccount: user1VltrAccount,
          stakeVault: stakeVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify user1's stake
      const stakerAccount = await program.account.staker.fetch(user1Staker);
      assert.equal(
        stakerAccount.stakedAmount.toNumber(),
        stakeAmount1,
        "User1 staked amount incorrect"
      );
      assert.equal(
        stakerAccount.owner.toBase58(),
        user1.publicKey.toBase58(),
        "Staker owner incorrect"
      );

      // Verify pool state
      const poolAccount = await program.account.stakingPool.fetch(stakingPool);
      assert.equal(
        poolAccount.totalStaked.toNumber(),
        stakeAmount1,
        "Pool total staked incorrect"
      );
      assert.equal(
        poolAccount.stakerCount.toNumber(),
        1,
        "Staker count incorrect"
      );

      // Verify token transfer
      const user1VltrAfter = await getAccount(
        provider.connection,
        user1VltrAccount
      );
      const vaultAfter = await getAccount(provider.connection, stakeVault);

      assert.equal(
        Number(user1VltrBefore.amount) - Number(user1VltrAfter.amount),
        stakeAmount1,
        "VLTR not transferred from user"
      );
      assert.equal(
        Number(vaultAfter.amount),
        stakeAmount1,
        "VLTR not received in vault"
      );

      console.log(`✅ User1 staked ${stakeAmount1 / 10 ** VLTR_DECIMALS} VLTR`);
    });

    it("should allow user2 to stake VLTR", async () => {
      await program.methods
        .stake(new anchor.BN(stakeAmount2))
        .accountsStrict({
          user: user2.publicKey,
          stakingPool: stakingPool,
          staker: user2Staker,
          vltrMint: vltrMint,
          userVltrAccount: user2VltrAccount,
          stakeVault: stakeVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      // Verify pool state
      const poolAccount = await program.account.stakingPool.fetch(stakingPool);
      assert.equal(
        poolAccount.totalStaked.toNumber(),
        stakeAmount1 + stakeAmount2,
        "Pool total staked incorrect"
      );
      assert.equal(
        poolAccount.stakerCount.toNumber(),
        2,
        "Staker count incorrect"
      );

      console.log(`✅ User2 staked ${stakeAmount2 / 10 ** VLTR_DECIMALS} VLTR`);
      console.log(
        `   Total staked: ${poolAccount.totalStaked.toNumber() / 10 ** VLTR_DECIMALS} VLTR`
      );
    });

    it("should fail to stake below minimum", async () => {
      const tooSmall = 100; // Below minimum of 1 VLTR

      try {
        await program.methods
          .stake(new anchor.BN(tooSmall))
          .accountsStrict({
            user: user1.publicKey,
            stakingPool: stakingPool,
            staker: user1Staker,
            vltrMint: vltrMint,
            userVltrAccount: user1VltrAccount,
            stakeVault: stakeVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.message, "BelowMinimumStake");
        console.log("✅ Correctly rejected stake below minimum");
      }
    });
  });

  describe("Distribute Rewards", () => {
    const rewardAmount = 10_000 * 10 ** USDC_DECIMALS; // 10K USDC

    it("should distribute rewards to stakers", async () => {
      const poolBefore = await program.account.stakingPool.fetch(stakingPool);

      await program.methods
        .distribute(new anchor.BN(rewardAmount))
        .accountsStrict({
          authority: admin.publicKey,
          stakingPool: stakingPool,
          rewardMint: usdcMint,
          rewardSource: adminUsdcAccount,
          rewardVault: rewardVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Verify pool state
      const poolAfter = await program.account.stakingPool.fetch(stakingPool);

      assert.equal(
        poolAfter.totalRewardsDistributed.toNumber(),
        rewardAmount,
        "Total rewards distributed incorrect"
      );
      assert.notEqual(
        poolAfter.rewardPerToken.toString(),
        "0",
        "Reward per token should increase"
      );

      // Verify reward vault balance
      const vaultAfter = await getAccount(provider.connection, rewardVault);
      assert.equal(
        Number(vaultAfter.amount),
        rewardAmount,
        "Reward vault balance incorrect"
      );

      console.log(
        `✅ Distributed ${rewardAmount / 10 ** USDC_DECIMALS} USDC to stakers`
      );
      console.log(`   Reward per token: ${poolAfter.rewardPerToken.toString()}`);
    });

    it("should fail to distribute from non-admin", async () => {
      try {
        await program.methods
          .distribute(new anchor.BN(1000))
          .accountsStrict({
            authority: user1.publicKey,
            stakingPool: stakingPool,
            rewardMint: usdcMint,
            rewardSource: user1UsdcAccount,
            rewardVault: rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.message, "Unauthorized");
        console.log("✅ Correctly rejected distribute from non-admin");
      }
    });
  });

  describe("Claim Rewards", () => {
    it("should allow user1 to claim rewards", async () => {
      const stakerBefore = await program.account.staker.fetch(user1Staker);
      const user1UsdcBefore = await getAccount(
        provider.connection,
        user1UsdcAccount
      );

      await program.methods
        .claim()
        .accountsStrict({
          user: user1.publicKey,
          stakingPool: stakingPool,
          staker: user1Staker,
          rewardMint: usdcMint,
          userRewardAccount: user1UsdcAccount,
          rewardVault: rewardVault,
          rewardVaultAuthority: rewardVaultOwner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1, rewardVaultOwner])
        .rpc();

      // Verify user1 received rewards
      const user1UsdcAfter = await getAccount(
        provider.connection,
        user1UsdcAccount
      );
      const stakerAfter = await program.account.staker.fetch(user1Staker);

      const claimed = Number(user1UsdcAfter.amount) - Number(user1UsdcBefore.amount);
      assert.isAbove(claimed, 0, "User1 should have received rewards");

      // User1 has 100K of 150K total = 66.67% of rewards
      // Expected: ~6,666 USDC (66.67% of 10K)
      const expectedApprox = (10_000 * 100_000 / 150_000) * 10 ** USDC_DECIMALS;
      const tolerance = 100 * 10 ** USDC_DECIMALS; // Allow 100 USDC tolerance for rounding

      assert.isAtMost(
        Math.abs(claimed - expectedApprox),
        tolerance,
        "Claimed amount not proportional to stake"
      );

      console.log(`✅ User1 claimed ${claimed / 10 ** USDC_DECIMALS} USDC rewards`);
      console.log(`   Total claimed: ${stakerAfter.rewardsClaimed.toNumber() / 10 ** USDC_DECIMALS} USDC`);
    });

    it("should allow user2 to claim rewards", async () => {
      const user2UsdcBefore = await getAccount(
        provider.connection,
        user2UsdcAccount
      );

      await program.methods
        .claim()
        .accountsStrict({
          user: user2.publicKey,
          stakingPool: stakingPool,
          staker: user2Staker,
          rewardMint: usdcMint,
          userRewardAccount: user2UsdcAccount,
          rewardVault: rewardVault,
          rewardVaultAuthority: rewardVaultOwner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2, rewardVaultOwner])
        .rpc();

      const user2UsdcAfter = await getAccount(
        provider.connection,
        user2UsdcAccount
      );
      const claimed = Number(user2UsdcAfter.amount) - Number(user2UsdcBefore.amount);

      console.log(`✅ User2 claimed ${claimed / 10 ** USDC_DECIMALS} USDC rewards`);
    });

    it("should fail to claim with no rewards", async () => {
      try {
        await program.methods
          .claim()
          .accountsStrict({
            user: user1.publicKey,
            stakingPool: stakingPool,
            staker: user1Staker,
            rewardMint: usdcMint,
            userRewardAccount: user1UsdcAccount,
            rewardVault: rewardVault,
            rewardVaultAuthority: rewardVaultOwner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1, rewardVaultOwner])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.message, "NoRewardsToClaim");
        console.log("✅ Correctly rejected claim with no pending rewards");
      }
    });
  });

  describe("Unstake", () => {
    const unstakeAmount = 25_000 * 10 ** VLTR_DECIMALS; // 25K VLTR

    it("should allow user1 to partially unstake", async () => {
      const user1VltrBefore = await getAccount(
        provider.connection,
        user1VltrAccount
      );
      const poolBefore = await program.account.stakingPool.fetch(stakingPool);

      await program.methods
        .unstake(new anchor.BN(unstakeAmount))
        .accountsStrict({
          user: user1.publicKey,
          stakingPool: stakingPool,
          staker: user1Staker,
          vltrMint: vltrMint,
          userVltrAccount: user1VltrAccount,
          stakeVault: stakeVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify user1's stake decreased
      const stakerAfter = await program.account.staker.fetch(user1Staker);
      const expectedRemaining = 100_000 * 10 ** VLTR_DECIMALS - unstakeAmount;
      assert.equal(
        stakerAfter.stakedAmount.toNumber(),
        expectedRemaining,
        "User1 staked amount incorrect after unstake"
      );

      // Verify pool total decreased
      const poolAfter = await program.account.stakingPool.fetch(stakingPool);
      assert.equal(
        poolAfter.totalStaked.toNumber(),
        poolBefore.totalStaked.toNumber() - unstakeAmount,
        "Pool total staked incorrect"
      );

      // Staker count should still be 2 (partial unstake)
      assert.equal(poolAfter.stakerCount.toNumber(), 2, "Staker count should not change");

      // Verify token transfer
      const user1VltrAfter = await getAccount(
        provider.connection,
        user1VltrAccount
      );
      assert.equal(
        Number(user1VltrAfter.amount) - Number(user1VltrBefore.amount),
        unstakeAmount,
        "VLTR not returned to user"
      );

      console.log(`✅ User1 unstaked ${unstakeAmount / 10 ** VLTR_DECIMALS} VLTR`);
      console.log(`   Remaining stake: ${stakerAfter.stakedAmount.toNumber() / 10 ** VLTR_DECIMALS} VLTR`);
    });

    it("should fail to unstake more than staked", async () => {
      const tooMuch = 1_000_000 * 10 ** VLTR_DECIMALS; // More than staked

      try {
        await program.methods
          .unstake(new anchor.BN(tooMuch))
          .accountsStrict({
            user: user1.publicKey,
            stakingPool: stakingPool,
            staker: user1Staker,
            vltrMint: vltrMint,
            userVltrAccount: user1VltrAccount,
            stakeVault: stakeVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.message, "InsufficientStake");
        console.log("✅ Correctly rejected unstake exceeding balance");
      }
    });
  });

  describe("Admin Functions", () => {
    it("should pause the pool", async () => {
      await program.methods
        .pausePool(true)
        .accountsStrict({
          admin: admin.publicKey,
          stakingPool: stakingPool,
        })
        .signers([admin])
        .rpc();

      const poolAccount = await program.account.stakingPool.fetch(stakingPool);
      assert.equal(poolAccount.isPaused, true, "Pool should be paused");

      console.log("✅ Pool paused");
    });

    it("should fail to stake when paused", async () => {
      const stakeAmount = 1_000 * 10 ** VLTR_DECIMALS;

      try {
        await program.methods
          .stake(new anchor.BN(stakeAmount))
          .accountsStrict({
            user: user1.publicKey,
            stakingPool: stakingPool,
            staker: user1Staker,
            vltrMint: vltrMint,
            userVltrAccount: user1VltrAccount,
            stakeVault: stakeVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.message, "PoolPaused");
        console.log("✅ Correctly rejected stake when paused");
      }
    });

    it("should unpause the pool", async () => {
      await program.methods
        .pausePool(false)
        .accountsStrict({
          admin: admin.publicKey,
          stakingPool: stakingPool,
        })
        .signers([admin])
        .rpc();

      const poolAccount = await program.account.stakingPool.fetch(stakingPool);
      assert.equal(poolAccount.isPaused, false, "Pool should be unpaused");

      console.log("✅ Pool unpaused");
    });

    it("should fail to pause from non-admin", async () => {
      try {
        await program.methods
          .pausePool(true)
          .accountsStrict({
            admin: user1.publicKey,
            stakingPool: stakingPool,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.message, "Unauthorized");
        console.log("✅ Correctly rejected pause from non-admin");
      }
    });
  });

  describe("Full Reward Cycle", () => {
    it("should handle multiple reward distributions correctly", async () => {
      // Distribute more rewards
      const additionalReward = 5_000 * 10 ** USDC_DECIMALS;

      // Fund reward source
      await mintTo(
        provider.connection,
        admin,
        usdcMint,
        adminUsdcAccount,
        admin,
        additionalReward
      );

      await program.methods
        .distribute(new anchor.BN(additionalReward))
        .accountsStrict({
          authority: admin.publicKey,
          stakingPool: stakingPool,
          rewardMint: usdcMint,
          rewardSource: adminUsdcAccount,
          rewardVault: rewardVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      console.log(`✅ Distributed additional ${additionalReward / 10 ** USDC_DECIMALS} USDC`);

      // Both users should be able to claim
      const user1UsdcBefore = await getAccount(provider.connection, user1UsdcAccount);
      const user2UsdcBefore = await getAccount(provider.connection, user2UsdcAccount);

      await program.methods
        .claim()
        .accountsStrict({
          user: user1.publicKey,
          stakingPool: stakingPool,
          staker: user1Staker,
          rewardMint: usdcMint,
          userRewardAccount: user1UsdcAccount,
          rewardVault: rewardVault,
          rewardVaultAuthority: rewardVaultOwner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1, rewardVaultOwner])
        .rpc();

      await program.methods
        .claim()
        .accountsStrict({
          user: user2.publicKey,
          stakingPool: stakingPool,
          staker: user2Staker,
          rewardMint: usdcMint,
          userRewardAccount: user2UsdcAccount,
          rewardVault: rewardVault,
          rewardVaultAuthority: rewardVaultOwner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2, rewardVaultOwner])
        .rpc();

      const user1UsdcAfter = await getAccount(provider.connection, user1UsdcAccount);
      const user2UsdcAfter = await getAccount(provider.connection, user2UsdcAccount);

      const user1Claimed = Number(user1UsdcAfter.amount) - Number(user1UsdcBefore.amount);
      const user2Claimed = Number(user2UsdcAfter.amount) - Number(user2UsdcBefore.amount);

      console.log(`✅ User1 claimed ${user1Claimed / 10 ** USDC_DECIMALS} USDC`);
      console.log(`✅ User2 claimed ${user2Claimed / 10 ** USDC_DECIMALS} USDC`);

      // Get final pool state
      const poolFinal = await program.account.stakingPool.fetch(stakingPool);
      console.log("\n=== Final Pool State ===");
      console.log(`Total Staked: ${poolFinal.totalStaked.toNumber() / 10 ** VLTR_DECIMALS} VLTR`);
      console.log(`Total Rewards Distributed: ${poolFinal.totalRewardsDistributed.toNumber() / 10 ** USDC_DECIMALS} USDC`);
      console.log(`Staker Count: ${poolFinal.stakerCount.toNumber()}`);
      console.log("========================\n");
    });
  });
});
