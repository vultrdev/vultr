/**
 * VULTR Full Flow Integration Test
 * Tests the complete protocol with real test USDC
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Vultr } from "../target/types/vultr";
import {
  PublicKey,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("VULTR Full Flow Test", () => {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vultr as Program<Vultr>;

  // Test USDC mint (created earlier)
  const depositMint = new PublicKey("87D21QTt9LdkxQpcHnWaFLbDUjC3qxv3KGqZHSMXi62y");
  const collateralMint = new PublicKey("ALV1pvBPN5MCNUNvyKmi3okHdWNQNTj5rHpWQLJDrFMj");

  // Admin wallet (from test-wallet.json)
  const admin = provider.wallet;

  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), depositMint.toBuffer()],
    program.programId
  );

  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), poolPda.toBuffer()],
    program.programId
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolPda.toBuffer()],
    program.programId
  );

  const [protocolFeeVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_fee_vault"), poolPda.toBuffer()],
    program.programId
  );

  console.log("\n🚀 VULTR FULL FLOW TEST");
  console.log("=" .repeat(80));
  console.log(`Program ID: ${program.programId.toBase58()}`);
  console.log(`Admin: ${admin.publicKey.toBase58()}`);
  console.log(`Test USDC Mint: ${depositMint.toBase58()}`);
  console.log(`Pool PDA: ${poolPda.toBase58()}`);
  console.log("=" .repeat(80) + "\n");

  it("Initializes the pool", async () => {
    console.log("\n📋 TEST 1: Initialize Pool");
    console.log("-".repeat(80));

    try {
      const tx = await program.methods
        .initializePool()
        .accounts({
          admin: admin.publicKey,
          depositMint: depositMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      console.log(`✅ Pool initialized! Tx: ${tx}`);

      // Fetch and verify pool state
      const pool = await program.account.pool.fetch(poolPda);
      console.log(`\nPool State:`);
      console.log(`  Admin: ${pool.admin.toBase58()}`);
      console.log(`  Deposit Mint: ${pool.depositMint.toBase58()}`);
      console.log(`  Share Mint (sVLTR): ${pool.shareMint.toBase58()}`);
      console.log(`  Max Pool Size: ${pool.maxPoolSize.toNumber() / 1_000_000} USDC`);
      console.log(`  Total Deposits: ${pool.totalDeposits.toNumber()}`);
      console.log(`  Total Shares: ${pool.totalShares.toNumber()}`);
      console.log(`  Protocol Fee: ${pool.protocolFeeBps / 100}%`);
      console.log(`  Operator Fee: ${pool.operatorFeeBps / 100}%`);
      console.log(`  Depositor Share: ${pool.depositorShareBps / 100}%`);

      // Assertions
      assert.equal(pool.admin.toBase58(), admin.publicKey.toBase58());
      assert.equal(pool.depositMint.toBase58(), depositMint.toBase58());
      assert.equal(pool.maxPoolSize.toNumber(), 500_000_000_000); // 500K USDC
      assert.equal(pool.totalDeposits.toNumber(), 0);
      assert.equal(pool.totalShares.toNumber(), 0);

      console.log("\n✅ Pool initialization test PASSED\n");
    } catch (error) {
      console.error(`❌ Pool initialization FAILED:`, error);
      throw error;
    }
  });

  console.log("\n🎉 ALL TESTS COMPLETED!");
});
