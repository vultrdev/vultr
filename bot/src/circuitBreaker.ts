// =============================================================================
// SECURITY FIX-8: Circuit Breaker for Bot Operations
// =============================================================================
// Protects the bot from cascading failures and excessive losses by stopping
// operations when too many consecutive failures occur.
//
// Integrates with AlertMonitor (FIX-18) to send alerts when circuit opens.
// =============================================================================

import { Logger } from "./logger";
import { AlertMonitor } from "./monitor";

export interface CircuitBreakerConfig {
  maxConsecutiveFailures: number;
  resetTimeoutMs: number;
  dailyLossLimitUsd: number;
  enabled: boolean;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveFailures: 5,
  resetTimeoutMs: 300000, // 5 minutes
  dailyLossLimitUsd: 1000,
  enabled: true,
};

export enum CircuitState {
  CLOSED = "CLOSED", // Normal operation
  OPEN = "OPEN", // Not accepting requests
  HALF_OPEN = "HALF_OPEN", // Testing if service recovered
}

export interface FailureRecord {
  timestamp: number;
  error: string;
  lossAmount?: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures: number = 0;
  private lastFailureTime: number = 0;
  private failureHistory: FailureRecord[] = [];
  private dailyLossTotal: number = 0;
  private lastLossResetDate: string = "";
  private logger: Logger;
  private config: CircuitBreakerConfig;
  private alertMonitor?: AlertMonitor;

  constructor(
    logger: Logger,
    config: Partial<CircuitBreakerConfig> = {},
    alertMonitor?: AlertMonitor
  ) {
    this.logger = logger.child("CircuitBreaker");
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.alertMonitor = alertMonitor;
  }

  /**
   * Set the alert monitor (for deferred initialization)
   */
  setAlertMonitor(alertMonitor: AlertMonitor): void {
    this.alertMonitor = alertMonitor;
  }

  /**
   * Check if circuit breaker allows operation
   */
  canExecute(): boolean {
    if (!this.config.enabled) {
      return true;
    }

    // Check daily loss limit
    this.checkDailyLossReset();
    if (this.dailyLossTotal >= this.config.dailyLossLimitUsd) {
      this.logger.error(
        `CIRCUIT BREAKER: Daily loss limit exceeded ($${this.dailyLossTotal}/$${this.config.dailyLossLimitUsd})`
      );

      // Send alert for daily loss limit (only once per day)
      if (this.alertMonitor && this.state !== CircuitState.OPEN) {
        this.alertMonitor
          .alertDailyLossLimitReached(this.dailyLossTotal, this.config.dailyLossLimitUsd)
          .catch((err) => {
            this.logger.error("Failed to send daily loss limit alert", err);
          });
        this.state = CircuitState.OPEN; // Prevent duplicate alerts
      }
      return false;
    }

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if we should try to recover
        if (Date.now() - this.lastFailureTime > this.config.resetTimeoutMs) {
          this.state = CircuitState.HALF_OPEN;
          this.logger.info("Circuit breaker entering HALF_OPEN state - attempting recovery");
          return true;
        }
        this.logger.warn(
          `Circuit breaker OPEN - ${Math.round((this.config.resetTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000)}s until retry`
        );
        return false;

      case CircuitState.HALF_OPEN:
        // Allow one request through to test recovery
        return true;

      default:
        return false;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.logger.info("Circuit breaker recovered - returning to CLOSED state");
    }

    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
  }

  /**
   * Record a failed operation
   */
  recordFailure(error: string, lossAmount?: number): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    // Track loss amount
    if (lossAmount !== undefined && lossAmount > 0) {
      this.dailyLossTotal += lossAmount;
      this.logger.warn(`Loss recorded: $${lossAmount}. Daily total: $${this.dailyLossTotal}`);
    }

    // Record in history
    this.failureHistory.push({
      timestamp: Date.now(),
      error,
      lossAmount,
    });

    // Keep only last 100 failures
    if (this.failureHistory.length > 100) {
      this.failureHistory = this.failureHistory.slice(-100);
    }

    this.logger.warn(
      `Failure recorded: ${this.consecutiveFailures}/${this.config.maxConsecutiveFailures}`
    );

    // Check if we should open the circuit
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.open(error);
    }
  }

  /**
   * Open the circuit breaker
   */
  private open(reason: string): void {
    if (this.state !== CircuitState.OPEN) {
      this.state = CircuitState.OPEN;
      this.logger.error(
        `=== CIRCUIT BREAKER OPENED ===\n` +
          `Reason: ${this.consecutiveFailures} consecutive failures\n` +
          `Last error: ${reason}\n` +
          `Will retry in ${this.config.resetTimeoutMs / 1000} seconds\n` +
          `Daily loss so far: $${this.dailyLossTotal}`
      );

      // Send alert via AlertMonitor
      if (this.alertMonitor) {
        this.alertMonitor.alertCircuitBreakerOpen(reason, this.consecutiveFailures).catch((err) => {
          this.logger.error("Failed to send circuit breaker alert", err);
        });
      }
    }
  }

  /**
   * Force close the circuit (manual override)
   */
  forceClose(): void {
    this.logger.info("Circuit breaker manually closed");
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
  }

  /**
   * Force open the circuit (manual override)
   */
  forceOpen(reason: string = "Manual override"): void {
    this.state = CircuitState.OPEN;
    this.lastFailureTime = Date.now();
    this.logger.error(`Circuit breaker manually opened: ${reason}`);
  }

  /**
   * Reset daily loss counter if it's a new day
   */
  private checkDailyLossReset(): void {
    const today = new Date().toISOString().split("T")[0];
    if (today !== this.lastLossResetDate) {
      if (this.dailyLossTotal > 0) {
        this.logger.info(`Daily loss reset. Previous day total: $${this.dailyLossTotal}`);
      }
      this.dailyLossTotal = 0;
      this.lastLossResetDate = today;
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): {
    state: CircuitState;
    consecutiveFailures: number;
    dailyLossTotal: number;
    lastFailureTime: number;
    recentFailures: FailureRecord[];
  } {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      dailyLossTotal: this.dailyLossTotal,
      lastFailureTime: this.lastFailureTime,
      recentFailures: this.failureHistory.slice(-10),
    };
  }

  /**
   * Wrap an async function with circuit breaker protection
   */
  async wrap<T>(
    operation: () => Promise<T>,
    operationName: string,
    lossEstimateOnFailure?: number
  ): Promise<T> {
    if (!this.canExecute()) {
      throw new Error(`Circuit breaker is OPEN - ${operationName} not executed`);
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.recordFailure(`${operationName}: ${errorMessage}`, lossEstimateOnFailure);
      throw error;
    }
  }
}
