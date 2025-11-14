/**
 * @fileoverview Command model definitions
 *
 * Defines the command structure and related interfaces
 */

import { CommandType, CommandPayload } from './types.model';

/**
 * Base command structure
 */
export interface Command<T extends CommandPayload = CommandPayload> {
  type: CommandType;
  payload: T;
  id?: string;
  timestamp?: number;
}

/**
 * Command execution configuration
 */
export interface ExecutionConfig {
  retryAttempts: number;
  retryDelay: number; // milliseconds
  timeout: number; // milliseconds
}

/**
 * Command execution state
 */
export interface ExecutionState {
  id: string;
  command: Command;
  startTime: number;
  attempts: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
}

/**
 * Command middleware function type
 */
export type CommandMiddleware = (
  command: Command,
  scene: any
) => Promise<Command | null>;

