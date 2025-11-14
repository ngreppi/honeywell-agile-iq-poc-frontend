/**
 * @fileoverview Sensor configurations based on the sensor guide
 *
 * Defines the configurations for different sensor types following the guide specifications
 */

import { SensorType, SensorConfig } from './types.model';

/**
 * Predefined sensor configurations based on the guide
 */
export const SENSOR_CONFIGS: Record<SensorType, SensorConfig> = {
  [SensorType.PROXIMITY]: {
    type: SensorType.PROXIMITY,
    shape: 'sphere',
    color: '#00FF00', // Verde
    range: 5.0,
    visualization: 'transparent_sphere'
  },

  [SensorType.MOTION]: {
    type: SensorType.MOTION,
    shape: 'cone',
    color: '#FF6600', // Arancione
    range: 7.0,
    angle: Math.PI / 3, // 60 gradi
    visualization: 'transparent_cone'
  },

  [SensorType.TEMPERATURE]: {
    type: SensorType.TEMPERATURE,
    shape: 'cylinder',
    color: '#FF0000', // Rosso
    range: 3.0,
    height: 2.0,
    visualization: 'transparent_cylinder'
  },

  [SensorType.CAMERA]: {
    type: SensorType.CAMERA,
    shape: 'frustum',
    color: '#0066FF', // Blu
    range: 15.0,
    fov: Math.PI / 4, // 45 gradi
    aspect: 1.0,
    visualization: 'wireframe_frustum'
  }
};

/**
 * Helper function to get sensor configuration by type
 */
export function getSensorConfig(type: SensorType): SensorConfig {
  return SENSOR_CONFIGS[type];
}

/**
 * Helper function to get all available sensor types
 */
export function getAvailableSensorTypes(): SensorType[] {
  return Object.values(SensorType);
}

/**
 * Helper function to get sensor display name
 */
export function getSensorDisplayName(type: SensorType): string {
  const displayNames: Record<SensorType, string> = {
    [SensorType.PROXIMITY]: 'Proximity Sensor',
    [SensorType.MOTION]: 'Motion Sensor',
    [SensorType.TEMPERATURE]: 'Temperature Sensor',
    [SensorType.CAMERA]: 'Camera Sensor'
  };
  return displayNames[type];
}
