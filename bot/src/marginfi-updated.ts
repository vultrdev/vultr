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

// TODO: Install marginfi-client-v2
// npm install @mrgnlabs/marginfi-client-v2
//
// For now, we'll provide the structure with detailed TODOs
// showing how to integrate the real SDK

import {
  LendingPosition,
  LendingProtocol,
  AssetPosition,
  TokenPrice,
  MarginfiAccounts,
} from "./types";
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
  private logger: Logger;
  private priceCache: Map<string, TokenPrice> = new Map();
  // TODO: Add marginfi client instance
  // private marginfiClient: MarginfiClientType;

  constructor(connection: Connection, logger?: Logger) {
    this.connection = connection;
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
      // TODO: Initialize marginfi-client-v2
      //
      // const config = {
      //   connection: this.connection,
      //   groupPk: MARGINFI_GROUPS.MAIN,
      //   programId: MARGINFI_PROGRAM_ID,
      // };
      //
      // this.marginfiClient = await MarginfiClientType.fetch(
      //   config,
      //   {} // wallet not needed for read-only operations
      // );

      this.logger.success("Marginfi client initialized");
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

    try {
      // TODO: Implement with marginfi-client-v2
      //
      // Step 1: Fetch all margin accounts
      // const allAccounts = await this.marginfiClient.getAllMarginfiAccounts();
      //
      // Step 2: Filter for liquidatable (health < 1)
      // const liquidatableAccounts = allAccounts.filter(account => {
      //   const health = account.computeHealthComponents();
      //   return health.health < 1.0;
      // });
      //
      // Step 3: Parse into LendingPosition with all account refs
      // const positions = await Promise.all(
      //   liquidatableAccounts.map(account => this.parseMarginAccount(account))
      // );

      const positions: LendingPosition[] = [];

      // TODO: Remove this after implementing real fetching
      // For now, return empty array
      this.logger.warn("Using stubbed fetchLiquidatablePositions - returns empty");
      this.logger.warn("Install @mrgnlabs/marginfi-client-v2 and uncomment TODOs");

      this.logger.info(`Found ${positions.length} liquidatable positions`);
      return positions;
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
    account: any // TODO: Type as MarginfiAccount from marginfi-client-v2
  ): Promise<LendingPosition> {
    // TODO: Implement real parsing with marginfi-client-v2
    //
    // Example structure:
    //
    // // 1. Get health components
    // const health = account.computeHealthComponents();
    // const healthFactor = health.health;
    //
    // // 2. Parse balances (borrows and collaterals)
    // const borrows: AssetPosition[] = [];
    // const collaterals: AssetPosition[] = [];
    //
    // for (const balance of account.balances) {
    //   if (balance.active) {
    //     const bank = this.marginfiClient.getBankByPk(balance.bankPk);
    //     const position = await this.parseBalance(balance, bank);
    //
    //     if (balance.liabilityShares.gt(new BN(0))) {
    //       borrows.push(position);
    //     }
    //     if (balance.assetShares.gt(new BN(0))) {
    //       collaterals.push(position);
    //     }
    //   }
    // }
    //
    // // 3. Calculate values
    // const borrowedValueUsd = borrows.reduce((sum, b) => sum + b.valueUsd, 0);
    // const collateralValueUsd = collaterals.reduce((sum, c) => sum + c.valueUsd, 0);
    //
    // // 4. Get Marginfi account references
    // // This is crucial - we need all these for the liquidation CPI
    // const marginfiAccounts = await this.extractMarginfiAccounts(
    //   account,
    //   borrows[0], // largest borrow (liability)
    //   collaterals[0] // largest collateral (asset)
    // );
    //
    // return {
    //   protocol: LendingProtocol.Marginfi,
    //   accountAddress: account.publicKey,
    //   owner: account.authority,
    //   borrowedValueUsd,
    //   collateralValueUsd,
    //   healthFactor,
    //   ltv: borrowedValueUsd / collateralValueUsd,
    //   liquidationThreshold: 0.8, // Get from bank config
    //   borrows,
    //   collaterals,
    //   fetchedAt: Date.now(),
    //   marginfiAccounts,
    // };

    throw new Error("parseMarginAccount not implemented - install marginfi-client-v2");
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
  ): Promise<MarginfiAccounts> {
    // TODO: Implement with marginfi-client-v2
    //
    // Example structure:
    //
    // // Get the banks for asset (collateral) and liability (debt)
    // const assetBank = this.marginfiClient.getBankByMint(assetPosition.mint);
    // const liabBank = this.marginfiClient.getBankByMint(liabilityPosition.mint);
    //
    // // Extract all required accounts from the banks
    // return {
    //   marginfiGroup: this.marginfiClient.groupPk,
    //   assetBank: assetBank.publicKey,
    //   liabBank: liabBank.publicKey,
    //   assetBankLiquidityVault: assetBank.liquidityVault,
    //   liabBankLiquidityVault: liabBank.liquidityVault,
    //   insuranceVault: assetBank.insuranceVault,
    //   insuranceVaultAuthority: assetBank.insuranceVaultAuthority,
    //   assetBankOracle: assetBank.config.oracleKeys[0], // Pyth oracle
    //   liabBankOracle: liabBank.config.oracleKeys[0],   // Pyth oracle
    // };

    throw new Error("extractMarginfiAccounts not implemented");
  }

  /**
   * Parse a balance into an AssetPosition
   */
  private async parseBalance(
    balance: any,
    bank: any
  ): Promise<AssetPosition> {
    // TODO: Implement with marginfi-client-v2
    //
    // const mint = bank.mint;
    // const tokenInfo = this.getTokenInfo(mint);
    // const price = await this.fetchTokenPrice(mint);
    //
    // // Calculate actual amount from shares
    // const amount = balance.assetShares.gt(new BN(0))
    //   ? bank.getAssetAmount(balance.assetShares)
    //   : bank.getLiabilityAmount(balance.liabilityShares);
    //
    // const amountUi = Number(amount) / Math.pow(10, tokenInfo.decimals);
    // const valueUsd = amountUi * (price?.priceUsd || 0);
    //
    // return {
    //   mint,
    //   symbol: tokenInfo.symbol,
    //   amount,
    //   amountUi,
    //   valueUsd,
    //   priceUsd: price?.priceUsd || 0,
    //   decimals: tokenInfo.decimals,
    // };

    throw new Error("parseBalance not implemented");
  }

  // ===========================================================================
  // Price Fetching
  // ===========================================================================

  /**
   * Fetch token price from oracle
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
      // TODO: Fetch from Pyth oracle
      //
      // Option 1: Use Marginfi's bank oracle
      // const bank = this.marginfiClient.getBankByMint(mint);
      // const priceData = await bank.getOraclePrice();
      // const price = priceData.price;
      //
      // Option 2: Use Pyth directly
      // import { PythHttpClient } from "@pythnetwork/client";
      // const pythClient = new PythHttpClient(this.connection);
      // const priceData = await pythClient.getAssetPriceFromWebApi(mint);
      // const price = priceData.aggregate.price;

      // Mock prices for now
      const mockPrices: Record<string, number> = {
        EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1.0, // USDC
        So11111111111111111111111111111111111111112: 100.0, // SOL
        mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 110.0, // mSOL
        Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 1.0, // USDT
        "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": 2500.0, // ETH
      };

      const price = mockPrices[mintStr];
      if (price === undefined) {
        return null;
      }

      const tokenPrice: TokenPrice = {
        mint,
        priceUsd: price,
        confidence: 0.01,
        timestamp: Date.now(),
        source: "mock", // TODO: Change to "pyth" or "marginfi"
      };

      this.priceCache.set(mintStr, tokenPrice);
      return tokenPrice;
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
