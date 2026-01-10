// =============================================================================
// P0 Security Tests: Jupiter Transaction Validation (FIX-3)
// =============================================================================
// Tests for Jupiter transaction validation that ensures we only sign
// transactions containing known, safe programs.
// =============================================================================

import { PublicKey, Transaction, TransactionInstruction, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Known program IDs that should be allowed
const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
const COMPUTE_BUDGET_PROGRAM = new PublicKey("ComputeBudget111111111111111111111111111111");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Malicious program IDs for testing (generated keypairs)
const MALICIOUS_PROGRAM = Keypair.generate().publicKey;
const UNKNOWN_PROGRAM = Keypair.generate().publicKey;

// Replicate the validation logic from executor.ts
const ALLOWED_PROGRAMS = [
  JUPITER_PROGRAM_ID.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM.toBase58(),
  COMPUTE_BUDGET_PROGRAM.toBase58(),
  SYSTEM_PROGRAM_ID.toBase58(),
];

/**
 * Validate Jupiter transaction before signing
 * This is the function we're testing - extracted from executor.ts
 */
function validateJupiterTransaction(transaction: Transaction): void {
  for (const ix of transaction.instructions) {
    const programId = ix.programId.toBase58();
    if (!ALLOWED_PROGRAMS.includes(programId)) {
      throw new Error(`Unexpected program in Jupiter tx: ${programId}`);
    }

    // Check for suspicious SOL transfers to unknown accounts
    if (programId === SYSTEM_PROGRAM_ID.toBase58()) {
      // System program transfer instruction has specific layout
      if (ix.data.length >= 12) {
        const instructionType = ix.data.readUInt32LE(0);
        // 2 = Transfer instruction
        if (instructionType === 2) {
          const lamports = ix.data.readBigUInt64LE(4);
          if (lamports > 100_000_000n) { // > 0.1 SOL
            console.warn(`Large SOL transfer in Jupiter tx: ${lamports} lamports`);
          }
        }
      }
    }
  }
}

/**
 * Create a mock instruction for testing
 */
function createMockInstruction(programId: PublicKey, data?: Buffer): TransactionInstruction {
  return new TransactionInstruction({
    keys: [
      { pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true },
    ],
    programId,
    data: data || Buffer.alloc(0),
  });
}

describe("Jupiter Transaction Validation (FIX-3)", () => {
  describe("Allowed Programs", () => {
    it("should ALLOW transactions with Jupiter program", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(JUPITER_PROGRAM_ID));

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });

    it("should ALLOW transactions with Token program", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(TOKEN_PROGRAM_ID));

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });

    it("should ALLOW transactions with System program", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(SYSTEM_PROGRAM_ID));

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });

    it("should ALLOW transactions with ComputeBudget program", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(COMPUTE_BUDGET_PROGRAM));

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });

    it("should ALLOW transactions with Associated Token program", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(ASSOCIATED_TOKEN_PROGRAM));

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });

    it("should ALLOW transactions with multiple allowed programs", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(COMPUTE_BUDGET_PROGRAM));
      tx.add(createMockInstruction(TOKEN_PROGRAM_ID));
      tx.add(createMockInstruction(JUPITER_PROGRAM_ID));
      tx.add(createMockInstruction(SYSTEM_PROGRAM_ID));

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });
  });

  describe("Rejected Programs", () => {
    it("should REJECT transactions with unknown programs", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(UNKNOWN_PROGRAM));

      expect(() => validateJupiterTransaction(tx)).toThrow(
        /Unexpected program in Jupiter tx/
      );
    });

    it("should REJECT transactions with malicious programs", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(MALICIOUS_PROGRAM));

      expect(() => validateJupiterTransaction(tx)).toThrow(
        /Unexpected program in Jupiter tx/
      );
    });

    it("should REJECT transactions mixing allowed and unknown programs", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(JUPITER_PROGRAM_ID)); // Allowed
      tx.add(createMockInstruction(TOKEN_PROGRAM_ID)); // Allowed
      tx.add(createMockInstruction(UNKNOWN_PROGRAM)); // NOT allowed

      expect(() => validateJupiterTransaction(tx)).toThrow(
        /Unexpected program in Jupiter tx/
      );
    });

    it("should include the unknown program ID in error message", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(MALICIOUS_PROGRAM));

      expect(() => validateJupiterTransaction(tx)).toThrow(
        MALICIOUS_PROGRAM.toBase58()
      );
    });
  });

  describe("Large SOL Transfer Detection", () => {
    it("should warn on large SOL transfers (>0.1 SOL)", () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

      // Create a System program transfer instruction
      // Layout: 4 bytes instruction type (2 = Transfer) + 8 bytes lamports
      const data = Buffer.alloc(12);
      data.writeUInt32LE(2, 0); // Transfer instruction
      data.writeBigUInt64LE(200_000_000n, 4); // 0.2 SOL

      const tx = new Transaction();
      tx.add(createMockInstruction(SYSTEM_PROGRAM_ID, data));

      // Should not throw, but should warn
      expect(() => validateJupiterTransaction(tx)).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Large SOL transfer")
      );

      consoleWarnSpy.mockRestore();
    });

    it("should NOT warn on small SOL transfers (<0.1 SOL)", () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

      const data = Buffer.alloc(12);
      data.writeUInt32LE(2, 0); // Transfer instruction
      data.writeBigUInt64LE(50_000_000n, 4); // 0.05 SOL

      const tx = new Transaction();
      tx.add(createMockInstruction(SYSTEM_PROGRAM_ID, data));

      validateJupiterTransaction(tx);
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty transactions", () => {
      const tx = new Transaction();

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });

    it("should handle transactions with many instructions", () => {
      const tx = new Transaction();
      for (let i = 0; i < 20; i++) {
        tx.add(createMockInstruction(TOKEN_PROGRAM_ID));
      }

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });

    it("should handle instructions with empty data", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(JUPITER_PROGRAM_ID, Buffer.alloc(0)));

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });

    it("should handle instructions with large data", () => {
      const tx = new Transaction();
      tx.add(createMockInstruction(JUPITER_PROGRAM_ID, Buffer.alloc(1000)));

      expect(() => validateJupiterTransaction(tx)).not.toThrow();
    });
  });

  describe("Real-World Attack Scenarios", () => {
    it("should REJECT drain attack with malicious program", () => {
      // Simulate an attack where Jupiter returns a tx with a drain program
      const tx = new Transaction();
      tx.add(createMockInstruction(COMPUTE_BUDGET_PROGRAM)); // Looks normal
      tx.add(createMockInstruction(TOKEN_PROGRAM_ID)); // Looks normal
      tx.add(createMockInstruction(JUPITER_PROGRAM_ID)); // Looks normal
      // Attacker injects malicious program that drains wallet
      tx.add(createMockInstruction(Keypair.generate().publicKey));

      expect(() => validateJupiterTransaction(tx)).toThrow(
        /Unexpected program in Jupiter tx/
      );
    });

    it("should REJECT sandwich attack with unknown DEX", () => {
      // Simulate sandwich attack using unknown DEX
      const unknownDex = Keypair.generate().publicKey;
      const tx = new Transaction();
      tx.add(createMockInstruction(unknownDex)); // Unknown DEX - could be sandwich

      expect(() => validateJupiterTransaction(tx)).toThrow();
    });
  });
});
