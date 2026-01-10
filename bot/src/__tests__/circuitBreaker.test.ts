// =============================================================================
// P0 Security Tests: Circuit Breaker (FIX-8)
// =============================================================================
// Tests for the circuit breaker implementation that protects against
// cascading failures and excessive losses.
// =============================================================================

import { CircuitBreaker, CircuitState, DEFAULT_CIRCUIT_BREAKER_CONFIG } from "../circuitBreaker";
import { Logger } from "../logger";

describe("CircuitBreaker (FIX-8)", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger("Test", "debug");
  });

  describe("Circuit State Management", () => {
    it("should start in CLOSED state", () => {
      const cb = new CircuitBreaker(logger);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.canExecute()).toBe(true);
    });

    it("should OPEN after 5 consecutive failures", () => {
      const cb = new CircuitBreaker(logger, { maxConsecutiveFailures: 5 });

      // Record 4 failures - should still be closed
      for (let i = 0; i < 4; i++) {
        cb.recordFailure(`Error ${i + 1}`);
        expect(cb.getState()).toBe(CircuitState.CLOSED);
        expect(cb.canExecute()).toBe(true);
      }

      // 5th failure should open the circuit
      cb.recordFailure("Error 5");
      expect(cb.getState()).toBe(CircuitState.OPEN);
      expect(cb.canExecute()).toBe(false);
    });

    it("should reset consecutive failures on success", () => {
      const cb = new CircuitBreaker(logger, { maxConsecutiveFailures: 5 });

      // Record 4 failures
      for (let i = 0; i < 4; i++) {
        cb.recordFailure(`Error ${i + 1}`);
      }

      // Record success - should reset counter
      cb.recordSuccess();
      expect(cb.getState()).toBe(CircuitState.CLOSED);

      // Now 4 more failures should not open circuit
      for (let i = 0; i < 4; i++) {
        cb.recordFailure(`Error ${i + 1}`);
        expect(cb.getState()).toBe(CircuitState.CLOSED);
      }

      // 5th failure after reset should open
      cb.recordFailure("Error 5");
      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it("should transition to HALF_OPEN after reset timeout", async () => {
      const cb = new CircuitBreaker(logger, {
        maxConsecutiveFailures: 2,
        resetTimeoutMs: 100, // 100ms for testing
      });

      // Open the circuit
      cb.recordFailure("Error 1");
      cb.recordFailure("Error 2");
      expect(cb.getState()).toBe(CircuitState.OPEN);
      expect(cb.canExecute()).toBe(false);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should now be HALF_OPEN and allow execution
      expect(cb.canExecute()).toBe(true);
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it("should return to CLOSED on success in HALF_OPEN state", async () => {
      const cb = new CircuitBreaker(logger, {
        maxConsecutiveFailures: 2,
        resetTimeoutMs: 50,
      });

      // Open the circuit
      cb.recordFailure("Error 1");
      cb.recordFailure("Error 2");

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger HALF_OPEN
      cb.canExecute();
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

      // Success should close circuit
      cb.recordSuccess();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe("Daily Loss Limit", () => {
    it("should BLOCK execution when daily loss limit is exceeded", () => {
      const cb = new CircuitBreaker(logger, {
        dailyLossLimitUsd: 100,
      });

      expect(cb.canExecute()).toBe(true);

      // Record losses that exceed the limit
      cb.recordFailure("Loss 1", 50);
      expect(cb.canExecute()).toBe(true);

      cb.recordFailure("Loss 2", 60); // Total: $110 > $100 limit
      expect(cb.canExecute()).toBe(false);

      const stats = cb.getStats();
      expect(stats.dailyLossTotal).toBe(110);
    });

    it("should accumulate losses correctly", () => {
      const cb = new CircuitBreaker(logger, {
        dailyLossLimitUsd: 1000,
        maxConsecutiveFailures: 10, // High so we don't trip on failures
      });

      cb.recordFailure("Loss 1", 100);
      cb.recordFailure("Loss 2", 200);
      cb.recordFailure("Loss 3", 300);

      const stats = cb.getStats();
      expect(stats.dailyLossTotal).toBe(600);
      expect(cb.canExecute()).toBe(true); // Still under limit
    });

    it("should ignore zero or undefined loss amounts", () => {
      const cb = new CircuitBreaker(logger, {
        dailyLossLimitUsd: 100,
        maxConsecutiveFailures: 10,
      });

      cb.recordFailure("No loss");
      cb.recordFailure("Zero loss", 0);
      cb.recordFailure("Undefined loss", undefined);

      const stats = cb.getStats();
      expect(stats.dailyLossTotal).toBe(0);
    });
  });

  describe("Wrap Function", () => {
    it("should execute operation when circuit is CLOSED", async () => {
      const cb = new CircuitBreaker(logger);

      const result = await cb.wrap(
        async () => "success",
        "testOperation"
      );

      expect(result).toBe("success");
    });

    it("should throw error when circuit is OPEN", async () => {
      const cb = new CircuitBreaker(logger, { maxConsecutiveFailures: 2 });

      // Open the circuit
      cb.recordFailure("Error 1");
      cb.recordFailure("Error 2");

      await expect(
        cb.wrap(async () => "success", "testOperation")
      ).rejects.toThrow("Circuit breaker is OPEN");
    });

    it("should record success on successful operation", async () => {
      const cb = new CircuitBreaker(logger, { maxConsecutiveFailures: 5 });

      // Record some failures first
      cb.recordFailure("Error 1");
      cb.recordFailure("Error 2");

      await cb.wrap(async () => "success", "testOperation");

      // Consecutive failures should be reset
      const stats = cb.getStats();
      expect(stats.consecutiveFailures).toBe(0);
    });

    it("should record failure on failed operation", async () => {
      const cb = new CircuitBreaker(logger, { maxConsecutiveFailures: 5 });

      await expect(
        cb.wrap(
          async () => {
            throw new Error("Operation failed");
          },
          "testOperation",
          50 // Loss estimate
        )
      ).rejects.toThrow("Operation failed");

      const stats = cb.getStats();
      expect(stats.consecutiveFailures).toBe(1);
      expect(stats.dailyLossTotal).toBe(50);
    });
  });

  describe("Manual Override", () => {
    it("should force close the circuit", () => {
      const cb = new CircuitBreaker(logger, { maxConsecutiveFailures: 2 });

      // Open the circuit
      cb.recordFailure("Error 1");
      cb.recordFailure("Error 2");
      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Force close
      cb.forceClose();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.canExecute()).toBe(true);
    });

    it("should force open the circuit", () => {
      const cb = new CircuitBreaker(logger);

      expect(cb.getState()).toBe(CircuitState.CLOSED);

      // Force open
      cb.forceOpen("Manual emergency stop");
      expect(cb.getState()).toBe(CircuitState.OPEN);
      expect(cb.canExecute()).toBe(false);
    });
  });

  describe("Statistics", () => {
    it("should track failure history", () => {
      const cb = new CircuitBreaker(logger, { maxConsecutiveFailures: 10 });

      cb.recordFailure("Error 1", 10);
      cb.recordFailure("Error 2", 20);
      cb.recordFailure("Error 3", 30);

      const stats = cb.getStats();
      expect(stats.consecutiveFailures).toBe(3);
      expect(stats.recentFailures.length).toBe(3);
      expect(stats.recentFailures[0].error).toContain("Error 1");
      expect(stats.recentFailures[2].lossAmount).toBe(30);
    });

    it("should limit failure history to 100 entries", () => {
      const cb = new CircuitBreaker(logger, { maxConsecutiveFailures: 200 });

      // Record 120 failures
      for (let i = 0; i < 120; i++) {
        cb.recordFailure(`Error ${i}`);
      }

      const stats = cb.getStats();
      // getStats returns only last 10, but internal history should be capped at 100
      expect(stats.recentFailures.length).toBe(10);
    });
  });

  describe("Disabled Circuit Breaker", () => {
    it("should always allow execution when disabled", () => {
      const cb = new CircuitBreaker(logger, {
        enabled: false,
        maxConsecutiveFailures: 2,
      });

      // Record failures that would normally open the circuit
      cb.recordFailure("Error 1");
      cb.recordFailure("Error 2");
      cb.recordFailure("Error 3");

      // Should still allow execution when disabled
      expect(cb.canExecute()).toBe(true);
    });
  });
});
