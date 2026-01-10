// =============================================================================
// VULTR Bot Logger - SECURITY FIX-11: Enhanced with JSON Structured Logging
// =============================================================================
// Logging utility with:
// - Configurable log levels
// - Human-readable colored output
// - JSON structured output mode for log aggregation
// - Audit event logging for security monitoring
// - Correlation ID tracking for request tracing
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS = {
  debug: "\x1b[36m", // Cyan
  info: "\x1b[32m",  // Green
  warn: "\x1b[33m",  // Yellow
  error: "\x1b[31m", // Red
  reset: "\x1b[0m",
};

// =============================================================================
// SECURITY FIX-11: JSON Structured Logging Types
// =============================================================================

export interface JsonLogEntry {
  timestamp: string;
  level: LogLevel | "audit";
  prefix: string;
  message: string;
  correlationId?: string;
  data?: Record<string, unknown>;
}

export interface AuditEvent {
  timestamp: string;
  event: string;
  actor?: string;
  resource?: string;
  action?: string;
  result?: "success" | "failure";
  details?: Record<string, unknown>;
  correlationId?: string;
}

export type LogOutputMode = "human" | "json" | "both";

// =============================================================================
// SECURITY FIX-21: Sensitive Data Masking Patterns
// =============================================================================

const SENSITIVE_PATTERNS = [
  // Solana public keys (32 bytes base58 = 43-44 chars)
  { pattern: /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g, replacement: (match: string) => maskMiddle(match) },
  // Transaction signatures (64 bytes base58 = 87-88 chars)
  { pattern: /\b[1-9A-HJ-NP-Za-km-z]{87,88}\b/g, replacement: (match: string) => maskMiddle(match) },
  // Private key arrays (detect JSON arrays of numbers that could be keys)
  { pattern: /\[\s*\d+\s*(?:,\s*\d+\s*){31,63}\]/g, replacement: "[REDACTED_KEY_MATERIAL]" },
];

/**
 * Mask the middle portion of a string, keeping first and last 6 chars
 */
function maskMiddle(str: string): string {
  if (str.length <= 12) return str;
  return `${str.slice(0, 6)}...${str.slice(-6)}`;
}

/**
 * Apply sensitive data masking to a string
 */
function maskSensitiveData(text: string, shouldMask: boolean): string {
  if (!shouldMask) return text;
  let masked = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    if (typeof replacement === "function") {
      masked = masked.replace(pattern, replacement);
    } else {
      masked = masked.replace(pattern, replacement);
    }
  }
  return masked;
}

/**
 * Logger class with configurable log levels and JSON structured output
 *
 * SECURITY FIX-11: Enhanced with JSON structured logging for log aggregation
 * SECURITY FIX-20: Correlation ID tracking for request tracing
 * SECURITY FIX-21: Sensitive data masking in non-debug logs
 */
export class Logger {
  private level: LogLevel;
  private prefix: string;
  private outputMode: LogOutputMode;
  private correlationId?: string;
  private maskSensitive: boolean;

  constructor(
    prefix: string = "VULTR",
    level: LogLevel = "info",
    outputMode: LogOutputMode = "human",
    correlationId?: string,
    maskSensitive: boolean = true
  ) {
    this.prefix = prefix;
    this.level = level;
    this.outputMode = outputMode;
    this.correlationId = correlationId;
    this.maskSensitive = maskSensitive;
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Set the output mode (human, json, or both)
   */
  setOutputMode(mode: LogOutputMode): void {
    this.outputMode = mode;
  }

  /**
   * Get the current output mode
   */
  getOutputMode(): LogOutputMode {
    return this.outputMode;
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  /**
   * Get current correlation ID
   */
  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  /**
   * Generate a new correlation ID
   */
  generateCorrelationId(): string {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    this.correlationId = id;
    return id;
  }

  /**
   * Enable or disable sensitive data masking
   */
  setMaskSensitive(mask: boolean): void {
    this.maskSensitive = mask;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  /**
   * Check if masking should be applied (mask in non-debug mode)
   */
  private shouldMask(level: LogLevel): boolean {
    return this.maskSensitive && level !== "debug";
  }

  /**
   * Format a log message for human-readable output
   */
  private formatHuman(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const color = LOG_COLORS[level];
    const reset = LOG_COLORS.reset;
    const correlationStr = this.correlationId ? ` [${this.correlationId}]` : "";

    const maskedMessage = maskSensitiveData(message, this.shouldMask(level));
    let formatted = `${color}[${timestamp}] [${this.prefix}]${correlationStr} ${levelStr}${reset} ${maskedMessage}`;

    if (data !== undefined) {
      const dataStr = typeof data === "object"
        ? JSON.stringify(data, null, 2)
        : String(data);
      const maskedData = maskSensitiveData(dataStr, this.shouldMask(level));
      formatted += typeof data === "object" ? `\n${maskedData}` : ` ${maskedData}`;
    }

    return formatted;
  }

  /**
   * Format a log entry as JSON
   */
  private formatJson(level: LogLevel | "audit", message: string, data?: unknown): string {
    const entry: JsonLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      prefix: this.prefix,
      message: maskSensitiveData(message, this.shouldMask(level as LogLevel)),
    };

    if (this.correlationId) {
      entry.correlationId = this.correlationId;
    }

    if (data !== undefined) {
      const dataStr = JSON.stringify(data);
      const maskedDataStr = maskSensitiveData(dataStr, this.shouldMask(level as LogLevel));
      entry.data = JSON.parse(maskedDataStr);
    }

    return JSON.stringify(entry);
  }

  /**
   * Output a log entry based on current output mode
   */
  private output(level: LogLevel, message: string, data?: unknown, useConsoleError = false): void {
    const outputFn = useConsoleError ? console.error : console.log;

    if (this.outputMode === "human" || this.outputMode === "both") {
      outputFn(this.formatHuman(level, message, data));
    }

    if (this.outputMode === "json" || this.outputMode === "both") {
      outputFn(this.formatJson(level, message, data));
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: unknown): void {
    if (this.shouldLog("debug")) {
      this.output("debug", message, data);
    }
  }

  /**
   * Log an info message
   */
  info(message: string, data?: unknown): void {
    if (this.shouldLog("info")) {
      this.output("info", message, data);
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: unknown): void {
    if (this.shouldLog("warn")) {
      this.output("warn", message, data, true);
    }
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | unknown): void {
    if (this.shouldLog("error")) {
      let data: unknown;
      if (error instanceof Error) {
        data = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      } else {
        data = error;
      }
      this.output("error", message, data, true);
    }
  }

  /**
   * Log a success message (always shown, formatted as info)
   */
  success(message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const correlationStr = this.correlationId ? ` [${this.correlationId}]` : "";
    const maskedMessage = maskSensitiveData(message, this.maskSensitive);

    if (this.outputMode === "human" || this.outputMode === "both") {
      const formatted = `\x1b[32m[${timestamp}] [${this.prefix}]${correlationStr} ✓ ${maskedMessage}\x1b[0m`;
      if (data) {
        const dataStr = JSON.stringify(data, null, 2);
        const maskedData = maskSensitiveData(dataStr, this.maskSensitive);
        console.log(`${formatted}\n${maskedData}`);
      } else {
        console.log(formatted);
      }
    }

    if (this.outputMode === "json" || this.outputMode === "both") {
      console.log(this.formatJson("info", `✓ ${message}`, data));
    }
  }

  /**
   * Log a separator line
   */
  separator(): void {
    if (this.outputMode === "human" || this.outputMode === "both") {
      console.log("=".repeat(60));
    }
    // No separator in JSON mode - it would break JSON parsing
  }

  /**
   * Log an audit event for security monitoring
   * Audit events are always logged regardless of log level
   */
  audit(event: string, details: Omit<AuditEvent, "timestamp" | "event" | "correlationId">): void {
    const auditEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      event,
      correlationId: this.correlationId,
      ...details,
    };

    if (this.outputMode === "human" || this.outputMode === "both") {
      const color = auditEvent.result === "failure" ? LOG_COLORS.error : LOG_COLORS.info;
      const reset = LOG_COLORS.reset;
      const correlationStr = this.correlationId ? ` [${this.correlationId}]` : "";
      console.log(
        `${color}[${auditEvent.timestamp}] [${this.prefix}]${correlationStr} AUDIT ${event}${reset}`,
        JSON.stringify(details, null, 2)
      );
    }

    if (this.outputMode === "json" || this.outputMode === "both") {
      // Mask sensitive data in audit events
      const maskedEvent = JSON.parse(
        maskSensitiveData(JSON.stringify(auditEvent), this.maskSensitive)
      );
      console.log(JSON.stringify({ type: "audit", ...maskedEvent }));
    }
  }

  /**
   * Create a child logger with a sub-prefix
   */
  child(subPrefix: string): Logger {
    return new Logger(
      `${this.prefix}:${subPrefix}`,
      this.level,
      this.outputMode,
      this.correlationId,
      this.maskSensitive
    );
  }

  /**
   * Create a child logger with a new correlation ID
   */
  withCorrelation(correlationId?: string): Logger {
    const child = new Logger(
      this.prefix,
      this.level,
      this.outputMode,
      correlationId || this.generateCorrelationId(),
      this.maskSensitive
    );
    return child;
  }
}

// Default logger instance
export const logger = new Logger("VULTR");

/**
 * Format a number as currency
 */
export function formatCurrency(value: number, decimals: number = 2): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Format a number as percentage
 */
export function formatPercent(value: number, decimals: number = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format duration in milliseconds to human readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format a large number with abbreviations
 */
export function formatLargeNumber(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
}
