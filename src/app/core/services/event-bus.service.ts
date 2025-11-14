/**
 * @fileoverview Event Bus Service - RxJS-based event communication system
 *
 * Replaces the mitt event bus from React with RxJS Subjects.
 * Provides type-safe event emission and subscription throughout the app.
 */

import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  EventType,
  CommandType,
  RotationChangedPayload,
  PositionChangedPayload,
  SceneReadyPayload,
  MeshClickedPayload,
  MeshVisibilityChangedPayload,
  ModelImportRequestedPayload,
  DebugLogPayload,
  BusLogConfig,
  SensorCreationRequestedPayload,
  SensorCreatedPayload,
  SensorLinkRequestedPayload,
  SensorInsertionModeChangedPayload,
  SensorLinkModeChangedPayload,
  SensorDistanceModeChangedPayload,
  SensorDistanceCalculatedPayload,
  PanelVisibilityChangedPayload,
  HeatmapVisibilityChangedPayload,
  HeatmapModeChangedPayload
} from '../models/types.model';
import { Command } from '../models/command.model';
import { CommandResult } from '../models/types.model';
import { AppEvent } from '../models/event.model';

/**
 * Event Bus Service
 *
 * Central hub for application-wide event communication using RxJS.
 * Provides type-safe subjects for each event type.
 */
@Injectable({
  providedIn: 'root'
})
export class EventBusService {
  // ================================
  // EVENT SUBJECTS
  // ================================

  private readonly rotationChangedSubject = new Subject<RotationChangedPayload>();
  private readonly positionChangedSubject = new Subject<PositionChangedPayload>();
  private readonly sceneReadySubject = new Subject<SceneReadyPayload>();
  private readonly meshClickedSubject = new Subject<MeshClickedPayload>();
  private readonly meshVisibilityChangedSubject = new Subject<MeshVisibilityChangedPayload>();
  private readonly modelImportRequestedSubject = new Subject<ModelImportRequestedPayload>();
  private readonly debugLogSubject = new Subject<DebugLogPayload>();
  private readonly sensorCreationRequestedSubject = new Subject<SensorCreationRequestedPayload>();
  private readonly sensorCreatedSubject = new Subject<SensorCreatedPayload>();
  private readonly sensorLinkRequestedSubject = new Subject<SensorLinkRequestedPayload>();
  private readonly sensorInsertionModeChangedSubject = new Subject<SensorInsertionModeChangedPayload>();
  private readonly sensorLinkModeChangedSubject = new Subject<SensorLinkModeChangedPayload>();
  private readonly sensorDistanceModeChangedSubject = new Subject<SensorDistanceModeChangedPayload>();
  private readonly sensorDistanceCalculatedSubject = new Subject<SensorDistanceCalculatedPayload>();
  private readonly panelVisibilityChangedSubject = new Subject<PanelVisibilityChangedPayload>();
  private readonly heatmapVisibilityChangedSubject = new Subject<HeatmapVisibilityChangedPayload>();
  private readonly heatmapModeChangedSubject = new Subject<HeatmapModeChangedPayload>();

  // Command execution events
  private readonly commandExecutedSubject = new Subject<{ command: Command; result: CommandResult }>();
  private readonly errorSubject = new Subject<{ error: Error; context: string }>();

  // ================================
  // PUBLIC OBSERVABLES
  // ================================

  public readonly rotationChanged$: Observable<RotationChangedPayload> = this.rotationChangedSubject.asObservable();
  public readonly positionChanged$: Observable<PositionChangedPayload> = this.positionChangedSubject.asObservable();
  public readonly sceneReady$: Observable<SceneReadyPayload> = this.sceneReadySubject.asObservable();
  public readonly meshClicked$: Observable<MeshClickedPayload> = this.meshClickedSubject.asObservable();
  public readonly meshVisibilityChanged$: Observable<MeshVisibilityChangedPayload> = this.meshVisibilityChangedSubject.asObservable();
  public readonly modelImportRequested$: Observable<ModelImportRequestedPayload> = this.modelImportRequestedSubject.asObservable();
  public readonly debugLog$: Observable<DebugLogPayload> = this.debugLogSubject.asObservable();
  public readonly sensorCreationRequested$: Observable<SensorCreationRequestedPayload> = this.sensorCreationRequestedSubject.asObservable();
  public readonly sensorCreated$: Observable<SensorCreatedPayload> = this.sensorCreatedSubject.asObservable();
  public readonly sensorLinkRequested$: Observable<SensorLinkRequestedPayload> = this.sensorLinkRequestedSubject.asObservable();
  public readonly sensorInsertionModeChanged$: Observable<SensorInsertionModeChangedPayload> = this.sensorInsertionModeChangedSubject.asObservable();
  public readonly sensorLinkModeChanged$: Observable<SensorLinkModeChangedPayload> = this.sensorLinkModeChangedSubject.asObservable();
  public readonly sensorDistanceModeChanged$: Observable<SensorDistanceModeChangedPayload> = this.sensorDistanceModeChangedSubject.asObservable();
  public readonly sensorDistanceCalculated$: Observable<SensorDistanceCalculatedPayload> = this.sensorDistanceCalculatedSubject.asObservable();
  public readonly panelVisibilityChanged$: Observable<PanelVisibilityChangedPayload> = this.panelVisibilityChangedSubject.asObservable();
  public readonly heatmapVisibilityChanged$: Observable<HeatmapVisibilityChangedPayload> = this.heatmapVisibilityChangedSubject.asObservable();
  public readonly heatmapModeChanged$: Observable<HeatmapModeChangedPayload> = this.heatmapModeChangedSubject.asObservable();
  public readonly commandExecuted$: Observable<{ command: Command; result: CommandResult }> = this.commandExecutedSubject.asObservable();
  public readonly error$: Observable<{ error: Error; context: string }> = this.errorSubject.asObservable();

  // ================================
  // CONFIGURATION
  // ================================

  private logConfig: BusLogConfig = {
    logCommands: environment.enableEventLogging,
    logEvents: environment.enableEventLogging,
    useConsoleTable: environment.development
  };

  private eventHistory: Array<{ type: string; payload: any; timestamp: number; category: string }> = [];
  private readonly MAX_HISTORY_SIZE = 50;

  // ================================
  // PUBLIC METHODS - EMIT
  // ================================

  /**
   * Emit a rotation changed event
   */
  emitRotationChanged(payload: Omit<RotationChangedPayload, 'timestamp'>): void {
    const fullPayload: RotationChangedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.ROTATION_CHANGED, fullPayload, false);
    this.rotationChangedSubject.next(fullPayload);
  }

  /**
   * Emit a position changed event
   */
  emitPositionChanged(payload: Omit<PositionChangedPayload, 'timestamp'>): void {
    const fullPayload: PositionChangedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.POSITION_CHANGED, fullPayload, false);
    this.positionChangedSubject.next(fullPayload);
  }

  /**
   * Emit a scene ready event
   */
  emitSceneReady(payload: Omit<SceneReadyPayload, 'timestamp'>): void {
    const fullPayload: SceneReadyPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.SCENE_READY, fullPayload, false);
    this.sceneReadySubject.next(fullPayload);
  }

  /**
   * Emit a mesh clicked event
   */
  emitMeshClicked(payload: Omit<MeshClickedPayload, 'timestamp'>): void {
    const fullPayload: MeshClickedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.MESH_CLICKED, fullPayload, false);
    this.meshClickedSubject.next(fullPayload);
  }

  /**
   * Emit a mesh visibility changed event
   */
  emitMeshVisibilityChanged(payload: Omit<MeshVisibilityChangedPayload, 'timestamp'>): void {
    const fullPayload: MeshVisibilityChangedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.MESH_VISIBILITY_CHANGED, fullPayload, false);
    this.meshVisibilityChangedSubject.next(fullPayload);
  }

  /**
   * Emit a model import requested event
   */
  emitModelImportRequested(payload: Omit<ModelImportRequestedPayload, 'timestamp'>): void {
    const fullPayload: ModelImportRequestedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.MODEL_IMPORT_REQUESTED, fullPayload, false);
    this.modelImportRequestedSubject.next(fullPayload);
  }

  /**
   * Emit a debug log event
   */
  emitDebugLog(
    level: 'info' | 'warning' | 'error' | 'debug',
    message: string,
    context?: string,
    data?: any
  ): void {
    const payload: DebugLogPayload = {
      level,
      message,
      context,
      data,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.DEBUG_LOG, payload, false);
    this.debugLogSubject.next(payload);
  }

  /**
   * Emit a sensor creation requested event
   */
  emitSensorCreationRequested(payload: Omit<SensorCreationRequestedPayload, 'timestamp'>): void {
    const fullPayload: SensorCreationRequestedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.SENSOR_CREATION_REQUESTED, fullPayload, false);
    this.sensorCreationRequestedSubject.next(fullPayload);
  }

  /**
   * Emit a sensor created event
   */
  emitSensorCreated(payload: Omit<SensorCreatedPayload, 'timestamp'>): void {
    const fullPayload: SensorCreatedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.SENSOR_CREATED, fullPayload, false);
    this.sensorCreatedSubject.next(fullPayload);
  }

  /**
   * Emit a sensor link requested event
   */
  emitSensorLinkRequested(payload: Omit<SensorLinkRequestedPayload, 'timestamp'>): void {
    const fullPayload: SensorLinkRequestedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.SENSOR_LINK_REQUESTED, fullPayload, false);
    this.sensorLinkRequestedSubject.next(fullPayload);
  }

  /**
   * Emit a sensor insertion mode changed event
   */
  emitSensorInsertionModeChanged(payload: Omit<SensorInsertionModeChangedPayload, 'timestamp'>): void {
    const fullPayload: SensorInsertionModeChangedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.SENSOR_INSERTION_MODE_CHANGED, fullPayload, false);
    this.sensorInsertionModeChangedSubject.next(fullPayload);
  }

  /**
   * Emit a sensor link mode changed event
   */
  emitSensorLinkModeChanged(payload: Omit<SensorLinkModeChangedPayload, 'timestamp'>): void {
    const fullPayload: SensorLinkModeChangedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.SENSOR_LINK_MODE_CHANGED, fullPayload, false);
    this.sensorLinkModeChangedSubject.next(fullPayload);
  }

  /**
   * Emit a sensor distance mode changed event
   */
  emitSensorDistanceModeChanged(payload: Omit<SensorDistanceModeChangedPayload, 'timestamp'>): void {
    const fullPayload: SensorDistanceModeChangedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.SENSOR_DISTANCE_MODE_CHANGED, fullPayload, false);
    this.sensorDistanceModeChangedSubject.next(fullPayload);
  }

  /**
   * Emit a sensor distance calculated event
   */
  emitSensorDistanceCalculated(payload: Omit<SensorDistanceCalculatedPayload, 'timestamp'>): void {
    const fullPayload: SensorDistanceCalculatedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.SENSOR_DISTANCE_CALCULATED, fullPayload, false);
    this.sensorDistanceCalculatedSubject.next(fullPayload);
  }

  /**
   * Emit a panel visibility changed event
   */
  emitPanelVisibilityChanged(payload: Omit<PanelVisibilityChangedPayload, 'timestamp'>): void {
    const fullPayload: PanelVisibilityChangedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.PANEL_VISIBILITY_CHANGED, fullPayload, false);
    this.panelVisibilityChangedSubject.next(fullPayload);
  }

  /**
   * Emit a heatmap visibility changed event
   */
  emitHeatmapVisibilityChanged(payload: Omit<HeatmapVisibilityChangedPayload, 'timestamp'>): void {
    const fullPayload: HeatmapVisibilityChangedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.HEATMAP_VISIBILITY_CHANGED, fullPayload, false);
    this.heatmapVisibilityChangedSubject.next(fullPayload);
  }

  /**
   * Emit a heatmap mode changed event
   */
  emitHeatmapModeChanged(payload: Omit<HeatmapModeChangedPayload, 'timestamp'>): void {
    const fullPayload: HeatmapModeChangedPayload = {
      ...payload,
      timestamp: Date.now()
    };
    this.addToHistory(EventType.HEATMAP_MODE_CHANGED, fullPayload, false);
    this.heatmapModeChangedSubject.next(fullPayload);
  }

  /**
   * Emit a command executed event
   */
  emitCommandExecuted(command: Command, result: CommandResult): void {
    const payload = { command, result };
    this.addToHistory('bus:commandExecuted', payload, true);
    this.commandExecutedSubject.next(payload);
  }

  /**
   * Emit an error event
   */
  emitError(error: Error, context: string): void {
    const payload = { error, context };
    this.addToHistory('bus:error', payload, false);
    this.errorSubject.next(payload);
  }

  /**
   * Generic emit method for compatibility with React code
   */
  emit(type: EventType | CommandType | string, payload: any): void {
    switch (type) {
      case EventType.ROTATION_CHANGED:
        this.rotationChangedSubject.next(payload.payload || payload);
        break;
      case EventType.POSITION_CHANGED:
        this.positionChangedSubject.next(payload.payload || payload);
        break;
      case EventType.SCENE_READY:
        this.sceneReadySubject.next(payload.payload || payload);
        break;
      case EventType.MESH_CLICKED:
        this.meshClickedSubject.next(payload.payload || payload);
        break;
      case EventType.MESH_VISIBILITY_CHANGED:
        this.meshVisibilityChangedSubject.next(payload.payload || payload);
        break;
      case EventType.MODEL_IMPORT_REQUESTED:
        this.modelImportRequestedSubject.next(payload.payload || payload);
        break;
      case EventType.DEBUG_LOG:
        this.debugLogSubject.next(payload.payload || payload);
        break;
      case EventType.SENSOR_CREATION_REQUESTED:
        this.sensorCreationRequestedSubject.next(payload.payload || payload);
        break;
      case EventType.SENSOR_CREATED:
        this.sensorCreatedSubject.next(payload.payload || payload);
        break;
      case EventType.SENSOR_LINK_REQUESTED:
        this.sensorLinkRequestedSubject.next(payload.payload || payload);
        break;
      case EventType.SENSOR_INSERTION_MODE_CHANGED:
        this.sensorInsertionModeChangedSubject.next(payload.payload || payload);
        break;
      case EventType.SENSOR_LINK_MODE_CHANGED:
        this.sensorLinkModeChangedSubject.next(payload.payload || payload);
        break;
      case EventType.SENSOR_DISTANCE_MODE_CHANGED:
        this.sensorDistanceModeChangedSubject.next(payload.payload || payload);
        break;
      case EventType.SENSOR_DISTANCE_CALCULATED:
        this.sensorDistanceCalculatedSubject.next(payload.payload || payload);
        break;
      case EventType.PANEL_VISIBILITY_CHANGED:
        this.panelVisibilityChangedSubject.next(payload.payload || payload);
        break;
      case EventType.HEATMAP_VISIBILITY_CHANGED:
        this.heatmapVisibilityChangedSubject.next(payload.payload || payload);
        break;
      case EventType.HEATMAP_MODE_CHANGED:
        this.heatmapModeChangedSubject.next(payload.payload || payload);
        break;
      case 'bus:commandExecuted':
        this.commandExecutedSubject.next(payload);
        break;
      case 'bus:error':
        this.errorSubject.next(payload);
        break;
      default:
        console.warn(`Unknown event type: ${type}`);
    }
  }

  // ================================
  // CONFIGURATION METHODS
  // ================================

  /**
   * Configure bus logging
   */
  setBusLogConfig(config: Partial<BusLogConfig>): void {
    this.logConfig = { ...this.logConfig, ...config };
  }

  /**
   * Get current bus log configuration
   */
  getBusLogConfig(): BusLogConfig {
    return { ...this.logConfig };
  }

  /**
   * Get event history
   */
  getEventHistory(): Array<{ type: string; payload: any; timestamp: number; category: string }> {
    return [...this.eventHistory];
  }

  /**
   * Clear event history
   */
  clearEventHistory(): void {
    this.eventHistory.length = 0;
  }

  // ================================
  // PRIVATE METHODS
  // ================================

  /**
   * Add event to history and handle logging
   */
  private addToHistory(type: string, payload: any, isCommand: boolean): void {
    const entry = {
      type,
      payload,
      timestamp: Date.now(),
      category: isCommand ? 'COMMAND' : 'EVENT'
    };

    this.eventHistory.push(entry);

    // Maintain max history size
    if (this.eventHistory.length > this.MAX_HISTORY_SIZE) {
      this.eventHistory.shift();
    }

    // Conditional logging
    const shouldLog = isCommand ? this.logConfig.logCommands : this.logConfig.logEvents;
    if (shouldLog) {
      if (this.logConfig.useConsoleTable) {
        console.table([entry]);
      } else {
        console.log(`[${entry.category}] ${type}:`, payload);
      }
    }
  }

  /**
   * Cleanup all subjects (call on app destroy if needed)
   */
  destroy(): void {
    this.rotationChangedSubject.complete();
    this.positionChangedSubject.complete();
    this.sceneReadySubject.complete();
    this.meshClickedSubject.complete();
    this.meshVisibilityChangedSubject.complete();
    this.modelImportRequestedSubject.complete();
    this.debugLogSubject.complete();
    this.sensorCreationRequestedSubject.complete();
    this.sensorCreatedSubject.complete();
    this.sensorLinkRequestedSubject.complete();
    this.sensorInsertionModeChangedSubject.complete();
    this.sensorLinkModeChangedSubject.complete();
    this.sensorDistanceModeChangedSubject.complete();
    this.sensorDistanceCalculatedSubject.complete();
    this.panelVisibilityChangedSubject.complete();
    this.heatmapVisibilityChangedSubject.complete();
    this.heatmapModeChangedSubject.complete();
    this.commandExecutedSubject.complete();
    this.errorSubject.complete();
  }
}

