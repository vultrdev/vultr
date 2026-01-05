// =============================================================================
// Marginfi Client for Position Monitoring
// =============================================================================
// Client for fetching and monitoring marginfi lending positions.
//
// NOTE: This is a simplified implementation. In production, you would use
// the official marginfi-client-v2 package for full functionality.
// =============================================================================

import {
  Connection,
  PublicKey,
  GetProgramAccountsFilter,
} from "@solana/web3.js";
import BN from "bn.js";

import {
  LendingPosition,
  LendingProtocol,
  AssetPosition,
  TokenPrice,
} from "./types";
import { Logger } from "./logger";

// =============================================================================
// Constants
// =============================================================================

// Marginfi program ID on mainnet
export const MARGINFI_PROGRAM_ID = new PublicKey(
  "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"
);

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

  constructor(connection: Connection, logger?: Logger) {
    this.connection = connection;
    this.logger = logger || new Logger("Marginfi");
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
      // In production, you would:
      // 1. Use marginfi-client-v2 to fetch all margin accounts
      // 2. Calculate health factor for each
      // 3. Filter for health factor < 1

      // For now, we'll fetch program accounts and parse them
      const accounts = await this.fetchMarginAccounts();
      const positions: LendingPosition[] = [];

      for (const account of accounts) {
        const position = await this.parseMarginAccount(account);
        if (position && position.healthFactor < 1) {
          positions.push(position);
        }
      }

      this.logger.info(`Found ${positions.length} liquidatable positions`);
      return positions;
    } catch (error) {
      this.logger.error("Failed to fetch liquidatable positions", error);
      return [];
    }
  }

  /**
   * Fetch all margin accounts from the program
   */
  private async fetchMarginAccounts(): Promise<
    { pubkey: PublicKey; data: Buffer }[]
  > {
    // Filter for margin account type
    // Account discriminator for MarginAccount
    const MARGIN_ACCOUNT_DISCRIMINATOR = Buffer.from([
      67, 178, 130, 109, 126, 114, 28, 42,
    ]);

    const filters: GetProgramAccountsFilter[] = [
      {
        memcmp: {
          offset: 0,
          bytes: MARGIN_ACCOUNT_DISCRIMINATOR.toString("base64"),
        },
      },
    ];

    try {
      const accounts = await this.connection.getProgramAccounts(
        MARGINFI_PROGRAM_ID,
        {
          filters,
          commitment: "confirmed",
        }
      );

      return accounts.map((a) => ({
        pubkey: a.pubkey,
        data: a.account.data as Buffer,
      }));
    } catch (error) {
      this.logger.warn("Failed to fetch margin accounts, returning empty", error);
      return [];
    }
  }

  /**
   * Parse a margin account into a LendingPosition
   *
   * NOTE: This is a simplified parser. The actual marginfi account structure
   * is more complex and requires the marginfi-client-v2 for proper parsing.
   */
  private async parseMarginAccount(account: {
    pubkey: PublicKey;
    data: Buffer;
  }): Promise<LendingPosition | null> {
    try {
      // In production, use marginfi-client-v2's MarginAccount.decode()
      // For now, we'll create a mock structure

      // Skip accounts that are too small to be valid
      if (account.data.length < 200) {
        return null;
      }

      // Mock parsing - in production this would be real deserialization
      // The actual marginfi account structure includes:
      // - authority (owner)
      // - group (marginfi group)
      // - lending_account (array of balances)

      // For demonstration, we'll return null (no positions)
      // Real implementation would parse the account data
      return null;
    } catch {
      return null;
    }
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
      // In production, you would:
      // 1. Fetch from Pyth or Switchboard oracle
      // 2. Use Jupiter price API as fallback

      // Mock prices for common tokens
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
        source: "mock",
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
  getTokenInfo(mint: PublicKey): { symbol: string; decimals: number } | null {
    return KNOWN_TOKENS[mint.toBase58()] || null;
  }

  // ===========================================================================
  // Health Factor Calculation
  // ===========================================================================

  /**
   * Calculate health factor for a position
   *
   * Health Factor = (Collateral Value × Liquidation Threshold) / Borrowed Value
   *
   * If health factor < 1, position can be liquidated
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
   * @param closeFactor - Maximum percentage of debt that can be liquidated (usually 50%)
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
   */
  getLiquidationBonus(collateralMint: PublicKey): number {
    // Default liquidation bonus - in production, fetch from on-chain config
    const bonuses: Record<string, number> = {
      // SOL-based collateral typically has 5-10% bonus
      So11111111111111111111111111111111111111112: 0.05, // SOL
      mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 0.06, // mSOL
      "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": 0.06, // stSOL
      // Stablecoins typically have lower bonus
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 0.03, // USDC
      Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 0.03, // USDT
    };

    return bonuses[collateralMint.toBase58()] || 0.05;
  }
}

// =============================================================================
// Mock Position Generator (for testing)
// =============================================================================

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
