// =============================================================================
// SECURITY FIX-18: Bot Monitoring and Alerting
// =============================================================================
// Provides integration with external alerting services for critical events:
// - Circuit breaker triggers
// - Daily loss limit reached
// - Consecutive failures
// - Error rate spikes
// =============================================================================

import { Logger } from "./logger";

// =============================================================================
// Types
// =============================================================================

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertConfig {
  enabled: boolean;
  slackWebhookUrl?: string;
  discordWebhookUrl?: string;
  pagerdutyRoutingKey?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  customWebhookUrl?: string;
  minSeverity: AlertSeverity;
}

export interface Alert {
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: false,
  minSeverity: "warning",
};

// =============================================================================
// Alert Monitor
// =============================================================================

/**
 * Monitor for sending alerts to external services
 */
export class AlertMonitor {
  private config: AlertConfig;
  private logger: Logger;
  private recentAlerts: Alert[] = [];
  private alertCounts: Map<string, { count: number; lastTime: number }> = new Map();

  // Rate limiting: max alerts per type per hour
  private readonly MAX_ALERTS_PER_HOUR = 10;
  private readonly RATE_LIMIT_WINDOW_MS = 3600000; // 1 hour

  constructor(config: Partial<AlertConfig> = {}, logger?: Logger) {
    this.config = { ...DEFAULT_ALERT_CONFIG, ...config };
    this.logger = logger || new Logger("Monitor");
  }

  /**
   * Check if alerting is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.hasConfiguredDestination();
  }

  /**
   * Check if any alert destination is configured
   */
  private hasConfiguredDestination(): boolean {
    return !!(
      this.config.slackWebhookUrl ||
      this.config.discordWebhookUrl ||
      this.config.pagerdutyRoutingKey ||
      this.config.telegramBotToken ||
      this.config.customWebhookUrl
    );
  }

  /**
   * Check if alert should be sent based on severity
   */
  private shouldSendAlert(severity: AlertSeverity): boolean {
    const severityLevels: Record<AlertSeverity, number> = {
      info: 0,
      warning: 1,
      critical: 2,
    };

    return severityLevels[severity] >= severityLevels[this.config.minSeverity];
  }

  /**
   * Check rate limit for an alert type
   */
  private checkRateLimit(alertType: string): boolean {
    const now = Date.now();
    const record = this.alertCounts.get(alertType);

    if (!record) {
      this.alertCounts.set(alertType, { count: 1, lastTime: now });
      return true;
    }

    // Reset if window has passed
    if (now - record.lastTime > this.RATE_LIMIT_WINDOW_MS) {
      this.alertCounts.set(alertType, { count: 1, lastTime: now });
      return true;
    }

    // Check if under limit
    if (record.count < this.MAX_ALERTS_PER_HOUR) {
      record.count++;
      return true;
    }

    return false;
  }

  /**
   * Send an alert
   */
  async sendAlert(alert: Alert): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.debug(`Alerting disabled, not sending: ${alert.title}`);
      return;
    }

    if (!this.shouldSendAlert(alert.severity)) {
      this.logger.debug(`Alert below min severity: ${alert.title}`);
      return;
    }

    const alertType = `${alert.severity}:${alert.title}`;
    if (!this.checkRateLimit(alertType)) {
      this.logger.warn(`Rate limited alert: ${alertType}`);
      return;
    }

    // Store in recent alerts
    this.recentAlerts.push(alert);
    if (this.recentAlerts.length > 100) {
      this.recentAlerts = this.recentAlerts.slice(-100);
    }

    // Log the alert
    this.logger.warn(`[ALERT] ${alert.severity.toUpperCase()}: ${alert.title}`, {
      message: alert.message,
      metadata: alert.metadata,
    });

    // Send to configured destinations
    const promises: Promise<void>[] = [];

    if (this.config.slackWebhookUrl) {
      promises.push(this.sendSlackAlert(alert));
    }

    if (this.config.discordWebhookUrl) {
      promises.push(this.sendDiscordAlert(alert));
    }

    if (this.config.pagerdutyRoutingKey && alert.severity === "critical") {
      promises.push(this.sendPagerDutyAlert(alert));
    }

    if (this.config.telegramBotToken && this.config.telegramChatId) {
      promises.push(this.sendTelegramAlert(alert));
    }

    if (this.config.customWebhookUrl) {
      promises.push(this.sendCustomWebhook(alert));
    }

    // Wait for all sends to complete
    await Promise.allSettled(promises);
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(alert: Alert): Promise<void> {
    if (!this.config.slackWebhookUrl) return;

    try {
      const color = alert.severity === "critical" ? "#ff0000" : alert.severity === "warning" ? "#ffaa00" : "#00ff00";

      const payload = {
        attachments: [
          {
            color,
            title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
            text: alert.message,
            footer: "VULTR Bot Monitor",
            ts: Math.floor(alert.timestamp.getTime() / 1000),
            fields: alert.metadata
              ? Object.entries(alert.metadata).map(([key, value]) => ({
                  title: key,
                  value: String(value),
                  short: true,
                }))
              : undefined,
          },
        ],
      };

      const response = await fetch(this.config.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Slack API returned ${response.status}`);
      }
    } catch (error) {
      this.logger.error("Failed to send Slack alert", error);
    }
  }

  /**
   * Send Discord alert
   */
  private async sendDiscordAlert(alert: Alert): Promise<void> {
    if (!this.config.discordWebhookUrl) return;

    try {
      const color = alert.severity === "critical" ? 0xff0000 : alert.severity === "warning" ? 0xffaa00 : 0x00ff00;

      const payload = {
        embeds: [
          {
            title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
            description: alert.message,
            color,
            timestamp: alert.timestamp.toISOString(),
            footer: { text: "VULTR Bot Monitor" },
            fields: alert.metadata
              ? Object.entries(alert.metadata).map(([key, value]) => ({
                  name: key,
                  value: String(value),
                  inline: true,
                }))
              : undefined,
          },
        ],
      };

      const response = await fetch(this.config.discordWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Discord API returned ${response.status}`);
      }
    } catch (error) {
      this.logger.error("Failed to send Discord alert", error);
    }
  }

  /**
   * Send PagerDuty alert (critical only)
   */
  private async sendPagerDutyAlert(alert: Alert): Promise<void> {
    if (!this.config.pagerdutyRoutingKey) return;

    try {
      const payload = {
        routing_key: this.config.pagerdutyRoutingKey,
        event_action: "trigger",
        payload: {
          summary: `${alert.title}: ${alert.message}`,
          severity: alert.severity,
          source: "vultr-bot",
          timestamp: alert.timestamp.toISOString(),
          custom_details: alert.metadata,
        },
      };

      const response = await fetch("https://events.pagerduty.com/v2/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`PagerDuty API returned ${response.status}`);
      }
    } catch (error) {
      this.logger.error("Failed to send PagerDuty alert", error);
    }
  }

  /**
   * Send Telegram alert
   */
  private async sendTelegramAlert(alert: Alert): Promise<void> {
    if (!this.config.telegramBotToken || !this.config.telegramChatId) return;

    try {
      const emoji =
        alert.severity === "critical" ? "🚨" : alert.severity === "warning" ? "⚠️" : "ℹ️";

      const text = `${emoji} *${alert.title}*\n\n${alert.message}${
        alert.metadata ? "\n\n```\n" + JSON.stringify(alert.metadata, null, 2) + "\n```" : ""
      }`;

      const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.telegramChatId,
          text,
          parse_mode: "Markdown",
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Telegram API returned ${response.status}`);
      }
    } catch (error) {
      this.logger.error("Failed to send Telegram alert", error);
    }
  }

  /**
   * Send to custom webhook
   */
  private async sendCustomWebhook(alert: Alert): Promise<void> {
    if (!this.config.customWebhookUrl) return;

    try {
      const response = await fetch(this.config.customWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...alert,
          timestamp: alert.timestamp.toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Custom webhook returned ${response.status}`);
      }
    } catch (error) {
      this.logger.error("Failed to send custom webhook", error);
    }
  }

  // =============================================================================
  // Convenience Methods for Common Alerts
  // =============================================================================

  /**
   * Alert when circuit breaker opens
   */
  async alertCircuitBreakerOpen(reason: string, consecutiveFailures: number): Promise<void> {
    await this.sendAlert({
      severity: "critical",
      title: "Circuit Breaker Opened",
      message: `Bot operations halted due to ${consecutiveFailures} consecutive failures.\n${reason}`,
      timestamp: new Date(),
      metadata: {
        consecutiveFailures,
        reason,
      },
    });
  }

  /**
   * Alert when daily loss limit reached
   */
  async alertDailyLossLimitReached(totalLoss: number, limit: number): Promise<void> {
    await this.sendAlert({
      severity: "critical",
      title: "Daily Loss Limit Reached",
      message: `Bot has hit daily loss limit. Trading halted until reset.`,
      timestamp: new Date(),
      metadata: {
        totalLoss: `$${totalLoss}`,
        limit: `$${limit}`,
      },
    });
  }

  /**
   * Alert on liquidation execution error
   */
  async alertLiquidationError(error: string, account: string): Promise<void> {
    await this.sendAlert({
      severity: "warning",
      title: "Liquidation Failed",
      message: error,
      timestamp: new Date(),
      metadata: {
        account,
      },
    });
  }

  /**
   * Alert on successful large liquidation
   */
  async alertLargeLiquidation(profit: number, account: string): Promise<void> {
    await this.sendAlert({
      severity: "info",
      title: "Large Liquidation Completed",
      message: `Successfully executed large liquidation with $${profit} profit.`,
      timestamp: new Date(),
      metadata: {
        profit: `$${profit}`,
        account,
      },
    });
  }

  /**
   * Alert on low wallet balance
   */
  async alertLowBalance(balance: number, threshold: number): Promise<void> {
    await this.sendAlert({
      severity: "warning",
      title: "Low Wallet Balance",
      message: `Bot wallet SOL balance is below threshold.`,
      timestamp: new Date(),
      metadata: {
        currentBalance: `${balance} SOL`,
        threshold: `${threshold} SOL`,
      },
    });
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(count: number = 10): Alert[] {
    return this.recentAlerts.slice(-count);
  }
}

// =============================================================================
// Helper to load config from environment
// =============================================================================

export function loadAlertConfigFromEnv(): AlertConfig {
  return {
    enabled: process.env.ALERTS_ENABLED === "true",
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    pagerdutyRoutingKey: process.env.PAGERDUTY_ROUTING_KEY,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    customWebhookUrl: process.env.CUSTOM_ALERT_WEBHOOK_URL,
    minSeverity: (process.env.ALERT_MIN_SEVERITY as AlertSeverity) || "warning",
  };
}
