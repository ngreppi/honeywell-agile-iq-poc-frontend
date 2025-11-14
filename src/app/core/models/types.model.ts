/**
 * @fileoverview Core type definitions for the 3D application
 *
 * Defines all base types used throughout the application following Angular best practices
 */

import type { Scene, Mesh, Vector3 } from '@babylonjs/core';

// ================================
// COMMAND SYSTEM TYPES
// ================================

/**
 * Available command types in the system
 */
export enum CommandType {
  TRANSLATE = 'translate',
  ROTATE = 'rotate',
  SCALE = 'scale'
}

/**
 * Common parameters for 3D transformations
 */
export interface Vector3Params {
  x: number;
  y: number;
  z: number;
}

/**
 * Payload for translate command
 */
export interface TranslatePayload extends Vector3Params {
  meshName?: string;
  relative?: boolean;
}

/**
 * Payload for rotate command
 */
export interface RotatePayload extends Vector3Params {
  meshName?: string;
  relative?: boolean;
}

/**
 * Payload for scale command
 */
export interface ScalePayload extends Vector3Params {
  meshName?: string;
  uniform?: boolean;
}

/**
 * Union type for all command payloads
 */
export type CommandPayload = TranslatePayload | RotatePayload | ScalePayload;

/**
 * Result of command execution
 */
export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
}

/**
 * Command handler function type
 */
export type CommandHandler<T extends CommandPayload = CommandPayload> = (
  scene: Scene,
  payload: T
) => Promise<CommandResult>;

// ================================
// EVENT SYSTEM TYPES
// ================================

/**
 * Available event types in the system
 */
export enum EventType {
  ROTATION_CHANGED = 'evt:rotationChanged',
  POSITION_CHANGED = 'evt:positionChanged',
  SCENE_READY = 'evt:sceneReady',
  MESH_CLICKED = 'evt:meshClicked',
  MESH_VISIBILITY_CHANGED = 'evt:meshVisibilityChanged',
  MODEL_IMPORT_REQUESTED = 'evt:modelImportRequested',
  DEBUG_LOG = 'evt:debugLog',
  SENSOR_CREATION_REQUESTED = 'evt:sensorCreationRequested',
  SENSOR_CREATED = 'evt:sensorCreated',
  SENSOR_LINK_REQUESTED = 'evt:sensorLinkRequested',
  SENSOR_INSERTION_MODE_CHANGED = 'evt:sensorInsertionModeChanged',
  SENSOR_LINK_MODE_CHANGED = 'evt:sensorLinkModeChanged',
  SENSOR_DISTANCE_MODE_CHANGED = 'evt:sensorDistanceModeChanged',
  SENSOR_DISTANCE_CALCULATED = 'evt:sensorDistanceCalculated',
  PANEL_VISIBILITY_CHANGED = 'evt:panelVisibilityChanged',
  HEATMAP_VISIBILITY_CHANGED = 'evt:heatmapVisibilityChanged',
  HEATMAP_MODE_CHANGED = 'evt:heatmapModeChanged'
}

/**
 * Base payload for all events
 */
export interface BaseEventPayload {
  timestamp: number;
  source?: string;
}

/**
 * Payload for rotation changed events
 */
export interface RotationChangedPayload extends BaseEventPayload {
  rotation: Vector3Params;
  meshName: string;
}

/**
 * Payload for position changed events
 */
export interface PositionChangedPayload extends BaseEventPayload {
  position: Vector3Params;
  meshName: string;
}

/**
 * Payload for scene ready events
 */
export interface SceneReadyPayload extends BaseEventPayload {
  meshCount: number;
  cameraType: string;
}

/**
 * Payload for mesh clicked events
 */
export interface MeshClickedPayload extends BaseEventPayload {
  meshName: string;
  position: Vector3;
  normal?: Vector3;
}

/**
 * Payload for mesh visibility changed events
 */
export interface MeshVisibilityChangedPayload extends BaseEventPayload {
  meshName: string;
  visible: boolean;
}

/**
 * Payload for model import requested events
 */
export interface ModelImportRequestedPayload extends BaseEventPayload {
  file: File;
}

/**
 * Log level types
 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * Payload for debug log events
 */
export interface DebugLogPayload extends BaseEventPayload {
  level: LogLevel;
  message: string;
  context?: string;
  data?: any;
}

// ================================
// SENSOR SYSTEM TYPES
// ================================

/**
 * Available sensor types
 */
export enum SensorType {
  PROXIMITY = 'proximity',
  MOTION = 'motion',
  TEMPERATURE = 'temperature',
  CAMERA = 'camera'
}

/**
 * Sensor configuration interface
 */
export interface SensorConfig {
  type: SensorType;
  shape: 'sphere' | 'cone' | 'cylinder' | 'frustum';
  color: string;
  range: number;
  angle?: number; // For cone and frustum
  height?: number; // For cylinder
  fov?: number; // For camera frustum
  aspect?: number; // For camera frustum
  visualization: 'transparent_sphere' | 'transparent_cone' | 'transparent_cylinder' | 'wireframe_frustum';
}

/**
 * Payload for sensor creation requested events
 */
export interface SensorCreationRequestedPayload extends BaseEventPayload {
  sensorType: SensorType;
  position: Vector3;
  meshName: string;
  normal?: Vector3;
}

/**
 * Sensor information interface
 */
export interface SensorInfo {
  id: string;
  type: SensorType;
  name: string;
  position: Vector3;
  meshName: string;
  normal?: Vector3;
  createdAt: number;
}

/**
 * Payload for sensor created events
 */
export interface SensorCreatedPayload extends BaseEventPayload {
  sensor: SensorInfo;
}

/**
 * Link type for sensors
 */
export enum SensorLinkType {
  PRIMARY = 'primary',
  SECONDARY = 'secondary'
}

/**
 * Sensor distance calculation mode type
 */
export enum SensorDistanceMode {
  DISTANCE_CALCULATION = 'distance_calculation'
}

/**
 * Payload for sensor link requested events
 */
export interface SensorLinkRequestedPayload extends BaseEventPayload {
  sensor1: SensorInfo;
  sensor2: SensorInfo;
  linkType?: SensorLinkType;
}

/**
 * Payload for sensor insertion mode changed events
 */
export interface SensorInsertionModeChangedPayload extends BaseEventPayload {
  isActive: boolean;
  sensorType: SensorType | null;
}

/**
 * Payload for sensor link mode changed events
 */
export interface SensorLinkModeChangedPayload extends BaseEventPayload {
  isActive: boolean;
  linkType: SensorLinkType | null;
}

/**
 * Payload for sensor distance calculation mode changed events
 */
export interface SensorDistanceModeChangedPayload extends BaseEventPayload {
  isActive: boolean;
}

/**
 * Payload for sensor distance calculated events
 */
export interface SensorDistanceCalculatedPayload extends BaseEventPayload {
  sensor1: SensorInfo;
  sensor2: SensorInfo;
  distance: number;
  intersectedMeshes: string[];
}

/**
 * Payload for panel visibility changed events
 */
export interface PanelVisibilityChangedPayload extends BaseEventPayload {
  panelName: string;
  visible: boolean;
}

/**
 * Union type for all event payloads
 */
export type EventPayload =
  | RotationChangedPayload
  | PositionChangedPayload
  | SceneReadyPayload
  | MeshClickedPayload
  | MeshVisibilityChangedPayload
  | ModelImportRequestedPayload
  | DebugLogPayload
  | SensorCreationRequestedPayload
  | SensorCreatedPayload
  | SensorLinkRequestedPayload
  | SensorInsertionModeChangedPayload
  | SensorLinkModeChangedPayload
  | SensorDistanceModeChangedPayload
  | SensorDistanceCalculatedPayload
  | PanelVisibilityChangedPayload
  | HeatmapVisibilityChangedPayload
  | HeatmapModeChangedPayload;

// ================================
// CONFIGURATION TYPES
// ================================

/**
 * Configuration for the BabylonJS engine
 */
export interface EngineConfig {
  antialias: boolean;
  adaptToDeviceRatio: boolean;
  generateMipMaps?: boolean;
  enableOfflineSupport?: boolean;
}

/**
 * Configuration for logging system
 */
export interface LoggerConfig {
  enabled: boolean;
  minLevel: LogLevel;
  includeStack: boolean;
  maxDataDepth: number;
  timestampFormat: 'iso' | 'relative' | 'time';
}

/**
 * Configuration for event bus logging
 */
export interface BusLogConfig {
  logCommands: boolean;
  logEvents: boolean;
  useConsoleTable: boolean;
}

// ================================
// APPLICATION STATE TYPES
// ================================

/**
 * Application state interface
 */
export interface AppState {
  sceneReady: boolean;
  currentMesh?: Mesh;
  eventHistory: EventPayload[];
}

// ================================
// HEATMAP TYPES
// ================================

/**
 * Heatmap mode types
 */
export type HeatmapMode = 'signal' | 'battery';

/**
 * Color stop for heatmap gradient
 */
export interface ColorStop {
  value: number; // 0-1
  color: string; // hex color
}

/**
 * Heatmap configuration
 */
export interface HeatmapConfig {
  mode: HeatmapMode;
  visible: boolean;
  colorStops?: ColorStop[];
  defaultRadius?: number;
  textureSize?: number;
}

/**
 * Payload for heatmap visibility changed events
 */
export interface HeatmapVisibilityChangedPayload extends BaseEventPayload {
  visible: boolean;
}

/**
 * Payload for heatmap mode changed events
 */
export interface HeatmapModeChangedPayload extends BaseEventPayload {
  mode: HeatmapMode;
}

