#!/usr/bin/env ts-node
// =============================================================================
// Test Script for Alert Webhook Integration
// =============================================================================
// Usage: npx ts-node src/test-alerts.ts
//
// Requires SLACK_WEBHOOK_URL (or other webhook) in .env or environment
// =============================================================================

import * as dotenv from "dotenv";
import { AlertMonitor, loadAlertConfigFromEnv } from "./monitor";
import { Logger } from "./logger";

dotenv.config();

async function testAlerts() {
  const logger = new Logger("AlertTest", "debug");

  console.log("\n=== VULTR Alert Webhook Test ===\n");

  // Load config from environment
  const config = loadAlertConfigFromEnv();

  // Show configured destinations
  console.log("Configuration:");
  console.log(`  Enabled: ${config.enabled}`);
  console.log(`  Min Severity: ${config.minSeverity}`);
  console.log(`  Slack: ${config.slackWebhookUrl ? "✓ Configured" : "✗ Not configured"}`);
  console.log(`  Discord: ${config.discordWebhookUrl ? "✓ Configured" : "✗ Not configured"}`);
  console.log(`  PagerDuty: ${config.pagerdutyRoutingKey ? "✓ Configured" : "✗ Not configured"}`);
  console.log(`  Telegram: ${config.telegramBotToken ? "✓ Configured" : "✗ Not configured"}`);
  console.log(`  Custom: ${config.customWebhookUrl ? "✓ Configured" : "✗ Not configured"}`);
  console.log("");

  if (!config.slackWebhookUrl && !config.discordWebhookUrl && !config.customWebhookUrl) {
    console.error("ERROR: No webhook URL configured!");
    console.error("Set SLACK_WEBHOOK_URL in your .env file");
    console.error("\nExample:");
    console.error("  ALERTS_ENABLED=true");
    console.error("  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...");
    process.exit(1);
  }

  // Force enable for testing
  const testConfig = { ...config, enabled: true };
  const monitor = new AlertMonitor(testConfig, logger);

  console.log("Sending test alerts...\n");

  // Test 1: Info alert
  console.log("1. Sending INFO alert...");
  await monitor.sendAlert({
    severity: "info",
    title: "Test Alert - Info",
    message: "This is a test INFO alert from VULTR Bot.",
    timestamp: new Date(),
    metadata: {
      test: true,
      environment: "development",
    },
  });
  console.log("   ✓ Info alert sent\n");

  // Wait a bit between alerts to avoid rate limiting
  await sleep(1000);

  // Test 2: Warning alert
  console.log("2. Sending WARNING alert...");
  await monitor.sendAlert({
    severity: "warning",
    title: "Test Alert - Warning",
    message: "This is a test WARNING alert from VULTR Bot.",
    timestamp: new Date(),
    metadata: {
      consecutiveFailures: 3,
      lastError: "Simulated error for testing",
    },
  });
  console.log("   ✓ Warning alert sent\n");

  await sleep(1000);

  // Test 3: Critical alert
  console.log("3. Sending CRITICAL alert...");
  await monitor.sendAlert({
    severity: "critical",
    title: "Test Alert - Critical",
    message: "This is a test CRITICAL alert from VULTR Bot. In production, this would indicate the circuit breaker opened.",
    timestamp: new Date(),
    metadata: {
      consecutiveFailures: 5,
      dailyLossTotal: "$0 (test)",
      reason: "Test alert - no actual issue",
    },
  });
  console.log("   ✓ Critical alert sent\n");

  await sleep(1000);

  // Test 4: Circuit breaker alert (using convenience method)
  console.log("4. Sending Circuit Breaker alert...");
  await monitor.alertCircuitBreakerOpen(
    "Test: Simulated 5 consecutive failures",
    5
  );
  console.log("   ✓ Circuit breaker alert sent\n");

  await sleep(1000);

  // Test 5: Low balance alert
  console.log("5. Sending Low Balance alert...");
  await monitor.alertLowBalance(0.05, 0.1);
  console.log("   ✓ Low balance alert sent\n");

  console.log("=== All test alerts sent! ===\n");
  console.log("Check your Slack/Discord channel for the test messages.");
  console.log("If you don't see them:");
  console.log("  1. Verify your webhook URL is correct");
  console.log("  2. Check ALERTS_ENABLED=true");
  console.log("  3. Check ALERT_MIN_SEVERITY (info shows all, warning hides info, critical hides warning+info)");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the test
testAlerts()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });
