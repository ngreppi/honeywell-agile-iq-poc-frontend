/**
 * @fileoverview Event model definitions
 *
 * Defines the event structure and related interfaces
 */

import { EventType, EventPayload } from './types.model';

/**
 * Base event structure
 */
export interface AppEvent<T extends EventPayload = EventPayload> {
  type: EventType;
  payload: T;
}

/**
 * Log entry structure for debug console
 */
export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warning' | 'error' | 'success';
  category: string;
  message: string;
  data?: any;
  copyable?: string;
}

