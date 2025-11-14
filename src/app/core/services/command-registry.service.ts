/**
 * @fileoverview Command Registry Service - Manages command handlers and execution
 *
 * Central registry for command handlers with retry logic, middleware support,
 * and error handling.
 */

import { Injectable } from '@angular/core';
import type { Scene } from '@babylonjs/core';
import { CommandType, CommandHandler, CommandPayload, CommandResult } from '../models/types.model';
import { Command, ExecutionConfig, ExecutionState, CommandMiddleware } from '../models/command.model';
import { EventBusService } from './event-bus.service';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class CommandRegistryService {
  private commandHandlers = new Map<CommandType, CommandHandler>();
  private middlewares: CommandMiddleware[] = [];
  private executionStates = new Map<string, ExecutionState>();

  private readonly defaultConfig: ExecutionConfig = {
    retryAttempts: 2,
    retryDelay: 1000,
    timeout: 5000
  };

  constructor(
    private eventBus: EventBusService,
    private logger: LoggerService
  ) {}

  // ================================
  // COMMAND REGISTRATION
  // ================================

  /**
   * Register a command handler
   */
  registerCommand<T extends CommandPayload>(
    commandType: CommandType,
    handler: CommandHandler<T>
  ): void {
    if (this.commandHandlers.has(commandType)) {
      console.warn(`Command handler for ${commandType} already exists. Overwriting...`);
    }

    this.commandHandlers.set(commandType, handler as CommandHandler);
    console.log(`Registered command handler: ${commandType}`);
  }

  /**
   * Unregister a command handler
   */
  unregisterCommand(commandType: CommandType): boolean {
    const removed = this.commandHandlers.delete(commandType);
    if (removed) {
      console.log(`Unregistered command handler: ${commandType}`);
    }
    return removed;
  }

  /**
   * Check if a command is registered
   */
  isCommandRegistered(commandType: CommandType): boolean {
    return this.commandHandlers.has(commandType);
  }

  /**
   * Get all registered commands
   */
  getRegisteredCommands(): CommandType[] {
    return Array.from(this.commandHandlers.keys());
  }

  // ================================
  // MIDDLEWARE MANAGEMENT
  // ================================

  /**
   * Register a middleware
   */
  registerMiddleware(middleware: CommandMiddleware): void {
    this.middlewares.push(middleware);
    console.log(`Registered command middleware (total: ${this.middlewares.length})`);
  }

  /**
   * Run all middlewares on a command
   */
  private async runMiddlewares(command: Command, scene: Scene): Promise<Command | null> {
    let processedCommand = command;

    for (const middleware of this.middlewares) {
      try {
        const result = await middleware(processedCommand, scene);
        if (result === null) {
          console.log(`Command ${command.type} blocked by middleware`);
          return null;
        }
        processedCommand = result;
      } catch (error) {
        console.error(`Middleware error for command ${command.type}:`, error);
        this.eventBus.emitError(error as Error, 'middleware');
        return null;
      }
    }

    return processedCommand;
  }

  // ================================
  // COMMAND EXECUTION
  // ================================

  /**
   * Execute a command with retry logic and timeout
   */
  async runCommand(
    command: Command,
    scene: Scene,
    config: Partial<ExecutionConfig> = {}
  ): Promise<CommandResult> {
    const execConfig = { ...this.defaultConfig, ...config };
    const commandId = command.id || `cmd_${Date.now()}`;

    // Create execution state
    const executionState: ExecutionState = {
      id: commandId,
      command,
      startTime: Date.now(),
      attempts: 0,
      status: 'pending'
    };

    this.executionStates.set(commandId, executionState);

    try {
      // Verify command is registered
      const handler = this.commandHandlers.get(command.type);
      if (!handler) {
        throw new Error(`No handler registered for command type: ${command.type}`);
      }

      // Execute middlewares
      executionState.status = 'executing';
      const processedCommand = await this.runMiddlewares(command, scene);
      if (!processedCommand) {
        return { success: false, message: 'Command blocked by middleware' };
      }

      // Execute with retry logic
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= execConfig.retryAttempts; attempt++) {
        executionState.attempts = attempt;

        try {
          this.logger.info(`Executing command ${command.type}`, 'CommandRegistry', {
            commandType: command.type,
            attempt,
            maxAttempts: execConfig.retryAttempts,
            payload: processedCommand.payload
          });

          // Execute with timeout
          const result = await this.withTimeout(
            handler(scene, processedCommand.payload),
            execConfig.timeout
          );

          executionState.status = 'completed';

          // Emit command executed event
          this.eventBus.emitCommandExecuted(processedCommand, result);

          // Log result
          if (result.success) {
            this.logger.info(`Command ${command.type} executed successfully`, 'CommandRegistry', {
              commandType: command.type,
              result,
              executionTime: Date.now() - (processedCommand.timestamp || Date.now())
            });
          } else {
            this.logger.error(`Command ${command.type} failed: ${result.message}`, 'CommandRegistry', {
              commandType: command.type,
              result,
              executionTime: Date.now() - (processedCommand.timestamp || Date.now())
            });
          }

          return result;

        } catch (error) {
          lastError = error as Error;
          this.logger.warn(`Command ${command.type} failed on attempt ${attempt}`, 'CommandRegistry', {
            commandType: command.type,
            attempt,
            maxAttempts: execConfig.retryAttempts,
            error: error as Error
          });

          // Wait before retry if not the last attempt
          if (attempt < execConfig.retryAttempts) {
            await this.delay(execConfig.retryDelay);
          }
        }
      }

      // All attempts failed
      executionState.status = 'failed';
      const errorMessage = `Command ${command.type} failed after ${execConfig.retryAttempts} attempts: ${lastError?.message}`;

      this.eventBus.emitError(new Error(errorMessage), 'command_execution');

      this.logger.error(errorMessage, 'CommandRegistry', {
        commandType: command.type,
        totalAttempts: execConfig.retryAttempts,
        lastError
      });

      return {
        success: false,
        message: errorMessage,
        data: { attempts: execConfig.retryAttempts, lastError: lastError?.message }
      };

    } finally {
      // Cleanup state after some time
      setTimeout(() => {
        this.executionStates.delete(commandId);
      }, 30000); // 30 seconds
    }
  }

  // ================================
  // STATE MANAGEMENT
  // ================================

  /**
   * Get execution state by ID
   */
  getExecutionState(commandId: string): ExecutionState | undefined {
    return this.executionStates.get(commandId);
  }

  /**
   * Get all execution states
   */
  getAllExecutionStates(): ExecutionState[] {
    return Array.from(this.executionStates.values());
  }

  /**
   * Clear all execution states
   */
  clearExecutionStates(): void {
    this.executionStates.clear();
  }

  /**
   * Get registry statistics
   */
  getRegistryStats() {
    return {
      registeredCommands: this.commandHandlers.size,
      activeMiddlewares: this.middlewares.length,
      activeExecutions: this.executionStates.size,
      commandTypes: Array.from(this.commandHandlers.keys())
    };
  }

  // ================================
  // INITIALIZATION
  // ================================

  /**
   * Initialize the command registry with base middlewares
   */
  initialize(): void {
    console.log('Initializing Command Registry...');

    // Logging middleware
    this.registerMiddleware(async (command, _scene) => {
      console.log(`Processing command: ${command.type}`, {
        id: command.id,
        timestamp: command.timestamp,
        payloadKeys: Object.keys(command.payload)
      });
      return command;
    });

    // Scene validation middleware
    this.registerMiddleware(async (command, scene) => {
      if (!scene || (scene as any).isDisposed) {
        throw new Error('Scene is not available or disposed');
      }
      const meshCount = scene.meshes.length;
      console.log(`Scene validation passed for command: ${command.type} on scene with ${meshCount} meshes`);
      return command;
    });

    console.log('Command Registry initialized');
  }

  // ================================
  // UTILITY METHODS
  // ================================

  /**
   * Create a delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Command execution timeout')), timeoutMs)
      )
    ]);
  }
}

