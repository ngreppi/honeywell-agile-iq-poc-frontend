/**
 * @fileoverview Debug Console Component - Development diagnostics
 *
 * Standalone component that displays real-time logs and events for debugging
 */

import { Component, OnInit, OnDestroy, Input, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { EventBusService } from '../../core/services/event-bus.service';
import { LogEntry } from '../../core/models/event.model';

@Component({
  selector: 'app-debug-console',
  imports: [CommonModule, FormsModule],
  templateUrl: './debug-console.component.html',
  styleUrl: './debug-console.component.scss'
})
export class DebugConsoleComponent implements OnInit, OnDestroy {
  @Input() initialHeight = 200;
  @Input() maxEntries = 100;

  protected logs = signal<LogEntry[]>([]);
  protected isAutoScroll = signal(true);
  protected expandedLogs = signal<Set<string>>(new Set());

  private debugLogSubscription?: Subscription;
  private sceneReadySubscription?: Subscription;

  constructor(private eventBus: EventBusService) {
    // Auto-scroll effect
    effect(() => {
      if (this.isAutoScroll()) {
        this.scrollToTop();
      }
    });
  }

  ngOnInit(): void {
    // Initial log
    this.addLog({
      level: 'info',
      category: 'system',
      message: 'Debug Console initialized'
    });

    // Subscribe to debug log events
    this.debugLogSubscription = this.eventBus.debugLog$.subscribe(payload => {
      this.addLog({
        level: payload.level === 'warning' ? 'warning' : payload.level,
        category: payload.context || 'system',
        message: payload.message,
        data: payload.data
      });
    });

    // Subscribe to scene ready events
    this.sceneReadySubscription = this.eventBus.sceneReady$.subscribe(() => {
      this.addLog({
        level: 'success',
        category: 'scene',
        message: 'Scene is ready for commands'
      });
    });
  }

  ngOnDestroy(): void {
    this.debugLogSubscription?.unsubscribe();
    this.sceneReadySubscription?.unsubscribe();
  }

  // ================================
  // LOG MANAGEMENT
  // ================================

  private addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
    const newEntry: LogEntry = {
      ...entry,
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };

    const currentLogs = this.logs();
    const updated = [newEntry, ...currentLogs];
    this.logs.set(updated.slice(0, this.maxEntries));
  }

  protected handleClear(): void {
    this.logs.set([]);
    this.addLog({
      level: 'info',
      category: 'system',
      message: 'Console cleared'
    });
  }

  protected handleScroll(event: Event): void {
    const target = event.target as HTMLElement;
    const scrollTop = target.scrollTop;
    const isAtTop = scrollTop < 10;
    this.isAutoScroll.set(isAtTop);
  }

  // ================================
  // CLIPBOARD OPERATIONS
  // ================================

  protected copyLogToClipboard(log: LogEntry): void {
    const timestamp = new Date(log.timestamp).toISOString();
    const dataStr = log.data ? `\nData: ${JSON.stringify(log.data, null, 2)}` : '';
    const logText = `[${timestamp}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}${dataStr}`;

    navigator.clipboard.writeText(logText).then(() => {
      this.showNotification('Log copied to clipboard!');
    }).catch(() => {
      console.warn('Failed to copy to clipboard');
    });
  }

  protected copyAllLogs(): void {
    const allLogsText = this.logs().map(log => {
      const timestamp = new Date(log.timestamp).toISOString();
      const dataStr = log.data ? `\nData: ${JSON.stringify(log.data, null, 2)}` : '';
      return `[${timestamp}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}${dataStr}`;
    }).join('\n\n');

    navigator.clipboard.writeText(allLogsText).then(() => {
      this.showNotification(`${this.logs().length} logs copied to clipboard!`);
    });
  }

  private showNotification(message: string): void {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 10000;
      background: #48ca84; color: white; padding: 8px 16px;
      border-radius: 4px; font-size: 12px; font-family: monospace;
    `;
    document.body.appendChild(notification);
    setTimeout(() => document.body.removeChild(notification), 2000);
  }

  // ================================
  // EXPANSION MANAGEMENT
  // ================================

  protected toggleLogExpansion(logId: string): void {
    const currentExpanded = this.expandedLogs();
    const newSet = new Set(currentExpanded);

    if (newSet.has(logId)) {
      newSet.delete(logId);
    } else {
      newSet.add(logId);
    }

    this.expandedLogs.set(newSet);
  }

  protected isLogExpanded(logId: string): boolean {
    return this.expandedLogs().has(logId);
  }

  // ================================
  // HELPERS
  // ================================

  protected getLogColor(level: LogEntry['level']): string {
    const colors = {
      error: '#ff6b6b',
      warning: '#feca57',
      success: '#48ca84',
      info: '#54a0ff',
      debug: '#a2a8b4'
    };
    return colors[level] || '#a2a8b4';
  }

  protected formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  }

  protected hasData(log: LogEntry): boolean {
    return !!(log.data && Object.keys(log.data).length > 0);
  }

  private scrollToTop(): void {
    // This would need a ViewChild reference to the scroll container
    // For now, it's a placeholder
  }

  protected get height(): number {
    return this.initialHeight;
  }
}

