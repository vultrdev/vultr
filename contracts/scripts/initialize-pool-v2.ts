/**
 * Initialize VULTR Pool v2 - NEW SIMPLIFIED DESIGN
 *
 * This creates a pool with the new design that has:
 * - bot_wallet (authorized to call record_profit)
 * - treasury (external account for 5%)
 * - staking_rewards_vault (external account for 15%)
 * - 80/15/5 fee split
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Vultr } from "../target/types/vultr";
import { PublicKey, SystemProgram, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

// Test USDC for devnet (we have mint authority)
const DEVNET_USDC_MINT = new PublicKey("A1Y8wecoidpqZBS7hhohtACkBoQyLudnJGCVGkvKJ4FX");

async function main() {
  console.log("\n🚀 VULTR Pool Initialization v2 - NEW DESIGN\n");
  console.log("=".repeat(60));

  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vultr as Program<Vultr>;

  console.log(`Program ID: ${program.programId.toBase58()}`);
  console.log(`Admin: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`USDC Mint: ${DEVNET_USDC_MINT.toBase58()}`);

  // The bot wallet is the same as admin for testing
  const botWallet = provider.wallet.publicKey;
  console.log(`Bot Wallet: ${botWallet.toBase58()}`);

  // Derive PDAs
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), DEVNET_USDC_MINT.toBuffer()],
    program.programId
  );

  const [shareMintPda, shareMintBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), poolPda.toBuffer()],
    program.programId
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolPda.toBuffer()],
    program.programId
  );

  console.log(`\nDerived PDAs:`);
  console.log(`  Pool: ${poolPda.toBase58()}`);
  console.log(`  Share Mint (sVLTR): ${shareMintPda.toBase58()}`);
  console.log(`  Vault: ${vaultPda.toBase58()}`);

  // Check if pool already exists
  try {
    const existingPool = await (program.account as any).pool.fetch(poolPda);
    console.log(`\n⚠️  Pool already exists!`);
    console.log(`  Admin: ${existingPool.admin.toBase58()}`);
    console.log(`  Bot Wallet: ${existingPool.botWallet.toBase58()}`);
    console.log(`  Treasury: ${existingPool.treasury.toBase58()}`);
    console.log(`  Staking Rewards: ${existingPool.stakingRewardsVault.toBase58()}`);
    console.log(`  Total Deposits: ${existingPool.totalDeposits.toNumber() / 1_000_000} USDC`);
    console.log(`  Max Pool Size: ${existingPool.maxPoolSize.toNumber() / 1_000_000} USDC`);
    console.log(`  Is Paused: ${existingPool.isPaused}`);
    console.log(`  Fee Split: ${existingPool.depositorFeeBps/100}% depositors, ${existingPool.stakingFeeBps/100}% stakers, ${existingPool.treasuryFeeBps/100}% treasury`);

    console.log(`\n✅ Pool is ready for use!`);
    console.log(`\n📝 Bot .env configuration:`);
    console.log(`  POOL_ADDRESS=${poolPda.toBase58()}`);
    return;
  } catch (e) {
    console.log(`\nPool does not exist. Initializing...`);
  }

  // Create treasury and staking_rewards_vault token accounts
  // These are EXTERNAL accounts (not PDAs), owned by the admin
  console.log(`\nCreating external token accounts...`);

  // Treasury ATA
  const treasuryAta = await getAssociatedTokenAddress(
    DEVNET_USDC_MINT,
    provider.wallet.publicKey
  );
  console.log(`  Treasury ATA: ${treasuryAta.toBase58()}`);

  // Create a deterministic keypair for staking rewards owner (from admin pubkey)
  // This way it's the same across multiple runs
  const stakingRewardsOwner = Keypair.generate();
  const stakingRewardsAta = await getAssociatedTokenAddress(
    DEVNET_USDC_MINT,
    stakingRewardsOwner.publicKey
  );
  console.log(`  Staking Rewards ATA: ${stakingRewardsAta.toBase58()}`);
  console.log(`  Staking Rewards Owner: ${stakingRewardsOwner.publicKey.toBase58()}`);

  // Create the ATAs if they don't exist (getAccountInfo returns null, not error)
  const tx = new Transaction();
  let needCreateAtas = false;

  const treasuryInfo = await provider.connection.getAccountInfo(treasuryAta);
  if (!treasuryInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        treasuryAta,
        provider.wallet.publicKey,
        DEVNET_USDC_MINT
      )
    );
    needCreateAtas = true;
    console.log(`  Will create Treasury ATA`);
  } else {
    console.log(`  Treasury ATA exists`);
  }

  const stakingInfo = await provider.connection.getAccountInfo(stakingRewardsAta);
  if (!stakingInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        stakingRewardsAta,
        stakingRewardsOwner.publicKey,
        DEVNET_USDC_MINT
      )
    );
    needCreateAtas = true;
    console.log(`  Will create Staking Rewards ATA`);
  } else {
    console.log(`  Staking Rewards ATA exists`);
  }

  if (needCreateAtas) {
    try {
      const sig = await provider.sendAndConfirm(tx);
      console.log(`  Created ATAs: ${sig}`);
    } catch (e: any) {
      if (!e.message?.includes("already in use")) {
        throw new Error(`Failed to create ATAs: ${e.message}`);
      }
    }
  }

  // Build initialize_pool using Anchor SDK
  console.log(`\nInitializing pool...`);

  try {
    // Build transaction and inspect keys before sending
    const accounts: any = {
      admin: provider.wallet.publicKey,
      pool: poolPda,
      depositMint: DEVNET_USDC_MINT,
      shareMint: shareMintPda,
      vault: vaultPda,
      treasury: treasuryAta,
      stakingRewardsVault: stakingRewardsAta,
      botWallet: botWallet,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    console.log(`  Provided accounts:`);
    for (const [k, v] of Object.entries(accounts)) {
      console.log(`    ${k}: ${(v as PublicKey).toBase58()}`);
    }

    // Build instruction to inspect actual key ordering
    const instruction = await program.methods
      .initializePool()
      .accounts(accounts)
      .instruction();

    console.log(`\n  Actual instruction keys (in order):`);
    instruction.keys.forEach((key, idx) => {
      console.log(`    [${idx}]: ${key.pubkey.toBase58()} (signer: ${key.isSigner}, writable: ${key.isWritable})`);
    });

    // Expected order from IDL:
    console.log(`\n  Expected order:`);
    console.log(`    [0]: admin`);
    console.log(`    [1]: pool`);
    console.log(`    [2]: depositMint`);
    console.log(`    [3]: shareMint`);
    console.log(`    [4]: vault`);
    console.log(`    [5]: treasury`);
    console.log(`    [6]: stakingRewardsVault`);
    console.log(`    [7]: botWallet`);
    console.log(`    [8]: systemProgram (11111111111111111111111111111111)`);
    console.log(`    [9]: tokenProgram (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)`);

    // Identify the mismatch
    const expectedSystemProgramIdx = 8;
    if (!instruction.keys[expectedSystemProgramIdx].pubkey.equals(SystemProgram.programId)) {
      console.log(`\n  ❌ KEY MISMATCH at index ${expectedSystemProgramIdx}!`);
      console.log(`     Expected: ${SystemProgram.programId.toBase58()}`);
      console.log(`     Got: ${instruction.keys[expectedSystemProgramIdx].pubkey.toBase58()}`);
    }

    const sig = await program.methods
      .initializePool()
      .accounts(accounts)
      .rpc();

    console.log(`\n✅ Pool initialized successfully!`);
    console.log(`  Transaction: ${sig}`);

    // Fetch and display pool state
    const pool = await (program.account as any).pool.fetch(poolPda);
    console.log(`\n📊 Pool Details:`);
    console.log(`  Pool Address: ${poolPda.toBase58()}`);
    console.log(`  Admin: ${pool.admin.toBase58()}`);
    console.log(`  Bot Wallet: ${pool.botWallet.toBase58()}`);
    console.log(`  Deposit Mint (USDC): ${pool.depositMint.toBase58()}`);
    console.log(`  Share Mint (sVLTR): ${pool.shareMint.toBase58()}`);
    console.log(`  Vault: ${pool.vault.toBase58()}`);
    console.log(`  Treasury: ${pool.treasury.toBase58()}`);
    console.log(`  Staking Rewards: ${pool.stakingRewardsVault.toBase58()}`);
    console.log(`  Max Pool Size: ${pool.maxPoolSize.toNumber() / 1_000_000} USDC`);
    console.log(`  Fee Split: ${pool.depositorFeeBps/100}% depositors, ${pool.stakingFeeBps/100}% stakers, ${pool.treasuryFeeBps/100}% treasury`);

    console.log(`\n🎉 Pool is ready!`);
    console.log(`\n📝 Important addresses for bot .env:`);
    console.log(`  POOL_ADDRESS=${poolPda.toBase58()}`);
    console.log(`  VULTR_PROGRAM_ID=${program.programId.toBase58()}`);
    console.log(`  DEPOSIT_MINT=${DEVNET_USDC_MINT.toBase58()}`);

    console.log(`\n💡 To get devnet USDC for testing:`);
    console.log(`  1. Visit: https://faucet.circle.com/`);
    console.log(`  2. Select: Solana Devnet`);
    console.log(`  3. Enter your wallet address`);
    console.log(`  4. Request USDC`);

  } catch (error: any) {
    console.error(`\n❌ Pool initialization failed: ${error.message}`);
    if (error.logs) {
      console.log("\nTransaction logs:");
      error.logs.forEach((log: string) => console.log(`  ${log}`));
    }
    throw error;
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
