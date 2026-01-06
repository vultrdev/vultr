// =============================================================================
// Retry and Error Handling Utilities
// =============================================================================
// Provides robust retry logic with exponential backoff for handling:
// - RPC rate limits
// - Network failures
// - Transaction timeouts
// - Temporary service outages
// =============================================================================

import { Logger } from "./logger";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  backoffMultiplier: 2,
  jitterMs: 500,
};

/**
 * Errors that should not be retried
 */
const NON_RETRYABLE_ERRORS = [
  "InvalidProgramId",
  "InvalidAccountData",
  "AccountNotFound",
  "InsufficientFunds",
  "Unauthorized",
  "NotLiquidatable",
  "InvalidSlippage",
];

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial backoff delay in milliseconds */
  initialBackoffMs: number;
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs: number;
  /** Backoff multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Random jitter to add to backoff (0 to jitterMs) */
  jitterMs: number;
}

/**
 * Result of a retry attempt
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Result value if successful */
  value?: T;
  /** Error if failed */
  error?: Error;
  /** Number of attempts made */
  attempts: number;
  /** Total time spent in milliseconds */
  totalTimeMs: number;
}

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * Execute a function with retry logic and exponential backoff
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @param logger - Optional logger for tracking retries
 * @returns The result of the function
 * @throws The last error if all retries fail
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  logger?: Logger
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      // Execute the function
      const result = await fn();

      // Log success if there were retries
      if (attempt > 0 && logger) {
        logger.info(`Operation succeeded after ${attempt} retries`);
      }

      return result;
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      if (!isRetryableError(error as Error)) {
        logger?.warn(`Non-retryable error encountered: ${lastError.message}`);
        throw lastError;
      }

      // If this was the last attempt, throw the error
      if (attempt >= cfg.maxRetries) {
        logger?.error(
          `Operation failed after ${attempt + 1} attempts (${Date.now() - startTime}ms)`,
          lastError
        );
        throw lastError;
      }

      // Calculate backoff delay
      const backoffMs = calculateBackoff(attempt, cfg);

      // Log retry attempt
      logger?.warn(
        `Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${backoffMs}ms...`
      );

      // Wait before retrying
      await sleep(backoffMs);
    }
  }

  // This should never be reached, but TypeScript requires it
  throw lastError || new Error("Unknown error in retry logic");
}

/**
 * Execute a function with retry logic and return a result object instead of throwing
 *
 * Useful when you want to handle failures gracefully without exceptions
 */
export async function tryWithRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  logger?: Logger
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let attempts = 0;

  try {
    const value = await executeWithRetry(fn, config, logger);
    attempts = 1; // TODO: Track actual attempts in executeWithRetry

    return {
      success: true,
      value,
      attempts,
      totalTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error as Error,
      attempts: (config.maxRetries || DEFAULT_RETRY_CONFIG.maxRetries) + 1,
      totalTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Rate Limiting
// =============================================================================

/**
 * Rate limiter to prevent exceeding RPC limits
 */
export class RateLimiter {
  private lastCallTime: number = 0;
  private minIntervalMs: number;
  private logger?: Logger;

  constructor(minIntervalMs: number, logger?: Logger) {
    this.minIntervalMs = minIntervalMs;
    this.logger = logger;
  }

  /**
   * Execute a function with rate limiting
   *
   * Waits if necessary to ensure minimum interval between calls
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;

    if (timeSinceLastCall < this.minIntervalMs) {
      const waitTime = this.minIntervalMs - timeSinceLastCall;
      this.logger?.debug(`Rate limiting: waiting ${waitTime}ms before next call`);
      await sleep(waitTime);
    }

    this.lastCallTime = Date.now();
    return await fn();
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.lastCallTime = 0;
  }
}

/**
 * Rate limiter with retry logic combined
 *
 * Useful for RPC calls that need both rate limiting and retry handling
 */
export class RateLimitedRetry<T> {
  private rateLimiter: RateLimiter;
  private retryConfig: RetryConfig;
  private logger?: Logger;

  constructor(
    rateLimitMs: number,
    retryConfig: Partial<RetryConfig> = {},
    logger?: Logger
  ) {
    this.rateLimiter = new RateLimiter(rateLimitMs, logger);
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    this.logger = logger;
  }

  /**
   * Execute a function with both rate limiting and retry logic
   */
  async execute(fn: () => Promise<T>): Promise<T> {
    return await executeWithRetry(
      async () => await this.rateLimiter.execute(fn),
      this.retryConfig,
      this.logger
    );
  }
}

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Check if an error should be retried
 *
 * Some errors are permanent (e.g., invalid account) and should not be retried
 */
export function isRetryableError(error: Error): boolean {
  const errorMessage = error.message;

  // Check for non-retryable error patterns
  for (const pattern of NON_RETRYABLE_ERRORS) {
    if (errorMessage.includes(pattern)) {
      return false;
    }
  }

  // Check for common retryable patterns
  const retryablePatterns = [
    "timeout",
    "ETIMEDOUT",
    "ECONNRESET",
    "ENOTFOUND",
    "ECONNREFUSED",
    "rate limit",
    "429",
    "503",
    "502",
    "500",
    "network",
    "fetch failed",
    "blockhash not found",
    "Node is behind",
  ];

  for (const pattern of retryablePatterns) {
    if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // Default: retry on unknown errors (conservative approach)
  return true;
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();
  return (
    errorMessage.includes("rate limit") ||
    errorMessage.includes("429") ||
    errorMessage.includes("too many requests")
  );
}

/**
 * Check if an error is a network error
 */
export function isNetworkError(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();
  return (
    errorMessage.includes("network") ||
    errorMessage.includes("timeout") ||
    errorMessage.includes("econnreset") ||
    errorMessage.includes("enotfound") ||
    errorMessage.includes("fetch failed")
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoff(attempt: number, config: RetryConfig): number {
  // Exponential backoff: initialBackoff * (multiplier ^ attempt)
  const exponentialDelay =
    config.initialBackoffMs * Math.pow(config.backoffMultiplier, attempt);

  // Cap at max backoff
  const cappedDelay = Math.min(exponentialDelay, config.maxBackoffMs);

  // Add random jitter to prevent thundering herd
  const jitter = Math.random() * config.jitterMs;

  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Specialized Retry Handlers
// =============================================================================

/**
 * Retry configuration optimized for RPC calls
 */
export const RPC_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialBackoffMs: 500,
  maxBackoffMs: 10000,
  backoffMultiplier: 2,
  jitterMs: 500,
};

/**
 * Retry configuration optimized for transaction confirmation
 */
export const TX_CONFIRM_RETRY_CONFIG: RetryConfig = {
  maxRetries: 30, // Transactions can take a while
  initialBackoffMs: 1000,
  maxBackoffMs: 5000,
  backoffMultiplier: 1.5,
  jitterMs: 200,
};

/**
 * Retry configuration optimized for liquidation execution
 */
export const LIQUIDATION_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2, // Don't retry liquidations too much (competition)
  initialBackoffMs: 500,
  maxBackoffMs: 2000,
  backoffMultiplier: 2,
  jitterMs: 200,
};

/**
 * Execute an RPC call with appropriate retry logic
 */
export async function executeRpcCall<T>(
  fn: () => Promise<T>,
  logger?: Logger
): Promise<T> {
  return executeWithRetry(fn, RPC_RETRY_CONFIG, logger);
}

/**
 * Wait for transaction confirmation with retry logic
 */
export async function waitForConfirmation<T>(
  fn: () => Promise<T>,
  logger?: Logger
): Promise<T> {
  return executeWithRetry(fn, TX_CONFIRM_RETRY_CONFIG, logger);
}
