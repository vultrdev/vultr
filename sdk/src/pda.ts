// =============================================================================
// VULTR SDK PDA Derivation Helpers
// =============================================================================
// Helper functions for deriving Program Derived Addresses (PDAs) used by
// the VULTR protocol. These match the seeds defined in the on-chain program.
// =============================================================================

import { PublicKey } from "@solana/web3.js";
import {
  VULTR_PROGRAM_ID,
  POOL_SEED,
  VAULT_SEED,
  SHARE_MINT_SEED,
  DEPOSITOR_SEED,
  OPERATOR_SEED,
  PROTOCOL_FEE_VAULT_SEED,
} from "./constants";

// =============================================================================
// PDA Result Type
// =============================================================================

/**
 * Result of a PDA derivation containing both the address and bump
 */
export interface PdaResult {
  /** The derived PDA public key */
  address: PublicKey;
  /** The bump seed used for derivation */
  bump: number;
}

// =============================================================================
// Pool PDAs
// =============================================================================

/**
 * Derive the Pool PDA for a given deposit mint
 *
 * @param depositMint - The deposit token mint (e.g., USDC)
 * @param programId - Optional program ID (defaults to VULTR_PROGRAM_ID)
 * @returns PDA address and bump
 *
 * @example
 * ```typescript
 * const { address: poolPda, bump } = findPoolPda(USDC_MINT);
 * ```
 */
export function findPoolPda(
  depositMint: PublicKey,
  programId: PublicKey = VULTR_PROGRAM_ID
): PdaResult {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [POOL_SEED, depositMint.toBuffer()],
    programId
  );
  return { address, bump };
}

/**
 * Derive the Vault PDA for a given pool
 *
 * @param pool - The pool PDA
 * @param programId - Optional program ID (defaults to VULTR_PROGRAM_ID)
 * @returns PDA address and bump
 *
 * @example
 * ```typescript
 * const { address: vaultPda } = findVaultPda(poolPda);
 * ```
 */
export function findVaultPda(
  pool: PublicKey,
  programId: PublicKey = VULTR_PROGRAM_ID
): PdaResult {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, pool.toBuffer()],
    programId
  );
  return { address, bump };
}

/**
 * Derive the Share Mint PDA for a given pool
 *
 * @param pool - The pool PDA
 * @param programId - Optional program ID (defaults to VULTR_PROGRAM_ID)
 * @returns PDA address and bump
 *
 * @example
 * ```typescript
 * const { address: shareMintPda } = findShareMintPda(poolPda);
 * ```
 */
export function findShareMintPda(
  pool: PublicKey,
  programId: PublicKey = VULTR_PROGRAM_ID
): PdaResult {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [SHARE_MINT_SEED, pool.toBuffer()],
    programId
  );
  return { address, bump };
}

/**
 * Derive the Protocol Fee Vault PDA for a given pool
 *
 * @param pool - The pool PDA
 * @param programId - Optional program ID (defaults to VULTR_PROGRAM_ID)
 * @returns PDA address and bump
 *
 * @example
 * ```typescript
 * const { address: feeVaultPda } = findProtocolFeeVaultPda(poolPda);
 * ```
 */
export function findProtocolFeeVaultPda(
  pool: PublicKey,
  programId: PublicKey = VULTR_PROGRAM_ID
): PdaResult {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [PROTOCOL_FEE_VAULT_SEED, pool.toBuffer()],
    programId
  );
  return { address, bump };
}

// =============================================================================
// User PDAs
// =============================================================================

/**
 * Derive the Depositor PDA for a user in a pool
 *
 * @param pool - The pool PDA
 * @param owner - The depositor's wallet public key
 * @param programId - Optional program ID (defaults to VULTR_PROGRAM_ID)
 * @returns PDA address and bump
 *
 * @example
 * ```typescript
 * const { address: depositorPda } = findDepositorPda(poolPda, wallet.publicKey);
 * ```
 */
export function findDepositorPda(
  pool: PublicKey,
  owner: PublicKey,
  programId: PublicKey = VULTR_PROGRAM_ID
): PdaResult {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [DEPOSITOR_SEED, pool.toBuffer(), owner.toBuffer()],
    programId
  );
  return { address, bump };
}

/**
 * Derive the Operator PDA for an operator in a pool
 *
 * @param pool - The pool PDA
 * @param authority - The operator's wallet public key
 * @param programId - Optional program ID (defaults to VULTR_PROGRAM_ID)
 * @returns PDA address and bump
 *
 * @example
 * ```typescript
 * const { address: operatorPda } = findOperatorPda(poolPda, wallet.publicKey);
 * ```
 */
export function findOperatorPda(
  pool: PublicKey,
  authority: PublicKey,
  programId: PublicKey = VULTR_PROGRAM_ID
): PdaResult {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [OPERATOR_SEED, pool.toBuffer(), authority.toBuffer()],
    programId
  );
  return { address, bump };
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Derive all pool-related PDAs at once
 *
 * @param depositMint - The deposit token mint
 * @param programId - Optional program ID (defaults to VULTR_PROGRAM_ID)
 * @returns Object containing all pool PDAs
 *
 * @example
 * ```typescript
 * const pdas = findAllPoolPdas(USDC_MINT);
 * console.log(pdas.pool, pdas.vault, pdas.shareMint);
 * ```
 */
export function findAllPoolPdas(
  depositMint: PublicKey,
  programId: PublicKey = VULTR_PROGRAM_ID
): {
  pool: PdaResult;
  vault: PdaResult;
  shareMint: PdaResult;
  protocolFeeVault: PdaResult;
} {
  const pool = findPoolPda(depositMint, programId);
  const vault = findVaultPda(pool.address, programId);
  const shareMint = findShareMintPda(pool.address, programId);
  const protocolFeeVault = findProtocolFeeVaultPda(pool.address, programId);

  return {
    pool,
    vault,
    shareMint,
    protocolFeeVault,
  };
}

/**
 * Check if an account exists at a PDA
 *
 * @param connection - Solana connection
 * @param pda - The PDA to check
 * @returns true if account exists
 *
 * @example
 * ```typescript
 * const exists = await pdaExists(connection, depositorPda);
 * ```
 */
export async function pdaExists(
  connection: { getAccountInfo: (key: PublicKey) => Promise<unknown | null> },
  pda: PublicKey
): Promise<boolean> {
  const accountInfo = await connection.getAccountInfo(pda);
  return accountInfo !== null;
}
