// =============================================================================
// VULTR SDK Client
// =============================================================================
// Main client class for interacting with the VULTR protocol.
// Provides high-level methods for all protocol operations.
// =============================================================================

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  TransactionSignature,
  ConfirmOptions,
  SendOptions,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { Program, AnchorProvider, Wallet, BN, Idl } from "@coral-xyz/anchor";

import { VULTR_PROGRAM_ID, BPS_DENOMINATOR } from "./constants";
import {
  Pool,
  Depositor,
  Operator,
  OperatorStatus,
  ShareCalculation,
  WithdrawalCalculation,
  FeeDistribution,
  PoolStats,
  UserPosition,
} from "./types";
import {
  findPoolPda,
  findVaultPda,
  findShareMintPda,
  findProtocolFeeVaultPda,
  findDepositorPda,
  findOperatorPda,
  findAllPoolPdas,
} from "./pda";

// =============================================================================
// IDL Type (simplified - in production, import generated IDL)
// =============================================================================

// Note: In production, you would import the generated IDL from target/types
// For now, we define a minimal interface
interface VultrProgram {
  methods: {
    initializePool(): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    deposit(amount: BN): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    withdraw(sharesToBurn: BN): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    registerOperator(stakeAmount: BN): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    deregisterOperator(): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    requestOperatorWithdrawal(): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    executeLiquidation(profit: BN): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    pausePool(paused: boolean): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    updateFees(
      protocolFeeBps: number,
      operatorFeeBps: number,
      depositorShareBps: number
    ): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    updateOperatorCooldown(cooldownSeconds: BN): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    withdrawProtocolFees(): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
    transferAdmin(): {
      accounts: (accounts: Record<string, PublicKey>) => {
        rpc: (opts?: ConfirmOptions) => Promise<TransactionSignature>;
        instruction: () => Promise<TransactionInstruction>;
      };
    };
  };
  account: {
    pool: {
      fetch: (address: PublicKey) => Promise<Pool>;
      fetchNullable: (address: PublicKey) => Promise<Pool | null>;
    };
    depositor: {
      fetch: (address: PublicKey) => Promise<Depositor>;
      fetchNullable: (address: PublicKey) => Promise<Depositor | null>;
    };
    operator: {
      fetch: (address: PublicKey) => Promise<Operator>;
      fetchNullable: (address: PublicKey) => Promise<Operator | null>;
    };
  };
}

// =============================================================================
// Client Options
// =============================================================================

/**
 * Options for creating a VultrClient
 */
export interface VultrClientOptions {
  /** Solana connection */
  connection: Connection;
  /** Wallet for signing transactions (optional for read-only operations) */
  wallet?: Wallet;
  /** Custom program ID (defaults to VULTR_PROGRAM_ID) */
  programId?: PublicKey;
  /** Default confirm options */
  confirmOptions?: ConfirmOptions;
}

// =============================================================================
// VultrClient Class
// =============================================================================

/**
 * Main client for interacting with the VULTR protocol
 *
 * @example
 * ```typescript
 * // Create a client
 * const client = new VultrClient({
 *   connection: new Connection("https://api.devnet.solana.com"),
 *   wallet: new Wallet(keypair),
 * });
 *
 * // Get pool info
 * const pool = await client.getPool(USDC_MINT);
 *
 * // Deposit
 * const tx = await client.deposit(USDC_MINT, new BN(1000_000_000));
 * ```
 */
export class VultrClient {
  /** Solana connection */
  public readonly connection: Connection;
  /** Wallet for signing */
  public readonly wallet: Wallet | null;
  /** Program ID */
  public readonly programId: PublicKey;
  /** Anchor provider */
  public readonly provider: AnchorProvider | null;
  /** Anchor program (requires IDL to be loaded) */
  private program: VultrProgram | null = null;
  /** Default confirm options */
  public readonly confirmOptions: ConfirmOptions;

  constructor(options: VultrClientOptions) {
    this.connection = options.connection;
    this.wallet = options.wallet ?? null;
    this.programId = options.programId ?? VULTR_PROGRAM_ID;
    this.confirmOptions = options.confirmOptions ?? {
      commitment: "confirmed",
    };

    // Create provider if wallet is available
    if (this.wallet) {
      this.provider = new AnchorProvider(
        this.connection,
        this.wallet,
        this.confirmOptions
      );
    } else {
      this.provider = null;
    }
  }

  // ===========================================================================
  // Program Initialization
  // ===========================================================================

  /**
   * Initialize the Anchor program with IDL
   * Call this before using transaction methods
   *
   * @param idl - The program IDL (from target/types/vultr.ts)
   */
  public setProgram(idl: Idl): void {
    if (!this.provider) {
      throw new Error("Cannot set program without a wallet");
    }
    // Anchor 0.29+ accepts (idl, provider) - program ID is in idl.address
    // For custom program IDs, we modify the IDL
    const idlWithAddress = {
      ...idl,
      address: this.programId.toBase58(),
    };
    this.program = new Program(
      idlWithAddress,
      this.provider
    ) as unknown as VultrProgram;
  }

  /**
   * Get the program instance
   * @throws Error if program not initialized
   */
  private getProgram(): VultrProgram {
    if (!this.program) {
      throw new Error(
        "Program not initialized. Call setProgram(idl) first."
      );
    }
    return this.program;
  }

  // ===========================================================================
  // PDA Helpers
  // ===========================================================================

  /**
   * Get pool PDA for a deposit mint
   */
  public getPoolPda(depositMint: PublicKey): PublicKey {
    return findPoolPda(depositMint, this.programId).address;
  }

  /**
   * Get all PDAs for a pool
   */
  public getAllPoolPdas(depositMint: PublicKey) {
    return findAllPoolPdas(depositMint, this.programId);
  }

  /**
   * Get depositor PDA for a user
   */
  public getDepositorPda(pool: PublicKey, owner: PublicKey): PublicKey {
    return findDepositorPda(pool, owner, this.programId).address;
  }

  /**
   * Get operator PDA for a user
   */
  public getOperatorPda(pool: PublicKey, authority: PublicKey): PublicKey {
    return findOperatorPda(pool, authority, this.programId).address;
  }

  // ===========================================================================
  // Account Fetching
  // ===========================================================================

  /**
   * Fetch pool account data
   *
   * @param depositMint - The deposit token mint
   * @returns Pool account data or null if not found
   */
  public async getPool(depositMint: PublicKey): Promise<Pool | null> {
    const poolPda = this.getPoolPda(depositMint);
    return this.getPoolByAddress(poolPda);
  }

  /**
   * Fetch pool account by PDA address
   */
  public async getPoolByAddress(poolPda: PublicKey): Promise<Pool | null> {
    try {
      const program = this.getProgram();
      return await program.account.pool.fetchNullable(poolPda);
    } catch {
      // If program not initialized, fetch raw account
      const accountInfo = await this.connection.getAccountInfo(poolPda);
      if (!accountInfo) return null;
      // Would need to manually deserialize - for now return null
      console.warn("Pool account exists but program not initialized for deserialization");
      return null;
    }
  }

  /**
   * Fetch depositor account data
   *
   * @param pool - Pool PDA
   * @param owner - Depositor wallet
   * @returns Depositor account data or null if not found
   */
  public async getDepositor(
    pool: PublicKey,
    owner: PublicKey
  ): Promise<Depositor | null> {
    const depositorPda = this.getDepositorPda(pool, owner);
    try {
      const program = this.getProgram();
      return await program.account.depositor.fetchNullable(depositorPda);
    } catch {
      return null;
    }
  }

  /**
   * Fetch operator account data
   *
   * @param pool - Pool PDA
   * @param authority - Operator wallet
   * @returns Operator account data or null if not found
   */
  public async getOperator(
    pool: PublicKey,
    authority: PublicKey
  ): Promise<Operator | null> {
    const operatorPda = this.getOperatorPda(pool, authority);
    try {
      const program = this.getProgram();
      return await program.account.operator.fetchNullable(operatorPda);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Calculations
  // ===========================================================================

  /**
   * Calculate shares that would be minted for a deposit amount
   *
   * @param pool - Pool account data
   * @param depositAmount - Amount to deposit
   * @returns Share calculation details
   *
   * Note: total_deposits already includes the depositor share (80%) of profits
   * from liquidations. The total_profit field is for statistics only and should
   * NOT be added to total_deposits to avoid double-counting.
   */
  public calculateShares(pool: Pool, depositAmount: BN): ShareCalculation {
    const totalShares = pool.totalShares;

    // Total pool value = total_deposits (which already includes depositor profits)
    // Do NOT add totalProfit here - it would double count!
    const totalValue = pool.totalDeposits;

    let sharesToMint: BN;
    let sharePrice: BN;

    if (totalShares.isZero()) {
      // First deposit: 1:1 ratio
      sharesToMint = depositAmount;
      sharePrice = new BN(1_000_000); // 1.0 scaled by 1e6
    } else {
      // shares = (deposit * total_shares) / total_value
      sharesToMint = depositAmount.mul(totalShares).div(totalValue);
      // price = total_value / total_shares (scaled by 1e6)
      sharePrice = totalValue.mul(new BN(1_000_000)).div(totalShares);
    }

    const exchangeRate = totalShares.isZero()
      ? "1:1"
      : `1 share = ${sharePrice.toNumber() / 1_000_000} tokens`;

    return {
      sharesToMint,
      sharePrice,
      exchangeRate,
    };
  }

  /**
   * Calculate withdrawal amount for burning shares
   *
   * @param pool - Pool account data
   * @param sharesToBurn - Number of shares to burn
   * @returns Withdrawal calculation details
   *
   * Note: total_deposits already includes the depositor share (80%) of profits
   * from liquidations. The total_profit field is for statistics only.
   */
  public calculateWithdrawal(
    pool: Pool,
    sharesToBurn: BN
  ): WithdrawalCalculation {
    const totalShares = pool.totalShares;

    // Total pool value = total_deposits (which already includes depositor profits)
    // Do NOT add totalProfit here - it would double count!
    const totalValue = pool.totalDeposits;

    // withdrawal = (shares * total_value) / total_shares
    const withdrawalAmount = sharesToBurn.mul(totalValue).div(totalShares);

    // price = total_value / total_shares (scaled by 1e6)
    const sharePrice = totalValue.mul(new BN(1_000_000)).div(totalShares);

    const exchangeRate = `1 share = ${sharePrice.toNumber() / 1_000_000} tokens`;

    return {
      withdrawalAmount,
      sharePrice,
      exchangeRate,
    };
  }

  /**
   * Calculate fee distribution for a liquidation profit
   *
   * @param pool - Pool account data
   * @param profit - Total profit to distribute
   * @returns Fee distribution breakdown
   */
  public calculateFeeDistribution(pool: Pool, profit: BN): FeeDistribution {
    const protocolFee = profit
      .mul(new BN(pool.protocolFeeBps))
      .div(new BN(BPS_DENOMINATOR));

    const operatorFee = profit
      .mul(new BN(pool.operatorFeeBps))
      .div(new BN(BPS_DENOMINATOR));

    const depositorProfit = profit
      .mul(new BN(pool.depositorShareBps))
      .div(new BN(BPS_DENOMINATOR));

    return {
      protocolFee,
      operatorFee,
      depositorProfit,
      totalProfit: profit,
    };
  }

  /**
   * Get pool statistics
   *
   * @param depositMint - The deposit token mint
   * @returns Pool statistics or null if pool doesn't exist
   *
   * Note: TVL is total_deposits which already includes depositor profits.
   * total_profit is shown separately for statistics only.
   */
  public async getPoolStats(depositMint: PublicKey): Promise<PoolStats | null> {
    const pool = await this.getPool(depositMint);
    if (!pool) return null;

    // TVL = total_deposits (already includes depositor share of profits)
    const tvl = pool.totalDeposits;
    const sharePrice = pool.totalShares.isZero()
      ? new BN(1_000_000)
      : tvl.mul(new BN(1_000_000)).div(pool.totalShares);

    return {
      tvl,
      totalShares: pool.totalShares,
      sharePrice,
      totalProfit: pool.totalProfit,
      operatorCount: pool.operatorCount,
    };
  }

  /**
   * Get user's position in a pool
   *
   * @param depositMint - The deposit token mint
   * @param user - User's wallet
   * @returns User position or null
   *
   * Note: total_deposits already includes depositor profits from liquidations.
   */
  public async getUserPosition(
    depositMint: PublicKey,
    user: PublicKey
  ): Promise<UserPosition | null> {
    const poolPda = this.getPoolPda(depositMint);
    const pool = await this.getPoolByAddress(poolPda);
    if (!pool) return null;

    const depositor = await this.getDepositor(poolPda, user);

    // Get user's share token balance
    const shareMint = findShareMintPda(poolPda, this.programId).address;
    let shares = new BN(0);

    try {
      const shareAta = await getAssociatedTokenAddress(shareMint, user);
      const shareAccount = await getAccount(this.connection, shareAta);
      shares = new BN(shareAccount.amount.toString());
    } catch {
      // No share account
    }

    // Calculate current value
    // total_deposits already includes depositor share of profits
    const totalValue = pool.totalDeposits;
    const value = pool.totalShares.isZero()
      ? new BN(0)
      : shares.mul(totalValue).div(pool.totalShares);

    const totalDeposited = depositor?.totalDeposited ?? new BN(0);
    const totalWithdrawn = depositor?.totalWithdrawn ?? new BN(0);

    // Unrealized P&L = current value - (deposited - withdrawn)
    const costBasis = totalDeposited.sub(totalWithdrawn);
    const unrealizedPnl = value.sub(costBasis);

    return {
      shares,
      value,
      totalDeposited,
      totalWithdrawn,
      unrealizedPnl,
      hasDepositorAccount: depositor !== null,
    };
  }

  // ===========================================================================
  // Transaction Builders
  // ===========================================================================

  /**
   * Build initialize pool transaction
   *
   * @param depositMint - The deposit token mint
   * @returns Transaction signature
   */
  public async initializePool(
    depositMint: PublicKey
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const pdas = this.getAllPoolPdas(depositMint);

    return await program.methods
      .initializePool()
      .accounts({
        admin: this.wallet.publicKey,
        pool: pdas.pool.address,
        depositMint,
        shareMint: pdas.shareMint.address,
        vault: pdas.vault.address,
        protocolFeeVault: pdas.protocolFeeVault.address,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc(this.confirmOptions);
  }

  /**
   * Build deposit transaction
   *
   * @param depositMint - The deposit token mint
   * @param amount - Amount to deposit (in base units)
   * @returns Transaction signature
   */
  public async deposit(
    depositMint: PublicKey,
    amount: BN
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const pdas = this.getAllPoolPdas(depositMint);
    const depositorPda = this.getDepositorPda(
      pdas.pool.address,
      this.wallet.publicKey
    );

    // Get user token accounts
    const userDepositAta = await getAssociatedTokenAddress(
      depositMint,
      this.wallet.publicKey
    );
    const userShareAta = await getAssociatedTokenAddress(
      pdas.shareMint.address,
      this.wallet.publicKey
    );

    // Check if share ATA needs to be created
    const preInstructions: TransactionInstruction[] = [];
    try {
      await getAccount(this.connection, userShareAta);
    } catch {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          this.wallet.publicKey,
          userShareAta,
          this.wallet.publicKey,
          pdas.shareMint.address
        )
      );
    }

    const builder = program.methods.deposit(amount).accounts({
      depositor: this.wallet.publicKey,
      pool: pdas.pool.address,
      depositorAccount: depositorPda,
      depositMint,
      shareMint: pdas.shareMint.address,
      userDepositAccount: userDepositAta,
      userShareAccount: userShareAta,
      vault: pdas.vault.address,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

    if (preInstructions.length > 0) {
      // Need to manually build transaction with pre-instructions
      const ix = await builder.instruction();
      const tx = new Transaction().add(...preInstructions, ix);
      const latestBlockhash = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.feePayer = this.wallet.publicKey;
      const signed = await this.wallet.signTransaction(tx);
      return await this.connection.sendRawTransaction(signed.serialize());
    }

    return await builder.rpc(this.confirmOptions);
  }

  /**
   * Build withdraw transaction
   *
   * @param depositMint - The deposit token mint
   * @param sharesToBurn - Number of shares to burn
   * @returns Transaction signature
   */
  public async withdraw(
    depositMint: PublicKey,
    sharesToBurn: BN
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const pdas = this.getAllPoolPdas(depositMint);
    const depositorPda = this.getDepositorPda(
      pdas.pool.address,
      this.wallet.publicKey
    );

    // Get user token accounts
    const userDepositAta = await getAssociatedTokenAddress(
      depositMint,
      this.wallet.publicKey
    );
    const userShareAta = await getAssociatedTokenAddress(
      pdas.shareMint.address,
      this.wallet.publicKey
    );

    return await program.methods
      .withdraw(sharesToBurn)
      .accounts({
        withdrawer: this.wallet.publicKey,
        pool: pdas.pool.address,
        depositorAccount: depositorPda,
        depositMint,
        shareMint: pdas.shareMint.address,
        userDepositAccount: userDepositAta,
        userShareAccount: userShareAta,
        vault: pdas.vault.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc(this.confirmOptions);
  }

  /**
   * Build register operator transaction
   *
   * @param depositMint - The deposit token mint
   * @param stakeAmount - Amount to stake
   * @returns Transaction signature
   */
  public async registerOperator(
    depositMint: PublicKey,
    stakeAmount: BN
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const pdas = this.getAllPoolPdas(depositMint);
    const operatorPda = this.getOperatorPda(
      pdas.pool.address,
      this.wallet.publicKey
    );

    const operatorDepositAta = await getAssociatedTokenAddress(
      depositMint,
      this.wallet.publicKey
    );

    return await program.methods
      .registerOperator(stakeAmount)
      .accounts({
        authority: this.wallet.publicKey,
        pool: pdas.pool.address,
        operator: operatorPda,
        depositMint,
        operatorDepositAccount: operatorDepositAta,
        vault: pdas.vault.address,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc(this.confirmOptions);
  }

  /**
   * Build deregister operator transaction
   *
   * @param depositMint - The deposit token mint
   * @returns Transaction signature
   */
  public async deregisterOperator(
    depositMint: PublicKey
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const pdas = this.getAllPoolPdas(depositMint);
    const operatorPda = this.getOperatorPda(
      pdas.pool.address,
      this.wallet.publicKey
    );

    const operatorDepositAta = await getAssociatedTokenAddress(
      depositMint,
      this.wallet.publicKey
    );

    return await program.methods
      .deregisterOperator()
      .accounts({
        authority: this.wallet.publicKey,
        pool: pdas.pool.address,
        operator: operatorPda,
        depositMint,
        operatorDepositAccount: operatorDepositAta,
        vault: pdas.vault.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc(this.confirmOptions);
  }

  /**
   * Build execute liquidation transaction
   *
   * @param depositMint - The deposit token mint
   * @param profit - Profit from liquidation (mock parameter)
   * @returns Transaction signature
   */
  public async executeLiquidation(
    depositMint: PublicKey,
    profit: BN
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const pdas = this.getAllPoolPdas(depositMint);
    const operatorPda = this.getOperatorPda(
      pdas.pool.address,
      this.wallet.publicKey
    );

    const operatorTokenAta = await getAssociatedTokenAddress(
      depositMint,
      this.wallet.publicKey
    );

    return await program.methods
      .executeLiquidation(profit)
      .accounts({
        operatorAuthority: this.wallet.publicKey,
        pool: pdas.pool.address,
        operator: operatorPda,
        depositMint,
        vault: pdas.vault.address,
        protocolFeeVault: pdas.protocolFeeVault.address,
        operatorTokenAccount: operatorTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc(this.confirmOptions);
  }

  // ===========================================================================
  // Admin Methods
  // ===========================================================================

  /**
   * Request operator withdrawal (starts cooldown)
   *
   * @param depositMint - The deposit token mint
   * @returns Transaction signature
   */
  public async requestOperatorWithdrawal(
    depositMint: PublicKey
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const poolPda = this.getPoolPda(depositMint);
    const operatorPda = this.getOperatorPda(poolPda, this.wallet.publicKey);

    return await program.methods
      .requestOperatorWithdrawal()
      .accounts({
        authority: this.wallet.publicKey,
        pool: poolPda,
        operator: operatorPda,
      })
      .rpc(this.confirmOptions);
  }

  /**
   * Pause or unpause a pool (admin only)
   *
   * @param depositMint - The deposit token mint
   * @param paused - true to pause, false to unpause
   * @returns Transaction signature
   */
  public async pausePool(
    depositMint: PublicKey,
    paused: boolean
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const poolPda = this.getPoolPda(depositMint);

    return await program.methods
      .pausePool(paused)
      .accounts({
        admin: this.wallet.publicKey,
        pool: poolPda,
      })
      .rpc(this.confirmOptions);
  }

  /**
   * Update pool fees (admin only)
   *
   * @param depositMint - The deposit token mint
   * @param protocolFeeBps - New protocol fee in basis points
   * @param operatorFeeBps - New operator fee in basis points
   * @param depositorShareBps - New depositor share in basis points
   * @returns Transaction signature
   */
  public async updateFees(
    depositMint: PublicKey,
    protocolFeeBps: number,
    operatorFeeBps: number,
    depositorShareBps: number
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const poolPda = this.getPoolPda(depositMint);

    return await program.methods
      .updateFees(protocolFeeBps, operatorFeeBps, depositorShareBps)
      .accounts({
        admin: this.wallet.publicKey,
        pool: poolPda,
      })
      .rpc(this.confirmOptions);
  }

  /**
   * Update operator cooldown (admin only)
   *
   * @param depositMint - The deposit token mint
   * @param cooldownSeconds - Cooldown in seconds (0 = immediate after request)
   */
  public async updateOperatorCooldown(
    depositMint: PublicKey,
    cooldownSeconds: BN
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const poolPda = this.getPoolPda(depositMint);

    return await program.methods
      .updateOperatorCooldown(cooldownSeconds)
      .accounts({
        admin: this.wallet.publicKey,
        pool: poolPda,
      })
      .rpc(this.confirmOptions);
  }

  /**
   * Withdraw protocol fees (admin only)
   *
   * @param depositMint - The deposit token mint
   * @returns Transaction signature
   */
  public async withdrawProtocolFees(
    depositMint: PublicKey
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const pdas = this.getAllPoolPdas(depositMint);

    const adminTokenAta = await getAssociatedTokenAddress(
      depositMint,
      this.wallet.publicKey
    );

    return await program.methods
      .withdrawProtocolFees()
      .accounts({
        admin: this.wallet.publicKey,
        pool: pdas.pool.address,
        protocolFeeVault: pdas.protocolFeeVault.address,
        adminTokenAccount: adminTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc(this.confirmOptions);
  }

  /**
   * Transfer admin to new address (admin only)
   *
   * @param depositMint - The deposit token mint
   * @param newAdmin - New admin public key
   * @returns Transaction signature
   */
  public async transferAdmin(
    depositMint: PublicKey,
    newAdmin: PublicKey
  ): Promise<TransactionSignature> {
    if (!this.wallet) throw new Error("Wallet required");

    const program = this.getProgram();
    const poolPda = this.getPoolPda(depositMint);

    return await program.methods
      .transferAdmin()
      .accounts({
        admin: this.wallet.publicKey,
        newAdmin,
        pool: poolPda,
      })
      .rpc(this.confirmOptions);
  }
}
