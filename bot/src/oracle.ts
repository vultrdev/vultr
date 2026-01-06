// =============================================================================
// Pyth Price Oracle Client
// =============================================================================
// Client for fetching real-time token prices from Pyth Network oracles.
//
// Pyth provides high-frequency price updates for crypto assets with:
// - Sub-second update frequency
// - Confidence intervals for price accuracy
// - Multiple data sources for reliability
//
// This client:
// - Fetches prices from Pyth on-chain accounts
// - Caches prices with configurable TTL
// - Provides fallback to Jupiter Price API
// - Handles errors gracefully
// =============================================================================

import { Connection, PublicKey } from "@solana/web3.js";
import { TokenPrice } from "./types";
import { Logger } from "./logger";

// TODO: Install Pyth SDK
// npm install @pythnetwork/client
// npm install @pythnetwork/pyth-solana-receiver
//
// For now, we provide the structure with detailed implementation guide

// =============================================================================
// Constants
// =============================================================================

/**
 * Pyth program ID on mainnet
 */
export const PYTH_PROGRAM_ID = new PublicKey(
  "FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH"
);

/**
 * Known Pyth price feed accounts (mainnet)
 */
export const PYTH_PRICE_FEEDS = {
  // Stablecoins
  USDC: new PublicKey("Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD"),
  USDT: new PublicKey("3vxLXJqLqF3JG5TCbYycbKWRBbCJQLxQmBGCkyqEEefL"),

  // Major tokens
  SOL: new PublicKey("H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG"),
  BTC: new PublicKey("GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU"),
  ETH: new PublicKey("JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB"),

  // LSTs
  mSOL: new PublicKey("E4v1BBgoso9s64TQvmyownAVJbhbEPGyzA3qn4n46qj9"),
  stSOL: new PublicKey("2LwhbcswZekofMNRjC5JhJRxQLLxUZW7vdUw76e9s4VY"),
  jitoSOL: new PublicKey("7yyaeuJ1GGtVBLT2z2xub5ZWYKaNhF28mj1RdV4VDFVk"),

  // DeFi tokens
  JUP: new PublicKey("g6eRCbboSwK4tSWngn773RCMexr1APQr4uA9bGZBYfo"),
  JTO: new PublicKey("D8UUgr8a3aR3yUeHLu7v8FWK7E8Y5sSU7qrYBXUJXBQ5"),
  BONK: new PublicKey("8ihFLu5FimgTQ1Unh4dVyEHUGodJ5gJQCrQf4KUVB9bN"),
  WIF: new PublicKey("6x6KfE7nY8HRNVhZJhFHaJJVD9LEvcgSgNbPMHdA6vKR"),
};

/**
 * Default price cache TTL (5 seconds)
 */
const DEFAULT_CACHE_TTL_MS = 5000;

/**
 * Maximum confidence interval we'll accept (10%)
 */
const MAX_CONFIDENCE_INTERVAL = 0.1;

// =============================================================================
// Pyth Oracle Client
// =============================================================================

/**
 * Client for fetching token prices from Pyth Network
 */
export class PythOracleClient {
  private connection: Connection;
  private logger: Logger;
  private priceCache: Map<string, CachedPrice> = new Map();
  private cacheTtlMs: number;

  // TODO: Add Pyth client instance
  // private pythConnection: PythConnection;

  constructor(
    connection: Connection,
    cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
    logger?: Logger
  ) {
    this.connection = connection;
    this.cacheTtlMs = cacheTtlMs;
    this.logger = logger || new Logger("PythOracle");
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the Pyth client
   */
  async initialize(): Promise<void> {
    this.logger.info("Initializing Pyth oracle client...");

    try {
      // TODO: Initialize Pyth connection
      //
      // import { PythConnection } from "@pythnetwork/client";
      //
      // this.pythConnection = new PythConnection(
      //   this.connection,
      //   PYTH_PROGRAM_ID
      // );
      //
      // await this.pythConnection.start();

      this.logger.success("Pyth oracle client initialized");
    } catch (error) {
      this.logger.error("Failed to initialize Pyth client", error);
      throw error;
    }
  }

  // ===========================================================================
  // Price Fetching
  // ===========================================================================

  /**
   * Fetch token price from Pyth oracle
   *
   * @param mint - Token mint address
   * @returns Token price with confidence interval
   */
  async fetchPrice(mint: PublicKey): Promise<TokenPrice | null> {
    const mintStr = mint.toBase58();

    // Check cache first
    const cached = this.getCachedPrice(mintStr);
    if (cached) {
      this.logger.debug(`Using cached price for ${mintStr}: $${cached.priceUsd}`);
      return cached;
    }

    try {
      // Get Pyth price feed for this mint
      const priceFeedKey = this.getPriceFeedKey(mint);
      if (!priceFeedKey) {
        this.logger.warn(`No Pyth price feed for ${mintStr}`);
        return this.fetchFallbackPrice(mint);
      }

      // Fetch price from Pyth
      const price = await this.fetchPythPrice(priceFeedKey);

      if (!price) {
        this.logger.warn(`Failed to fetch Pyth price for ${mintStr}`);
        return this.fetchFallbackPrice(mint);
      }

      // Validate confidence interval
      if (price.confidence > MAX_CONFIDENCE_INTERVAL) {
        this.logger.warn(
          `High confidence interval for ${mintStr}: ${(price.confidence * 100).toFixed(2)}%`
        );
        // Still use the price, but log warning
      }

      // Cache the price
      this.cachePrice(mintStr, price);

      return price;
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${mintStr}`, error);
      return this.fetchFallbackPrice(mint);
    }
  }

  /**
   * Fetch multiple prices in parallel
   *
   * @param mints - Array of token mints
   * @returns Map of mint -> price
   */
  async fetchPrices(
    mints: PublicKey[]
  ): Promise<Map<string, TokenPrice>> {
    const results = new Map<string, TokenPrice>();

    // Fetch all prices in parallel
    const prices = await Promise.all(
      mints.map(mint => this.fetchPrice(mint))
    );

    // Build result map
    for (let i = 0; i < mints.length; i++) {
      if (prices[i]) {
        results.set(mints[i].toBase58(), prices[i]!);
      }
    }

    return results;
  }

  /**
   * Fetch price from Pyth on-chain account
   */
  private async fetchPythPrice(
    priceFeedKey: PublicKey
  ): Promise<TokenPrice | null> {
    try {
      // TODO: Implement with Pyth SDK
      //
      // Method 1: Using PythConnection (recommended)
      // const priceData = await this.pythConnection.getLatestPriceFeeds([
      //   priceFeedKey.toBase58()
      // ]);
      //
      // if (!priceData || priceData.length === 0) {
      //   return null;
      // }
      //
      // const feed = priceData[0];
      // const price = feed.getPriceUnchecked(); // or getPriceNoOlderThan(60)
      //
      // return {
      //   mint: this.getMintForPriceFeed(priceFeedKey),
      //   priceUsd: price.price,
      //   confidence: price.confidence / price.price, // Relative confidence
      //   timestamp: Date.now(),
      //   source: "pyth",
      // };
      //
      // Method 2: Using raw account data
      // const accountInfo = await this.connection.getAccountInfo(priceFeedKey);
      // if (!accountInfo) return null;
      //
      // const priceData = parsePriceData(accountInfo.data);
      // return {
      //   mint: this.getMintForPriceFeed(priceFeedKey),
      //   priceUsd: priceData.price,
      //   confidence: priceData.confidence / priceData.price,
      //   timestamp: Date.now(),
      //   source: "pyth",
      // };

      // For now, return null (will use fallback)
      return null;
    } catch (error) {
      this.logger.debug(`Pyth price fetch failed: ${error}`);
      return null;
    }
  }

  /**
   * Fetch price from Jupiter Price API as fallback
   */
  private async fetchFallbackPrice(
    mint: PublicKey
  ): Promise<TokenPrice | null> {
    try {
      this.logger.debug(`Fetching fallback price from Jupiter for ${mint.toBase58()}`);

      // Jupiter Price API v2
      const response = await fetch(
        `https://price.jup.ag/v2/price?ids=${mint.toBase58()}`
      );

      if (!response.ok) {
        throw new Error(`Jupiter API returned ${response.status}`);
      }

      const data = await response.json();
      const priceData = data.data?.[mint.toBase58()];

      if (!priceData || !priceData.price) {
        return null;
      }

      const price: TokenPrice = {
        mint,
        priceUsd: priceData.price,
        confidence: 0.01, // Jupiter doesn't provide confidence
        timestamp: Date.now(),
        source: "jupiter",
      };

      // Cache fallback price too
      this.cachePrice(mint.toBase58(), price);

      return price;
    } catch (error) {
      this.logger.error(`Jupiter fallback failed for ${mint.toBase58()}`, error);
      return null;
    }
  }

  // ===========================================================================
  // Price Feed Mapping
  // ===========================================================================

  /**
   * Get Pyth price feed key for a token mint
   */
  private getPriceFeedKey(mint: PublicKey): PublicKey | null {
    const mintStr = mint.toBase58();

    // Check known price feeds
    for (const [symbol, feedKey] of Object.entries(PYTH_PRICE_FEEDS)) {
      // Match by mint (would need a mint->feed mapping)
      // For now, return null and use fallback
    }

    // TODO: Build a comprehensive mint -> price feed mapping
    // This requires knowing which Pyth feed corresponds to each token
    // Can be fetched from Pyth's API or built statically

    return null;
  }

  /**
   * Get mint for a price feed key (reverse mapping)
   */
  private getMintForPriceFeed(priceFeedKey: PublicKey): PublicKey {
    // TODO: Implement reverse mapping
    // For now, return the price feed key itself (placeholder)
    return priceFeedKey;
  }

  // ===========================================================================
  // Price Caching
  // ===========================================================================

  /**
   * Get cached price if still valid
   */
  private getCachedPrice(mintStr: string): TokenPrice | null {
    const cached = this.priceCache.get(mintStr);
    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (age > this.cacheTtlMs) {
      this.priceCache.delete(mintStr);
      return null;
    }

    return cached.price;
  }

  /**
   * Cache a price
   */
  private cachePrice(mintStr: string, price: TokenPrice): void {
    this.priceCache.set(mintStr, {
      price,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
    this.logger.debug("Price cache cleared");
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.priceCache.size,
      hits: 0, // TODO: Track hits
      misses: 0, // TODO: Track misses
    };
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Check if oracle client is initialized
   */
  isInitialized(): boolean {
    // return this.pythConnection !== undefined;
    return false; // TODO: Update when Pyth client is added
  }

  /**
   * Close the Pyth connection
   */
  async close(): Promise<void> {
    // await this.pythConnection?.stop();
    this.clearCache();
    this.logger.info("Pyth oracle client closed");
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Cached price with timestamp
 */
interface CachedPrice {
  price: TokenPrice;
  timestamp: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build a comprehensive mint -> price feed mapping
 *
 * This should be called once at startup to map all known tokens
 * to their Pyth price feeds
 */
export function buildPriceFeedMapping(): Map<string, PublicKey> {
  const mapping = new Map<string, PublicKey>();

  // TODO: Build mapping from Pyth's API or static config
  // Example:
  // const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  // mapping.set(USDC, PYTH_PRICE_FEEDS.USDC);

  return mapping;
}

/**
 * Installation instructions
 */
export const INSTALLATION_INSTRUCTIONS = `
To enable real Pyth oracle integration, install the required packages:

npm install @pythnetwork/client
npm install @pythnetwork/pyth-solana-receiver

Then uncomment all TODO sections in oracle.ts.

Key implementation steps:
1. Initialize PythConnection in initialize()
2. Fetch prices with getLatestPriceFeeds()
3. Build mint -> price feed mapping
4. Add confidence interval validation
5. Implement proper error handling

Alternative approach (simpler):
Use Jupiter Price API only (already implemented as fallback)
- No on-chain oracle reads
- REST API calls only
- Good for initial testing

See Pyth documentation:
https://docs.pyth.network/price-feeds/use-real-time-data/solana
`;
