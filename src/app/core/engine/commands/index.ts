/**
 * @fileoverview Command registration and utilities
 *
 * Central module for registering all command handlers and providing command info
 */

import { CommandType } from '../../models/types.model';
import { CommandRegistryService } from '../../services/command-registry.service';
import { EventBusService } from '../../services/event-bus.service';
import { createTranslateCommand, createRotateCommand, createScaleCommand } from './transform-command';

/**
 * Register all command handlers
 */
export function registerAllCommands(
  commandRegistry: CommandRegistryService,
  eventBus: EventBusService
): void {
  console.log('🔧 Registering all command handlers...');

  try {
    // Initialize the registry
    commandRegistry.initialize();

    // Register transform commands
    commandRegistry.registerCommand(CommandType.TRANSLATE, createTranslateCommand(eventBus));
    commandRegistry.registerCommand(CommandType.ROTATE, createRotateCommand(eventBus));
    commandRegistry.registerCommand(CommandType.SCALE, createScaleCommand(eventBus));

    console.log('All command handlers registered successfully');

    // Log registered commands
    const stats = commandRegistry.getRegistryStats();
    console.log(`Available commands (${stats.registeredCommands}):`, Object.values(CommandType));

  } catch (error) {
    console.error('Error registering command handlers:', error);
    throw error;
  }
}

/**
 * Get list of available commands
 */
export function getAvailableCommands(): CommandType[] {
  return Object.values(CommandType);
}

/**
 * Check if a command is supported
 */
export function isCommandSupported(commandType: string): boolean {
  return Object.values(CommandType).includes(commandType as CommandType);
}

/**
 * Get command information for UI
 */
export function getCommandInfo(commandType: CommandType): {
  name: string;
  description: string;
  parameters: string[];
} {
  const commandInfoMap = {
    [CommandType.TRANSLATE]: {
      name: 'Translate',
      description: 'Move object in 3D space',
      parameters: ['x', 'y', 'z', 'relative']
    },
    [CommandType.ROTATE]: {
      name: 'Rotate',
      description: 'Rotate object around its axes (degrees)',
      parameters: ['x', 'y', 'z', 'relative']
    },
    [CommandType.SCALE]: {
      name: 'Scale',
      description: 'Change object size',
      parameters: ['x', 'y', 'z', 'uniform']
    }
  };

  return commandInfoMap[commandType] || {
    name: commandType,
    description: 'Unknown command',
    parameters: []
  };
}

