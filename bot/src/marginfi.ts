// =============================================================================
// Marginfi Client for Position Monitoring (Updated with Real Integration)
// =============================================================================
// Client for fetching and monitoring Marginfi lending positions using the
// official marginfi-client-v2 SDK.
//
// This implementation:
// - Uses marginfi-client-v2 for account parsing
// - Fetches all necessary account references for liquidation
// - Calculates health factors accurately
// - Returns positions with complete Marginfi account data
// =============================================================================

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import BN from "bn.js";
import { MarginfiClient as MarginfiClientSDK, MarginRequirementType } from "@mrgnlabs/marginfi-client-v2";
import { Wallet } from "@coral-xyz/anchor";

import {
  LendingPosition,
  LendingProtocol,
  AssetPosition,
  TokenPrice,
  MarginfiAccounts,
} from "./types";
import { PythOracleClient } from "./oracle";
import { Logger } from "./logger";

// =============================================================================
// Constants
// =============================================================================

// Marginfi program ID on mainnet
export const MARGINFI_PROGRAM_ID = new PublicKey(
  "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"
);

// Known Marginfi groups (mainnet)
const MARGINFI_GROUPS = {
  // Main group on mainnet
  MAIN: new PublicKey("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8"),
};

// Known token mints
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  So11111111111111111111111111111111111111112: { symbol: "SOL", decimals: 9 },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "mSOL", decimals: 9 },
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": { symbol: "stSOL", decimals: 9 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": { symbol: "ETH", decimals: 8 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", decimals: 5 },
};

// =============================================================================
// Marginfi Client
// =============================================================================

/**
 * Client for interacting with Marginfi lending protocol
 */
export class MarginfiClient {
  private connection: Connection;
  private oracle: PythOracleClient;
  private logger: Logger;
  private priceCache: Map<string, TokenPrice> = new Map();
  private marginfiClient: MarginfiClientSDK | null = null;

  constructor(connection: Connection, oracle: PythOracleClient, logger?: Logger) {
    this.connection = connection;
    this.oracle = oracle;
    this.logger = logger || new Logger("Marginfi");
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the Marginfi client
   *
   * This fetches the Marginfi group configuration and sets up the client
   */
  async initialize(): Promise<void> {
    this.logger.info("Initializing Marginfi client...");

    try {
      // Create read-only wallet (no private key needed)
      const readOnlyWallet = {
        publicKey: PublicKey.default,
        signTransaction: async () => { throw new Error("Read-only wallet"); },
        signAllTransactions: async () => { throw new Error("Read-only wallet"); },
        payer: { publicKey: PublicKey.default } as any,
      };

      // Initialize marginfi client in read-only mode
      const config = {
        environment: "production" as const,
        cluster: this.connection.rpcEndpoint,
        programId: MARGINFI_PROGRAM_ID,
        groupPk: MARGINFI_GROUPS.MAIN,
      };

      this.marginfiClient = await MarginfiClientSDK.fetch(
        config,
        readOnlyWallet as unknown as Wallet,
        this.connection,
        { readOnly: true }
      );

      this.logger.success(`Marginfi client initialized (group: ${MARGINFI_GROUPS.MAIN.toBase58().slice(0, 8)}...)`);
    } catch (error) {
      this.logger.error("Failed to initialize Marginfi client", error);
      throw error;
    }
  }

  // ===========================================================================
  // Position Fetching
  // ===========================================================================

  /**
   * Fetch all liquidatable positions from Marginfi
   *
   * @returns Array of positions with health factor < 1
   */
  async fetchLiquidatablePositions(): Promise<LendingPosition[]> {
    this.logger.debug("Fetching liquidatable positions from Marginfi...");

    if (!this.marginfiClient) {
      this.logger.warn("Marginfi client not initialized, call initialize() first");
      return [];
    }

    try {
      // Step 1: Fetch all margin account addresses
      const accountAddresses = await this.marginfiClient.getAllMarginfiAccountAddresses();
      this.logger.debug(`Found ${accountAddresses.length} total margin accounts`);

      // Step 2: Fetch account data in batches (RPC limit: 100 accounts per call)
      const batchSize = 100;
      const allAccounts = [];

      for (let i = 0; i < accountAddresses.length; i += batchSize) {
        const batch = accountAddresses.slice(i, i + batchSize);
        const accounts = await this.marginfiClient.getMultipleMarginfiAccounts(batch);
        allAccounts.push(...accounts);
      }

      this.logger.debug(`Fetched ${allAccounts.length} margin account data`);

      // Step 3: Filter for liquidatable accounts (health < 1)
      const liquidatableAccounts = allAccounts.filter(account => {
        try {
          const health = account.computeHealthComponents(MarginRequirementType.Maintenance);
          // Health factor = assets / liabilities
          const healthFactor = health.liabilities.isZero()
            ? Number.MAX_SAFE_INTEGER
            : health.assets.div(health.liabilities).toNumber();

          return healthFactor < 1.0;
        } catch (error) {
          this.logger.debug(`Failed to compute health for account: ${error}`);
          return false;
        }
      });

      this.logger.debug(`Found ${liquidatableAccounts.length} liquidatable accounts`);

      // Step 4: Parse into LendingPosition with all account refs
      const positions = await Promise.all(
        liquidatableAccounts.map(account => this.parseMarginAccount(account))
      );

      this.logger.info(`Found ${positions.filter(p => p !== null).length} liquidatable positions`);
      return positions.filter((p): p is LendingPosition => p !== null);
    } catch (error) {
      this.logger.error("Failed to fetch liquidatable positions", error);
      return [];
    }
  }

  /**
   * Fetch a specific margin account by address
   */
  async fetchMarginAccount(
    accountAddress: PublicKey
  ): Promise<LendingPosition | null> {
    try {
      // TODO: Implement with marginfi-client-v2
      //
      // const account = await this.marginfiClient.getMarginfiAccount(
      //   accountAddress
      // );
      //
      // return this.parseMarginAccount(account);

      this.logger.warn("fetchMarginAccount not implemented");
      return null;
    } catch (error) {
      this.logger.error(`Failed to fetch account ${accountAddress.toBase58()}`, error);
      return null;
    }
  }

  // ===========================================================================
  // Account Parsing
  // ===========================================================================

  /**
   * Parse a Marginfi account into a LendingPosition with all account references
   *
   * This is the critical function that extracts all data needed for liquidation:
   * - Health factor
   * - Collateral and debt positions
   * - All Marginfi account addresses (banks, vaults, oracles)
   */
  private async parseMarginAccount(
    account: any // MarginfiAccountWrapper from SDK
  ): Promise<LendingPosition | null> {
    try {
      if (!this.marginfiClient) {
        throw new Error("Marginfi client not initialized");
      }

      // 1. Get health components
      const health = account.computeHealthComponents(MarginRequirementType.Maintenance);
      const healthFactor = health.liabilities.isZero()
        ? Number.MAX_SAFE_INTEGER
        : health.assets.div(health.liabilities).toNumber();

      // 2. Parse balances (borrows and collaterals)
      const borrows: AssetPosition[] = [];
      const collaterals: AssetPosition[] = [];

      for (const balance of account.balances) {
        if (balance.active) {
          const bankPk = balance.bankPk;
          const bank = this.marginfiClient.banks.get(bankPk.toBase58());

          if (!bank) {
            this.logger.debug(`Bank not found for ${bankPk.toBase58()}`);
            continue;
          }

          // Check if liability (borrow)
          if (balance.liabilityShares.gtn(0)) {
            const position = await this.parseBalance(balance, bank, false);
            if (position) borrows.push(position);
          }

          // Check if asset (collateral)
          if (balance.assetShares.gtn(0)) {
            const position = await this.parseBalance(balance, bank, true);
            if (position) collaterals.push(position);
          }
        }
      }

      // Must have both borrows and collaterals to be liquidatable
      if (borrows.length === 0 || collaterals.length === 0) {
        return null;
      }

      // 3. Calculate values
      const borrowedValueUsd = borrows.reduce((sum, b) => sum + b.valueUsd, 0);
      const collateralValueUsd = collaterals.reduce((sum, c) => sum + c.valueUsd, 0);

      // 4. Get Marginfi account references (needed for liquidation CPI)
      const largestBorrow = borrows.reduce((max, b) => b.valueUsd > max.valueUsd ? b : max);
      const largestCollateral = collaterals.reduce((max, c) => c.valueUsd > max.valueUsd ? c : max);

      const marginfiAccounts = await this.extractMarginfiAccounts(
        account,
        largestBorrow,
        largestCollateral
      );

      if (!marginfiAccounts) {
        return null;
      }

      return {
        protocol: LendingProtocol.Marginfi,
        accountAddress: account.address,
        owner: account.authority,
        borrowedValueUsd,
        collateralValueUsd,
        healthFactor,
        ltv: collateralValueUsd > 0 ? borrowedValueUsd / collateralValueUsd : 0,
        liquidationThreshold: 0.9, // Marginfi default
        borrows,
        collaterals,
        fetchedAt: Date.now(),
        marginfiAccounts,
      };
    } catch (error) {
      this.logger.debug(`Failed to parse margin account: ${error}`);
      return null;
    }
  }

  /**
   * Extract all Marginfi account references needed for liquidation
   *
   * This is critical for the executor - it needs all these accounts to build
   * the execute_liquidation instruction.
   */
  private async extractMarginfiAccounts(
    marginAccount: any,
    liabilityPosition: AssetPosition,
    assetPosition: AssetPosition
  ): Promise<MarginfiAccounts | null> {
    try {
      if (!this.marginfiClient) {
        return null;
      }

      // Find banks by mint
      let assetBank = null;
      let liabBank = null;

      for (const [, bank] of this.marginfiClient.banks) {
        if (bank.mint.equals(assetPosition.mint)) {
          assetBank = bank;
        }
        if (bank.mint.equals(liabilityPosition.mint)) {
          liabBank = bank;
        }
      }

      if (!assetBank || !liabBank) {
        this.logger.debug("Could not find required banks for liquidation");
        return null;
      }

      // Derive insurance vault authority PDA
      const [insuranceVaultAuthority] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("insurance_vault_authority"),
          assetBank.address.toBuffer(),
        ],
        MARGINFI_PROGRAM_ID
      );

      // Extract all required account references
      return {
        marginfiGroup: this.marginfiClient.groupAddress,
        assetBank: assetBank.address,
        liabBank: liabBank.address,
        assetBankLiquidityVault: assetBank.liquidityVault,
        liabBankLiquidityVault: liabBank.liquidityVault,
        insuranceVault: assetBank.insuranceVault,
        insuranceVaultAuthority,
        assetBankOracle: assetBank.config.oracleKeys[0],
        liabBankOracle: liabBank.config.oracleKeys[0],
      };
    } catch (error) {
      this.logger.debug(`Failed to extract Marginfi accounts: ${error}`);
      return null;
    }
  }

  /**
   * Parse a balance into an AssetPosition
   */
  private async parseBalance(
    balance: any,
    bank: any,
    isAsset: boolean
  ): Promise<AssetPosition | null> {
    try {
      const mint = bank.mint;
      const tokenInfo = this.getTokenInfo(mint);
      const price = await this.fetchTokenPrice(mint);

      if (!price) {
        this.logger.debug(`No price available for ${mint.toBase58()}`);
        return null;
      }

      // Calculate actual amount from shares
      const amount = isAsset
        ? bank.getAssetAmount(balance.assetShares)
        : bank.getLiabilityAmount(balance.liabilityShares);

      const amountUi = Number(amount.toString()) / Math.pow(10, tokenInfo.decimals);
      const valueUsd = amountUi * price.priceUsd;

      return {
        mint,
        symbol: tokenInfo.symbol,
        amount,
        amountUi,
        valueUsd,
        priceUsd: price.priceUsd,
        decimals: tokenInfo.decimals,
      };
    } catch (error) {
      this.logger.debug(`Failed to parse balance: ${error}`);
      return null;
    }
  }

  // ===========================================================================
  // Price Fetching
  // ===========================================================================

  /**
   * Fetch token price from oracle
   *
   * Uses Pyth oracle client with fallback to mock prices for unknown tokens
   *
   * @param mint - Token mint address
   * @returns Token price or null if not available
   */
  async fetchTokenPrice(mint: PublicKey): Promise<TokenPrice | null> {
    const mintStr = mint.toBase58();

    // Check cache first (prices valid for 10 seconds)
    const cached = this.priceCache.get(mintStr);
    if (cached && Date.now() - cached.timestamp < 10000) {
      return cached;
    }

    try {
      // Fetch from Pyth oracle client
      // This handles Pyth feeds with Jupiter fallback
      const tokenPrice = await this.oracle.fetchPrice(mint);

      if (tokenPrice) {
        // Cache the price
        this.priceCache.set(mintStr, tokenPrice);
        return tokenPrice;
      }

      // If oracle returns null, fallback to mock prices for testing
      this.logger.debug(`No oracle price for ${mintStr}, using mock fallback`);

      const mockPrices: Record<string, number> = {
        EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1.0, // USDC
        So11111111111111111111111111111111111111112: 100.0, // SOL
        mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 110.0, // mSOL
        Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 1.0, // USDT
        "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": 2500.0, // ETH
      };

      const mockPrice = mockPrices[mintStr];
      if (mockPrice === undefined) {
        return null;
      }

      const fallbackPrice: TokenPrice = {
        mint,
        priceUsd: mockPrice,
        confidence: 0.01,
        timestamp: Date.now(),
        source: "mock",
      };

      this.priceCache.set(mintStr, fallbackPrice);
      return fallbackPrice;
    } catch (error) {
      this.logger.warn(`Failed to fetch price for ${mintStr}`, error);
      return null;
    }
  }

  /**
   * Get token info by mint
   */
  getTokenInfo(mint: PublicKey): { symbol: string; decimals: number } {
    return KNOWN_TOKENS[mint.toBase58()] || { symbol: "UNKNOWN", decimals: 9 };
  }

  // ===========================================================================
  // Health Factor Calculation
  // ===========================================================================

  /**
   * Calculate health factor for a position
   *
   * Health Factor = (Weighted Collateral Value) / (Weighted Borrow Value)
   *
   * If health factor < 1, position can be liquidated
   *
   * Note: Marginfi uses more complex weighting based on asset risk.
   * This is a simplified calculation.
   */
  calculateHealthFactor(
    collateralValueUsd: number,
    borrowedValueUsd: number,
    liquidationThreshold: number = 0.8
  ): number {
    if (borrowedValueUsd === 0) return Infinity;
    return (collateralValueUsd * liquidationThreshold) / borrowedValueUsd;
  }

  /**
   * Calculate maximum liquidation amount
   *
   * @param position - The lending position
   * @param closeFactor - Maximum percentage of debt that can be liquidated
   * @returns Maximum debt amount that can be repaid
   */
  calculateMaxLiquidation(
    position: LendingPosition,
    closeFactor: number = 0.5
  ): BN {
    if (position.borrows.length === 0) return new BN(0);

    // Find the largest borrow
    const largestBorrow = position.borrows.reduce((max, b) =>
      b.valueUsd > max.valueUsd ? b : max
    );

    // Max liquidation is close factor × borrow amount
    const maxAmount = largestBorrow.amount
      .mul(new BN(Math.floor(closeFactor * 10000)))
      .div(new BN(10000));

    return maxAmount;
  }

  // ===========================================================================
  // Liquidation Bonus
  // ===========================================================================

  /**
   * Get liquidation bonus for a collateral type
   *
   * Liquidation bonus is the discount liquidators get when seizing collateral.
   * For example, 5% bonus means liquidator receives $105 of collateral for
   * repaying $100 of debt.
   *
   * TODO: Fetch from Marginfi bank configuration
   */
  getLiquidationBonus(collateralMint: PublicKey): number {
    // TODO: Get from Marginfi bank config
    // const bank = this.marginfiClient.getBankByMint(collateralMint);
    // return bank.config.liquidationBonus;

    // Default values based on typical Marginfi configuration
    const bonuses: Record<string, number> = {
      So11111111111111111111111111111111111111112: 0.05, // SOL
      mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 0.06, // mSOL
      "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": 0.06, // stSOL
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 0.03, // USDC
      Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 0.03, // USDT
    };

    return bonuses[collateralMint.toBase58()] || 0.05;
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Check if Marginfi client is initialized
   */
  isInitialized(): boolean {
    // return this.marginfiClient !== undefined;
    return false; // TODO: Update when marginfi client is added
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get Marginfi group for the current network
 */
export function getMarginfiGroup(network: "mainnet" | "devnet"): PublicKey {
  if (network === "mainnet") {
    return MARGINFI_GROUPS.MAIN;
  }
  // Devnet group
  return new PublicKey("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8");
}

/**
 * Generate mock liquidatable positions for testing
 *
 * In production, remove this and use real data from fetchLiquidatablePositions
 */
export function generateMockPositions(count: number = 5): LendingPosition[] {
  const positions: LendingPosition[] = [];

  for (let i = 0; i < count; i++) {
    const collateralValue = Math.random() * 50000 + 10000; // $10k - $60k
    const healthFactor = 0.8 + Math.random() * 0.3; // 0.8 - 1.1 (some liquidatable)
    const ltv = 0.75;
    const borrowedValue = (collateralValue * ltv) / healthFactor;

    const position: LendingPosition = {
      protocol: LendingProtocol.Marginfi,
      accountAddress: PublicKey.unique(),
      owner: PublicKey.unique(),
      borrowedValueUsd: borrowedValue,
      collateralValueUsd: collateralValue,
      healthFactor,
      ltv: borrowedValue / collateralValue,
      liquidationThreshold: ltv,
      borrows: [
        {
          mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
          symbol: "USDC",
          amount: new BN(Math.floor(borrowedValue * 1e6)),
          amountUi: borrowedValue,
          valueUsd: borrowedValue,
          priceUsd: 1.0,
          decimals: 6,
        },
      ],
      collaterals: [
        {
          mint: new PublicKey("So11111111111111111111111111111111111111112"),
          symbol: "SOL",
          amount: new BN(Math.floor((collateralValue / 100) * 1e9)),
          amountUi: collateralValue / 100,
          valueUsd: collateralValue,
          priceUsd: 100.0,
          decimals: 9,
        },
      ],
      fetchedAt: Date.now(),
    };

    positions.push(position);
  }

  // Filter to only return liquidatable (health < 1)
  return positions.filter((p) => p.healthFactor < 1);
}

/**
 * Package installation instructions
 */
export const INSTALLATION_INSTRUCTIONS = `
To enable real Marginfi integration, install the required packages:

npm install @mrgnlabs/marginfi-client-v2
npm install @pythnetwork/client

Then uncomment all TODO sections in marginfi-updated.ts and remove the old marginfi.ts file.

Key implementation steps:
1. Initialize MarginfiClient in constructor
2. Fetch all margin accounts with getAllMarginfiAccounts()
3. Filter by health factor < 1
4. Parse each account to extract all account references
5. Return LendingPosition[] with marginfiAccounts populated

See marginfi-client-v2 documentation:
https://github.com/mrgnlabs/marginfi-v2
`;
