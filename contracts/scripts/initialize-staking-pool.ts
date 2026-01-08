/**
 * Initialize VLTR Staking Pool
 *
 * This script:
 * 1. Creates a mock VLTR token mint for testing (or uses existing)
 * 2. Initializes the staking pool with the VLTR mint
 * 3. Links reward_vault to main pool's staking_rewards_vault
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { VltrStaking } from "../target/types/vltr_staking";
import { Vultr } from "../target/types/vultr";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Standard Devnet USDC
const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// VLTR token decimals (same as USDC for simplicity)
const VLTR_DECIMALS = 6;

// File to store mock VLTR mint address
const VLTR_MINT_FILE = path.join(__dirname, "vltr-mint.json");

async function main() {
  console.log("\n🦅 VLTR Staking Pool Initialization\n");
  console.log("=".repeat(60));

  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const stakingProgram = anchor.workspace.VltrStaking as Program<VltrStaking>;
  const vultrProgram = anchor.workspace.Vultr as Program<Vultr>;

  console.log(`Staking Program ID: ${stakingProgram.programId.toBase58()}`);
  console.log(`VULTR Pool Program ID: ${vultrProgram.programId.toBase58()}`);
  console.log(`Admin: ${provider.wallet.publicKey.toBase58()}`);

  // Step 1: Get or Create VLTR Mock Token
  console.log("\n📦 Step 1: VLTR Token Setup");
  console.log("-".repeat(40));

  let vltrMint: PublicKey;

  // Check if we have a saved VLTR mint
  if (fs.existsSync(VLTR_MINT_FILE)) {
    const savedMint = JSON.parse(fs.readFileSync(VLTR_MINT_FILE, "utf-8"));
    vltrMint = new PublicKey(savedMint.mint);
    console.log(`Using existing mock VLTR mint: ${vltrMint.toBase58()}`);

    // Verify it exists on-chain
    try {
      const mintInfo = await provider.connection.getAccountInfo(vltrMint);
      if (!mintInfo) {
        throw new Error("Mint not found on-chain");
      }
      console.log(`  ✅ Verified on-chain`);
    } catch (e) {
      console.log(`  ⚠️  Mint not found, creating new one...`);
      vltrMint = await createMockVltrToken(provider);
    }
  } else {
    vltrMint = await createMockVltrToken(provider);
  }

  // Step 2: Fetch main VULTR pool to get staking_rewards_vault
  console.log("\n📦 Step 2: Fetch Main VULTR Pool");
  console.log("-".repeat(40));

  const [mainPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), DEVNET_USDC_MINT.toBuffer()],
    vultrProgram.programId
  );

  let stakingRewardsVault: PublicKey;

  try {
    const mainPool = await (vultrProgram.account as any).pool.fetch(mainPoolPda);
    stakingRewardsVault = mainPool.stakingRewardsVault;
    console.log(`Main Pool: ${mainPoolPda.toBase58()}`);
    console.log(`Staking Rewards Vault: ${stakingRewardsVault.toBase58()}`);
    console.log(`  Total Deposits: ${mainPool.totalDeposits.toNumber() / 1_000_000} USDC`);
  } catch (e) {
    console.error(`\n❌ Main VULTR pool not found!`);
    console.log(`  Please run initialize-pool-v2.ts first.`);
    process.exit(1);
  }

  // Step 3: Derive Staking Pool PDAs
  console.log("\n📦 Step 3: Derive Staking Pool PDAs");
  console.log("-".repeat(40));

  const [stakingPoolPda, stakingPoolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), vltrMint.toBuffer()],
    stakingProgram.programId
  );

  const [stakeVaultPda, stakeVaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake_vault"), stakingPoolPda.toBuffer()],
    stakingProgram.programId
  );

  console.log(`Staking Pool PDA: ${stakingPoolPda.toBase58()}`);
  console.log(`Stake Vault PDA: ${stakeVaultPda.toBase58()}`);

  // Step 4: Check if staking pool already exists
  console.log("\n📦 Step 4: Check Existing Staking Pool");
  console.log("-".repeat(40));

  try {
    const existingPool = await (stakingProgram.account as any).stakingPool.fetch(stakingPoolPda);
    console.log(`⚠️  Staking pool already exists!`);
    console.log(`  Admin: ${existingPool.admin.toBase58()}`);
    console.log(`  VLTR Mint: ${existingPool.vltrMint.toBase58()}`);
    console.log(`  Reward Mint: ${existingPool.rewardMint.toBase58()}`);
    console.log(`  Stake Vault: ${existingPool.stakeVault.toBase58()}`);
    console.log(`  Reward Vault: ${existingPool.rewardVault.toBase58()}`);
    console.log(`  Total Staked: ${existingPool.totalStaked.toNumber() / 1_000_000} VLTR`);
    console.log(`  Total Rewards Distributed: ${existingPool.totalRewardsDistributed.toNumber() / 1_000_000} USDC`);
    console.log(`  Staker Count: ${existingPool.stakerCount}`);
    console.log(`  Is Paused: ${existingPool.isPaused}`);

    printConfig(vltrMint, stakingPoolPda, stakingProgram.programId);
    return;
  } catch (e) {
    console.log(`Staking pool does not exist. Initializing...`);
  }

  // Step 5: Initialize Staking Pool
  console.log("\n📦 Step 5: Initialize Staking Pool");
  console.log("-".repeat(40));

  try {
    const accounts = {
      admin: provider.wallet.publicKey,
      stakingPool: stakingPoolPda,
      vltrMint: vltrMint,
      rewardMint: DEVNET_USDC_MINT,
      stakeVault: stakeVaultPda,
      rewardVault: stakingRewardsVault,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    console.log(`Sending initialize transaction...`);
    console.log(`  Accounts:`);
    for (const [k, v] of Object.entries(accounts)) {
      console.log(`    ${k}: ${(v as PublicKey).toBase58()}`);
    }

    const sig = await stakingProgram.methods
      .initialize()
      .accounts(accounts)
      .rpc();

    console.log(`\n✅ Staking pool initialized!`);
    console.log(`  Transaction: ${sig}`);

    // Fetch and display pool state
    const pool = await (stakingProgram.account as any).stakingPool.fetch(stakingPoolPda);
    console.log(`\n📊 Staking Pool Details:`);
    console.log(`  Pool Address: ${stakingPoolPda.toBase58()}`);
    console.log(`  Admin: ${pool.admin.toBase58()}`);
    console.log(`  VLTR Mint: ${pool.vltrMint.toBase58()}`);
    console.log(`  Reward Mint (USDC): ${pool.rewardMint.toBase58()}`);
    console.log(`  Stake Vault: ${pool.stakeVault.toBase58()}`);
    console.log(`  Reward Vault: ${pool.rewardVault.toBase58()}`);
    console.log(`  Is Paused: ${pool.isPaused}`);

    printConfig(vltrMint, stakingPoolPda, stakingProgram.programId);

  } catch (error: any) {
    console.error(`\n❌ Staking pool initialization failed: ${error.message}`);
    if (error.logs) {
      console.log("\nTransaction logs:");
      error.logs.forEach((log: string) => console.log(`  ${log}`));
    }
    throw error;
  }
}

async function createMockVltrToken(provider: anchor.AnchorProvider): Promise<PublicKey> {
  console.log(`Creating mock VLTR token...`);

  // Create mint
  const mintKeypair = Keypair.generate();
  const vltrMint = await createMint(
    provider.connection,
    (provider.wallet as any).payer,
    provider.wallet.publicKey, // mint authority
    null, // freeze authority
    VLTR_DECIMALS,
    mintKeypair
  );

  console.log(`  ✅ Mock VLTR mint created: ${vltrMint.toBase58()}`);

  // Mint some tokens to admin for testing
  const adminAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (provider.wallet as any).payer,
    vltrMint,
    provider.wallet.publicKey
  );

  const mintAmount = 10_000_000 * 10 ** VLTR_DECIMALS; // 10M VLTR
  await mintTo(
    provider.connection,
    (provider.wallet as any).payer,
    vltrMint,
    adminAta.address,
    provider.wallet.publicKey,
    mintAmount
  );

  console.log(`  ✅ Minted ${mintAmount / 10 ** VLTR_DECIMALS} VLTR to admin`);
  console.log(`  Admin VLTR ATA: ${adminAta.address.toBase58()}`);

  // Save mint address for future runs
  fs.writeFileSync(
    VLTR_MINT_FILE,
    JSON.stringify({
      mint: vltrMint.toBase58(),
      createdAt: new Date().toISOString(),
      decimals: VLTR_DECIMALS,
    }, null, 2)
  );
  console.log(`  ✅ Saved mint address to ${VLTR_MINT_FILE}`);

  return vltrMint;
}

function printConfig(vltrMint: PublicKey, stakingPool: PublicKey, programId: PublicKey) {
  console.log(`\n🎉 Staking Pool Ready!`);
  console.log(`\n📝 Frontend config (src/config/staking.ts):`);
  console.log(`  export const VLTR_MINT = new PublicKey('${vltrMint.toBase58()}');`);
  console.log(`\n📝 Bot .env additions:`);
  console.log(`  STAKING_PROGRAM_ID=${programId.toBase58()}`);
  console.log(`  VLTR_MINT=${vltrMint.toBase58()}`);
  console.log(`  STAKING_POOL=${stakingPool.toBase58()}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
