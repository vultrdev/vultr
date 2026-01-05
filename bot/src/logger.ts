// =============================================================================
// VULTR Bot Logger
// =============================================================================
// Simple logging utility with log levels and formatting.
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

/**
 * Logger class with configurable log levels
 */
export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix: string = "VULTR", level: LogLevel = "info") {
    this.prefix = prefix;
    this.level = level;
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
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  /**
   * Format a log message
   */
  private format(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const color = LOG_COLORS[level];
    const reset = LOG_COLORS.reset;

    let formatted = `${color}[${timestamp}] [${this.prefix}] ${levelStr}${reset} ${message}`;

    if (data !== undefined) {
      if (typeof data === "object") {
        formatted += `\n${JSON.stringify(data, null, 2)}`;
      } else {
        formatted += ` ${data}`;
      }
    }

    return formatted;
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: unknown): void {
    if (this.shouldLog("debug")) {
      console.log(this.format("debug", message, data));
    }
  }

  /**
   * Log an info message
   */
  info(message: string, data?: unknown): void {
    if (this.shouldLog("info")) {
      console.log(this.format("info", message, data));
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: unknown): void {
    if (this.shouldLog("warn")) {
      console.warn(this.format("warn", message, data));
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
      console.error(this.format("error", message, data));
    }
  }

  /**
   * Log a success message (always shown, formatted as info)
   */
  success(message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const formatted = `\x1b[32m[${timestamp}] [${this.prefix}] ✓ ${message}\x1b[0m`;
    console.log(data ? `${formatted}\n${JSON.stringify(data, null, 2)}` : formatted);
  }

  /**
   * Log a separator line
   */
  separator(): void {
    console.log("=".repeat(60));
  }

  /**
   * Create a child logger with a sub-prefix
   */
  child(subPrefix: string): Logger {
    return new Logger(`${this.prefix}:${subPrefix}`, this.level);
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
