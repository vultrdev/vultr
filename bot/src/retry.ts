// =============================================================================
// Retry and Error Handling Utilities
// =============================================================================
// Provides robust retry logic with exponential backoff for handling:
// - RPC rate limits
// - Network failures
// - Transaction timeouts
// - Temporary service outages
//
// SECURITY FIX-12: Added idempotency tracking to prevent double-execution
// SECURITY FIX-19: Increased liquidation retry config
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
// SECURITY FIX-12: Idempotency Tracking
// =============================================================================
// Prevents double-execution of transactions during retries.
// If a transaction might have succeeded but we got a timeout, tracking
// prevents us from re-executing and potentially losing funds.
// =============================================================================

/**
 * Record of an executed operation for idempotency tracking
 */
export interface IdempotencyRecord {
  /** Unique identifier for the operation */
  operationId: string;
  /** Transaction signature if available */
  signature?: string;
  /** Timestamp when operation was recorded */
  timestamp: number;
  /** Result of the operation */
  result: "pending" | "success" | "failure";
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Idempotency tracker to prevent double-execution of transactions
 *
 * SECURITY FIX-12: Tracks executed operation IDs and transaction signatures
 * to prevent re-execution during retries, especially for timeout errors
 * where the transaction may have actually succeeded.
 */
export class IdempotencyTracker {
  private records: Map<string, IdempotencyRecord> = new Map();
  private logger?: Logger;
  private maxAge: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * @param maxAgeMs - Maximum age for records before cleanup (default: 1 hour)
   * @param logger - Optional logger
   */
  constructor(maxAgeMs: number = 3600000, logger?: Logger) {
    this.maxAge = maxAgeMs;
    this.logger = logger;

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanup(), 300000); // Every 5 minutes
  }

  /**
   * Check if an operation has already been executed
   */
  hasExecuted(operationId: string): boolean {
    const record = this.records.get(operationId);
    if (!record) return false;

    // Check if record has expired
    if (Date.now() - record.timestamp > this.maxAge) {
      this.records.delete(operationId);
      return false;
    }

    return record.result === "success" || record.result === "pending";
  }

  /**
   * Get the record for an operation if it exists
   */
  getRecord(operationId: string): IdempotencyRecord | undefined {
    const record = this.records.get(operationId);
    if (!record) return undefined;

    // Check if record has expired
    if (Date.now() - record.timestamp > this.maxAge) {
      this.records.delete(operationId);
      return undefined;
    }

    return record;
  }

  /**
   * Mark an operation as pending (about to execute)
   */
  markPending(operationId: string, metadata?: Record<string, unknown>): void {
    if (this.hasExecuted(operationId)) {
      this.logger?.warn(`Operation ${operationId} already executed, skipping`);
      return;
    }

    this.records.set(operationId, {
      operationId,
      timestamp: Date.now(),
      result: "pending",
      metadata,
    });

    this.logger?.debug(`Operation ${operationId} marked as pending`);
  }

  /**
   * Mark an operation as successful
   */
  markSuccess(operationId: string, signature?: string, metadata?: Record<string, unknown>): void {
    const existing = this.records.get(operationId);

    this.records.set(operationId, {
      operationId,
      signature,
      timestamp: Date.now(),
      result: "success",
      metadata: { ...existing?.metadata, ...metadata },
    });

    this.logger?.debug(`Operation ${operationId} marked as success${signature ? ` (sig: ${signature})` : ""}`);
  }

  /**
   * Mark an operation as failed (can be retried)
   */
  markFailure(operationId: string, metadata?: Record<string, unknown>): void {
    const existing = this.records.get(operationId);

    // Only update if not already successful
    if (existing?.result === "success") {
      this.logger?.debug(`Operation ${operationId} already succeeded, not marking as failure`);
      return;
    }

    this.records.set(operationId, {
      operationId,
      timestamp: Date.now(),
      result: "failure",
      metadata: { ...existing?.metadata, ...metadata },
    });

    this.logger?.debug(`Operation ${operationId} marked as failure`);
  }

  /**
   * Check if a transaction signature has been recorded
   */
  hasSignature(signature: string): boolean {
    for (const record of this.records.values()) {
      if (record.signature === signature) {
        return true;
      }
    }
    return false;
  }

  /**
   * Generate a unique operation ID for a liquidation
   * Based on account address and timestamp window to prevent duplicates
   */
  generateLiquidationId(accountAddress: string, windowMs: number = 5000): string {
    const timeWindow = Math.floor(Date.now() / windowMs);
    return `liquidate:${accountAddress}:${timeWindow}`;
  }

  /**
   * Generate a unique operation ID for a swap
   */
  generateSwapId(inputMint: string, outputMint: string, amount: number): string {
    const timeWindow = Math.floor(Date.now() / 5000);
    return `swap:${inputMint}:${outputMint}:${amount}:${timeWindow}`;
  }

  /**
   * Clean up expired records
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, record] of this.records.entries()) {
      if (now - record.timestamp > this.maxAge) {
        this.records.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger?.debug(`Idempotency tracker cleaned up ${cleaned} expired records`);
    }
  }

  /**
   * Get statistics about tracked operations
   */
  getStats(): { total: number; pending: number; success: number; failure: number } {
    let pending = 0;
    let success = 0;
    let failure = 0;

    for (const record of this.records.values()) {
      switch (record.result) {
        case "pending": pending++; break;
        case "success": success++; break;
        case "failure": failure++; break;
      }
    }

    return { total: this.records.size, pending, success, failure };
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records.clear();
  }
}

/**
 * Execute a function with idempotency check
 * Returns cached result if operation was already executed
 */
export async function executeIdempotent<T>(
  operationId: string,
  fn: () => Promise<T>,
  tracker: IdempotencyTracker,
  logger?: Logger
): Promise<T> {
  // Check if already executed
  const existing = tracker.getRecord(operationId);
  if (existing?.result === "success") {
    logger?.info(`Operation ${operationId} already succeeded, skipping re-execution`);
    throw new IdempotencyError(`Operation ${operationId} already executed`);
  }

  // Check if pending (might be in-flight from another call)
  if (existing?.result === "pending") {
    logger?.warn(`Operation ${operationId} is pending, waiting...`);
    // Wait a bit and check again
    await sleep(1000);
    const recheckRecord = tracker.getRecord(operationId);
    if (recheckRecord?.result === "success") {
      throw new IdempotencyError(`Operation ${operationId} already executed`);
    }
  }

  // Mark as pending
  tracker.markPending(operationId);

  try {
    const result = await fn();
    tracker.markSuccess(operationId);
    return result;
  } catch (error) {
    // Only mark as failure if it's retryable
    // For timeout errors, keep as pending since tx might have succeeded
    if (isTimeoutError(error as Error)) {
      logger?.warn(`Operation ${operationId} timed out - keeping as pending (tx may have succeeded)`);
      // Don't mark as failure - the transaction might have actually succeeded
    } else {
      tracker.markFailure(operationId);
    }
    throw error;
  }
}

/**
 * Error thrown when operation was already executed
 */
export class IdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyError";
  }
}

/**
 * Check if an error is a timeout error (transaction might have succeeded)
 */
export function isTimeoutError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("etimedout") ||
    message.includes("blockhash not found") ||
    message.includes("block height exceeded")
  );
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
 *
 * SECURITY FIX-19: Increased maxRetries from 2 to 5 for better reliability
 * while still keeping low backoff for competition sensitivity
 */
export const LIQUIDATION_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5, // Increased from 2 for better reliability
  initialBackoffMs: 300, // Reduced from 500 for faster retries
  maxBackoffMs: 2000,
  backoffMultiplier: 1.5, // Reduced from 2 for quicker escalation
  jitterMs: 150, // Reduced from 200
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
