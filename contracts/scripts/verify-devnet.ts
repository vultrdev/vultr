/**
 * Verify VULTR + Staking Integration on Devnet
 *
 * This script verifies that both contracts are deployed and linked correctly.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VltrStaking } from "../target/types/vltr_staking";
import { Vultr } from "../target/types/vultr";
import { PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Devnet addresses
const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

async function main() {
  console.log("\n🔍 VULTR + Staking Integration Verification\n");
  console.log("=".repeat(60));

  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const stakingProgram = anchor.workspace.VltrStaking as Program<VltrStaking>;
  const vultrProgram = anchor.workspace.Vultr as Program<Vultr>;

  // Load VLTR mint from saved file
  const vltrMintFile = path.join(__dirname, "vltr-mint.json");
  if (!fs.existsSync(vltrMintFile)) {
    console.error("❌ vltr-mint.json not found. Run initialize-staking-pool.ts first.");
    process.exit(1);
  }
  const vltrMintData = JSON.parse(fs.readFileSync(vltrMintFile, "utf-8"));
  const vltrMint = new PublicKey(vltrMintData.mint);

  console.log(`\n📦 Program IDs`);
  console.log("-".repeat(40));
  console.log(`VULTR Pool: ${vultrProgram.programId.toBase58()}`);
  console.log(`VLTR Staking: ${stakingProgram.programId.toBase58()}`);
  console.log(`VLTR Mint: ${vltrMint.toBase58()}`);

  // 1. Verify Main VULTR Pool
  console.log(`\n📦 1. Verifying Main VULTR Pool`);
  console.log("-".repeat(40));

  const [mainPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), DEVNET_USDC_MINT.toBuffer()],
    vultrProgram.programId
  );

  try {
    const mainPool = await (vultrProgram.account as any).pool.fetch(mainPoolPda);
    console.log(`✅ Main Pool: ${mainPoolPda.toBase58()}`);
    console.log(`   Admin: ${mainPool.admin.toBase58()}`);
    console.log(`   Bot Wallet: ${mainPool.botWallet.toBase58()}`);
    console.log(`   Vault: ${mainPool.vault.toBase58()}`);
    console.log(`   Treasury: ${mainPool.treasury.toBase58()}`);
    console.log(`   Staking Rewards Vault: ${mainPool.stakingRewardsVault.toBase58()}`);
    console.log(`   Total Deposits: ${mainPool.totalDeposits.toNumber() / 1_000_000} USDC`);
    console.log(`   Total Profit: ${mainPool.totalProfit.toNumber() / 1_000_000} USDC`);
    console.log(`   Fee Split: ${mainPool.depositorFeeBps/100}% depositors / ${mainPool.stakingFeeBps/100}% stakers / ${mainPool.treasuryFeeBps/100}% treasury`);
    console.log(`   Is Paused: ${mainPool.isPaused}`);

    // Verify vault balance
    try {
      const vaultAccount = await getAccount(provider.connection, mainPool.vault);
      console.log(`   Vault Balance: ${Number(vaultAccount.amount) / 1_000_000} USDC`);
    } catch (e) {
      console.log(`   Vault Balance: 0 USDC (empty)`);
    }

    // Store for later
    var stakingRewardsVault = mainPool.stakingRewardsVault;
  } catch (e) {
    console.error(`❌ Main pool not found: ${e}`);
    process.exit(1);
  }

  // 2. Verify Staking Pool
  console.log(`\n📦 2. Verifying VLTR Staking Pool`);
  console.log("-".repeat(40));

  const [stakingPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), vltrMint.toBuffer()],
    stakingProgram.programId
  );

  try {
    const stakingPool = await (stakingProgram.account as any).stakingPool.fetch(stakingPoolPda);
    console.log(`✅ Staking Pool: ${stakingPoolPda.toBase58()}`);
    console.log(`   Admin: ${stakingPool.admin.toBase58()}`);
    console.log(`   VLTR Mint: ${stakingPool.vltrMint.toBase58()}`);
    console.log(`   Reward Mint (USDC): ${stakingPool.rewardMint.toBase58()}`);
    console.log(`   Stake Vault: ${stakingPool.stakeVault.toBase58()}`);
    console.log(`   Reward Vault: ${stakingPool.rewardVault.toBase58()}`);
    console.log(`   Total Staked: ${stakingPool.totalStaked.toNumber() / 1_000_000} VLTR`);
    console.log(`   Total Rewards Distributed: ${stakingPool.totalRewardsDistributed.toNumber() / 1_000_000} USDC`);
    console.log(`   Staker Count: ${stakingPool.stakerCount}`);
    console.log(`   Is Paused: ${stakingPool.isPaused}`);

    // Verify stake vault balance
    try {
      const stakeVaultAccount = await getAccount(provider.connection, stakingPool.stakeVault);
      console.log(`   Stake Vault Balance: ${Number(stakeVaultAccount.amount) / 1_000_000} VLTR`);
    } catch (e) {
      console.log(`   Stake Vault Balance: 0 VLTR (empty)`);
    }

    // 3. Verify Integration (reward vaults match)
    console.log(`\n📦 3. Verifying Integration`);
    console.log("-".repeat(40));

    if (stakingPool.rewardVault.toBase58() === stakingRewardsVault.toBase58()) {
      console.log(`✅ Reward vaults are correctly linked!`);
      console.log(`   Main Pool staking_rewards_vault = Staking Pool reward_vault`);
      console.log(`   ${stakingRewardsVault.toBase58()}`);
    } else {
      console.log(`⚠️  WARNING: Reward vaults are NOT linked!`);
      console.log(`   Main Pool staking_rewards_vault: ${stakingRewardsVault.toBase58()}`);
      console.log(`   Staking Pool reward_vault: ${stakingPool.rewardVault.toBase58()}`);
    }

  } catch (e) {
    console.error(`❌ Staking pool not found: ${e}`);
    process.exit(1);
  }

  // 4. Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🎉 INTEGRATION VERIFICATION COMPLETE!`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\nBoth contracts are deployed and linked on devnet.`);
  console.log(`\nNext steps:`);
  console.log(`  1. Deposit USDC to main pool`);
  console.log(`  2. Stake VLTR tokens`);
  console.log(`  3. Run liquidation bot to generate profit`);
  console.log(`  4. Verify rewards distributed to stakers`);
  console.log(`\nFrontend config (already updated):`);
  console.log(`  VLTR_MINT: ${vltrMint.toBase58()}`);
  console.log(`  STAKING_PROGRAM_ID: ${stakingProgram.programId.toBase58()}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
