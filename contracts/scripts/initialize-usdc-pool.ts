/**
 * Initialize VULTR Pool with Standard Devnet USDC
 *
 * This creates a persistent pool using the standard devnet USDC mint
 * that users can get from Circle faucet: https://faucet.circle.com/
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vultr } from "../target/types/vultr";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Standard Devnet USDC (Circle faucet compatible)
const DEVNET_USDC_MINT = new PublicKey("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr");

async function main() {
  console.log("\n🚀 VULTR Pool Initialization - Standard Devnet USDC\n");
  console.log("=".repeat(60));

  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vultr as Program<Vultr>;

  console.log(`Program ID: ${program.programId.toBase58()}`);
  console.log(`Admin: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`USDC Mint: ${DEVNET_USDC_MINT.toBase58()}`);

  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), DEVNET_USDC_MINT.toBuffer()],
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

  console.log(`\nDerived PDAs:`);
  console.log(`  Pool: ${poolPda.toBase58()}`);
  console.log(`  Share Mint (sVLTR): ${shareMintPda.toBase58()}`);
  console.log(`  Vault: ${vaultPda.toBase58()}`);
  console.log(`  Protocol Fee Vault: ${protocolFeeVaultPda.toBase58()}`);

  // Check if pool already exists
  try {
    const existingPool = await program.account.pool.fetch(poolPda);
    console.log(`\n⚠️  Pool already exists!`);
    console.log(`  Admin: ${existingPool.admin.toBase58()}`);
    console.log(`  Total Deposits: ${existingPool.totalDeposits.toNumber() / 1_000_000} USDC`);
    console.log(`  Total Shares: ${existingPool.totalShares.toNumber() / 1_000_000} sVLTR`);
    console.log(`  Max Pool Size: ${existingPool.maxPoolSize.toNumber() / 1_000_000} USDC`);
    console.log(`  Is Paused: ${existingPool.isPaused}`);

    // Calculate share price
    const sharePrice = existingPool.totalShares.toNumber() > 0
      ? existingPool.totalDeposits.toNumber() / existingPool.totalShares.toNumber()
      : 1.0;
    console.log(`  Share Price: ${sharePrice.toFixed(4)} USDC`);

    console.log(`\n✅ Pool is ready for use!`);
    return;
  } catch (e) {
    // Pool doesn't exist, continue with initialization
    console.log(`\nPool does not exist. Initializing...`);
  }

  // Initialize pool
  try {
    const tx = await program.methods
      .initializePool()
      .accountsStrict({
        admin: provider.wallet.publicKey,
        pool: poolPda,
        depositMint: DEVNET_USDC_MINT,
        shareMint: shareMintPda,
        vault: vaultPda,
        protocolFeeVault: protocolFeeVaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`\n✅ Pool initialized successfully!`);
    console.log(`  Transaction: ${tx}`);

    // Fetch and display pool state
    const pool = await program.account.pool.fetch(poolPda);
    console.log(`\nPool Details:`);
    console.log(`  Admin: ${pool.admin.toBase58()}`);
    console.log(`  Deposit Mint (USDC): ${pool.depositMint.toBase58()}`);
    console.log(`  Share Mint (sVLTR): ${pool.shareMint.toBase58()}`);
    console.log(`  Max Pool Size: ${pool.maxPoolSize.toNumber() / 1_000_000} USDC`);
    console.log(`  Protocol Fee: ${pool.protocolFeeBps / 100}%`);
    console.log(`  Operator Fee: ${pool.operatorFeeBps / 100}%`);
    console.log(`  Depositor Share: ${pool.depositorShareBps / 100}%`);

    console.log(`\n🎉 Pool is ready!`);
    console.log(`\nTo get devnet USDC for testing:`);
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
