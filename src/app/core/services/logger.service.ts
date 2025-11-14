/**
 * @fileoverview Logger Service - Centralized logging system
 *
 * Provides structured logging with integration to EventBusService for UI display
 */

import { Injectable } from '@angular/core';
import { EventBusService } from './event-bus.service';
import { LogLevel, LoggerConfig } from '../models/types.model';
import { environment } from '../../../environments/environment';

export interface LogContext {
  [key: string]: any;
}

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  private config: LoggerConfig = {
    enabled: environment.enableConsoleLogging,
    minLevel: 'debug',
    includeStack: !environment.production,
    maxDataDepth: 3,
    timestampFormat: 'time'
  };

  private readonly LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3
  };

  constructor(private eventBus: EventBusService) {
    // Expose logger globally for debugging
    if (typeof window !== 'undefined') {
      (window as any).logger = this;
    }
  }

  // ================================
  // PUBLIC API
  // ================================

  /**
   * Log debug message
   */
  debug(message: string, context?: string | LogContext, data?: LogContext): void {
    this.log('debug', message, context, data);
  }

  /**
   * Log info message
   */
  info(message: string, context?: string | LogContext, data?: LogContext): void {
    this.log('info', message, context, data);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: string | LogContext, data?: LogContext): void {
    this.log('warning', message, context, data);
  }

  /**
   * Log error message
   */
  error(message: string, contextOrError?: string | Error | LogContext, data?: Error | LogContext): void {
    let context: string;
    let logData: LogContext | undefined;

    if (typeof contextOrError === 'string') {
      context = contextOrError;
      logData = data instanceof Error ? { error: data } : data;
    } else {
      context = this.inferContext();
      logData = contextOrError instanceof Error ? { error: contextOrError } : contextOrError;
    }

    this.log('error', message, context, logData);
  }

  /**
   * Time an async operation
   */
  async time<T>(label: string, contextOrFn: string | (() => Promise<T>), fn?: () => Promise<T>): Promise<T> {
    const actualContext = typeof contextOrFn === 'string' ? contextOrFn : this.inferContext();
    const actualFn = typeof contextOrFn === 'function' ? contextOrFn : fn!;

    const start = performance.now();
    this.debug(`Started: ${label}`, actualContext);

    try {
      const result = await actualFn();
      const duration = performance.now() - start;
      this.info(`Completed: ${label}`, actualContext, { duration: `${duration.toFixed(2)}ms` });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.error(`Failed: ${label}`, actualContext, { duration: `${duration.toFixed(2)}ms`, error });
      throw error;
    }
  }

  /**
   * Create a logger with fixed context
   */
  createContextLogger(context: string) {
    return {
      debug: (message: string, data?: LogContext) => this.debug(message, context, data),
      info: (message: string, data?: LogContext) => this.info(message, context, data),
      warn: (message: string, data?: LogContext) => this.warn(message, context, data),
      error: (message: string, error?: Error | LogContext) => this.error(message, context, error),
      time: <T>(label: string, fn: () => Promise<T>) => this.time(label, context, fn)
    };
  }

  // ================================
  // CONFIGURATION
  // ================================

  /**
   * Configure the logger
   */
  configure(newConfig: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Enable/disable logging
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Set minimum log level
   */
  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level;
  }

  // ================================
  // PRIVATE METHODS
  // ================================

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, dataOrContext?: LogContext | string, data?: LogContext): void {
    if (!this.config.enabled) return;
    if (this.LOG_LEVELS[level] < this.LOG_LEVELS[this.config.minLevel]) return;

    let context: string;
    let logData: LogContext | undefined;

    // Handle flexible parameters
    if (typeof dataOrContext === 'string') {
      context = dataOrContext;
      logData = data;
    } else {
      context = this.inferContext();
      logData = dataOrContext;
    }

    const entry = {
      level,
      message,
      context,
      data: logData ? this.sanitizeData(logData) : undefined,
      timestamp: Date.now(),
      stack: this.getCleanStack()
    };

    // Send to event bus for UI display
    this.eventBus.emitDebugLog(level === 'warning' ? 'warning' : level, message, context, entry.data);

    // Log to browser console
    this.consoleLog(entry);
  }

  /**
   * Log to browser console with formatting
   */
  private consoleLog(entry: { level: LogLevel; message: string; context: string; data?: any; timestamp: number; stack?: string }): void {
    if (!environment.enableConsoleLogging) {
      return;
    }

    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const prefix = `[${timestamp}] [${entry.context}]`;

    const styles: Record<LogLevel, string> = {
      debug: 'color: #6c757d',
      info: 'color: #17a2b8',
      warning: 'color: #ffc107',
      error: 'color: #dc3545; font-weight: bold'
    };

    if (entry.data) {
      console.groupCollapsed(`%c${prefix} ${entry.message}`, styles[entry.level]);
      console.log('Data:', entry.data);
      if (entry.stack) {
        console.log('Stack:', entry.stack);
      }
      console.groupEnd();
    } else {
      console.log(`%c${prefix} ${entry.message}`, styles[entry.level]);
    }
  }

  /**
   * Sanitize data for logging
   */
  private sanitizeData(data: any, depth = 0): any {
    if (depth > this.config.maxDataDepth) {
      return '[Max depth reached]';
    }

    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }

    if (data instanceof Error) {
      return {
        name: data.name,
        message: data.message,
        stack: data.stack
      };
    }

    if (data instanceof Date) {
      return data.toISOString();
    }

    if (Array.isArray(data)) {
      return data.map((item, index) => {
        if (index > 10) return '[...more items]';
        return this.sanitizeData(item, depth + 1);
      });
    }

    if (typeof data === 'object') {
      const sanitized: Record<string, any> = {};
      let count = 0;

      for (const [key, value] of Object.entries(data)) {
        if (count > 20) {
          sanitized['...more'] = `${Object.keys(data).length - count} more properties`;
          break;
        }

        try {
          sanitized[key] = this.sanitizeData(value, depth + 1);
        } catch {
          sanitized[key] = '[Circular reference or error]';
        }
        count++;
      }

      return sanitized;
    }

    return String(data);
  }

  /**
   * Get clean stack trace
   */
  private getCleanStack(): string | undefined {
    if (!this.config.includeStack) return undefined;

    try {
      const stack = new Error().stack;
      if (!stack) return undefined;

      const lines = stack.split('\n');
      const relevantLines = lines.slice(3, 8);
      return relevantLines.join('\n');
    } catch {
      return undefined;
    }
  }

  /**
   * Infer context from call stack
   */
  private inferContext(): string {
    try {
      const stack = new Error().stack;
      if (!stack) return 'Unknown';

      const lines = stack.split('\n');
      for (let i = 3; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/at\s+(?:.*\s+)?\(?([^()]+):(\d+):(\d+)\)?/);
        if (match) {
          const filePath = match[1];
          const fileName = filePath.split(/[/\\]/).pop()?.replace(/\.(ts|js)$/, '');

          if (fileName && !fileName.includes('node_modules')) {
            return fileName;
          }
        }
      }

      return 'App';
    } catch {
      return 'Unknown';
    }
  }
}

