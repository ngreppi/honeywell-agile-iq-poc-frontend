/**
 * @fileoverview Command Panel Component - UI for command execution
 *
 * Standalone component for building and executing 3D commands with dual-mode editing
 */

import { Component, OnInit, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommandType, CommandResult, TranslatePayload, RotatePayload, ScalePayload } from '../../core/models/types.model';
import { CommandRegistryService } from '../../core/services/command-registry.service';
import { LoggerService } from '../../core/services/logger.service';
import { EventBusService } from '../../core/services/event-bus.service';
import { Subscription } from 'rxjs';

type EditMode = 'parameters' | 'json';

interface CommandPayloadUnion extends Partial<TranslatePayload & RotatePayload & ScalePayload> {}

@Component({
  selector: 'app-command-panel',
  imports: [CommonModule, FormsModule],
  templateUrl: './command-panel.component.html',
  styleUrl: './command-panel.component.scss'
})
export class CommandPanelComponent implements OnInit {
  @Output() commandExecuted = new EventEmitter<CommandResult>();
  @Output() commandError = new EventEmitter<Error>();

  // Signals for reactive state
  protected selectedCommand = signal<CommandType>(CommandType.TRANSLATE);
  protected editMode = signal<EditMode>('parameters');
  protected isExecuting = signal(false);
  protected sceneReady = signal(false);
  protected currentPayload = signal<CommandPayloadUnion>(this.getDefaultPayload(CommandType.TRANSLATE));
  protected jsonText = signal('');
  protected jsonError = signal<string | null>(null);

  // Expose enum to template
  protected readonly CommandType = CommandType;
  protected readonly commandTypes = Object.values(CommandType);

  // Computed
  protected canExecute = computed(() => {
    return this.sceneReady() && !this.isExecuting() && (this.editMode() === 'parameters' || !this.jsonError());
  });

  protected buttonText = computed(() => {
    if (!this.sceneReady()) return 'Loading 3D Scene...';
    if (this.jsonError()) return 'Fix JSON Error';
    if (this.isExecuting()) return 'Executing...';
    return 'Execute Command';
  });

  private sceneReadySubscription?: Subscription;

  constructor(
    private commandRegistry: CommandRegistryService,
    private logger: LoggerService,
    private eventBus: EventBusService
  ) {}

  ngOnInit(): void {
    // Subscribe to scene ready events
    this.sceneReadySubscription = this.eventBus.sceneReady$.subscribe(() => {
      this.sceneReady.set(true);
      this.logger.info('Scene ready - commands can now be executed', 'CommandPanel');
    });

    // Initialize JSON text
    this.updateJsonFromPayload();
  }

  ngOnDestroy(): void {
    this.sceneReadySubscription?.unsubscribe();
  }

  // ================================
  // EVENT HANDLERS
  // ================================

  protected onCommandTypeChange(type: CommandType): void {
    this.selectedCommand.set(type);
    const newPayload = this.getDefaultPayload(type);
    this.currentPayload.set(newPayload);
    this.updateJsonFromPayload();
    this.jsonError.set(null);
  }

  protected onEditModeChange(mode: EditMode): void {
    this.editMode.set(mode);
    if (mode === 'parameters') {
      // Switching to parameters - sync from JSON if valid
      try {
        const parsed = JSON.parse(this.jsonText());
        this.currentPayload.set(parsed);
        this.jsonError.set(null);
      } catch {
        // Keep current payload if JSON is invalid
      }
    } else {
      // Switching to JSON - update JSON from current payload
      this.updateJsonFromPayload();
    }
  }

  protected onParameterChange(key: string, value: any): void {
    if (this.editMode() === 'parameters') {
      const newPayload = { ...this.currentPayload(), [key]: value };
      this.currentPayload.set(newPayload);
      this.updateJsonFromPayload();
    }
  }

  protected onJsonChange(value: string): void {
    this.jsonText.set(value);

    if (this.editMode() === 'json') {
      try {
        const parsed = JSON.parse(value);
        this.currentPayload.set(parsed);
        this.jsonError.set(null);
      } catch (error) {
        this.jsonError.set(`Invalid JSON: ${(error as Error).message}`);
      }
    }
  }

  protected async onExecute(): Promise<void> {
    if (!this.canExecute()) return;

    try {
      this.isExecuting.set(true);

      // Get scene from scene manager
      // We need to find the scene canvas component to get the scene
      // For now, we'll use a global reference approach
      const scene = (window as any).__sceneManager?.getScene();

      this.logger.debug('Scene state check', { sceneReady: this.sceneReady(), sceneExists: !!scene });

      if (!scene) {
        throw new Error('3D Scene not initialized. Please refresh the page.');
      }

      // Verify JSON if in JSON mode
      if (this.editMode() === 'json' && this.jsonError()) {
        throw new Error(`Cannot execute command: ${this.jsonError()}`);
      }

      this.logger.debug('Executing command', {
        type: this.selectedCommand(),
        payload: this.currentPayload(),
        editMode: this.editMode()
      });

      const result = await this.commandRegistry.runCommand(
        {
          type: this.selectedCommand(),
          payload: this.currentPayload() as any
        },
        scene
      );

      this.logger.info('Command executed', { result });

      if (result.success) {
        this.logger.info('Command executed successfully', {
          command: this.selectedCommand(),
          meshName: this.currentPayload().meshName,
          data: result.data
        });
      } else {
        this.logger.warn('Command failed', {
          command: this.selectedCommand(),
          error: result.message,
          data: result.data
        });
      }

      this.commandExecuted.emit(result);

    } catch (error) {
      this.logger.error('Command execution failed', { error });
      this.commandError.emit(error as Error);
    } finally {
      this.isExecuting.set(false);
    }
  }

  // ================================
  // HELPER METHODS
  // ================================

  private getDefaultPayload(commandType: CommandType): CommandPayloadUnion {
    const defaults = {
      [CommandType.TRANSLATE]: {
        meshName: 'mainCube',
        x: 1,
        y: 0,
        z: 0,
        relative: false
      } as TranslatePayload,
      [CommandType.ROTATE]: {
        meshName: 'mainCube',
        x: 0,
        y: 45,
        z: 0,
        relative: false
      } as RotatePayload,
      [CommandType.SCALE]: {
        meshName: 'mainCube',
        x: 1.5,
        y: 1.5,
        z: 1.5,
        uniform: true
      } as ScalePayload
    };

    return defaults[commandType];
  }

  private updateJsonFromPayload(): void {
    this.jsonText.set(JSON.stringify(this.currentPayload(), null, 2));
  }

  // Template helper for checkbox value
  protected getCheckboxValue(key: string): boolean {
    return !!(this.currentPayload() as any)[key];
  }

  // Template helper for parseFloat
  protected parseFloatValue(value: any): number {
    return value !== '' ? parseFloat(value) : 0;
  }
}

