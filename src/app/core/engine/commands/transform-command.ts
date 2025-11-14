/**
 * @fileoverview Transform command handlers (translate, rotate, scale)
 *
 * Command handlers for 3D transformations on BabylonJS meshes
 */

import { Mesh, Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import {
  CommandHandler,
  TranslatePayload,
  RotatePayload,
  ScalePayload,
  CommandResult,
  EventType
} from '../../models/types.model';
import { EventBusService } from '../../services/event-bus.service';

// Utility functions
function getMeshByName(scene: Scene, meshName: string): Mesh | null {
  const mesh = scene.getMeshByName(meshName);
  return mesh as Mesh | null;
}

function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function radToDeg(radians: number): number {
  return radians * (180 / Math.PI);
}

function validateNumbers(...values: number[]): boolean {
  return values.every(v => typeof v === 'number' && isFinite(v));
}

// ================================
// TRANSLATE COMMAND
// ================================

export function createTranslateCommand(eventBus: EventBusService): CommandHandler<TranslatePayload> {
  return async (scene: Scene, payload: TranslatePayload): Promise<CommandResult> => {
    try {
      const { x, y, z, meshName = 'mainCube', relative = false } = payload;

      if (!validateNumbers(x, y, z)) {
        return {
          success: false,
          message: 'Invalid translation values: must be finite numbers',
          data: { payload }
        };
      }

      const mesh = getMeshByName(scene, meshName);
      if (!mesh) {
        return {
          success: false,
          message: `Mesh '${meshName}' not found in scene`,
          data: { availableMeshes: scene.meshes.map(m => m.name) }
        };
      }

      const oldPosition = mesh.position.clone();

      if (relative) {
        mesh.position.x += x;
        mesh.position.y += y;
        mesh.position.z += z;
      } else {
        mesh.position.x = x;
        mesh.position.y = y;
        mesh.position.z = z;
      }

      const newPosition = mesh.position.clone();

      // Emit position changed event
      eventBus.emitPositionChanged({
        position: {
          x: newPosition.x,
          y: newPosition.y,
          z: newPosition.z
        },
        meshName,
        source: 'translate_command'
      });

      console.log(`Mesh '${meshName}' translated:`, {
        from: { x: oldPosition.x, y: oldPosition.y, z: oldPosition.z },
        to: { x: newPosition.x, y: newPosition.y, z: newPosition.z },
        relative
      });

      return {
        success: true,
        message: `Mesh '${meshName}' translated successfully`,
        data: {
          meshName,
          oldPosition: { x: oldPosition.x, y: oldPosition.y, z: oldPosition.z },
          newPosition: { x: newPosition.x, y: newPosition.y, z: newPosition.z },
          relative
        }
      };

    } catch (error) {
      console.error('Error in translateCommand:', error);
      return {
        success: false,
        message: `Translation failed: ${(error as Error).message}`,
        data: { error: (error as Error).message, payload }
      };
    }
  };
}

// ================================
// ROTATE COMMAND
// ================================

export function createRotateCommand(eventBus: EventBusService): CommandHandler<RotatePayload> {
  return async (scene: Scene, payload: RotatePayload): Promise<CommandResult> => {
    try {
      const { x, y, z, meshName = 'mainCube', relative = false } = payload;

      if (!validateNumbers(x, y, z)) {
        return {
          success: false,
          message: 'Invalid rotation values: must be finite numbers',
          data: { payload }
        };
      }

      const mesh = getMeshByName(scene, meshName);
      if (!mesh) {
        return {
          success: false,
          message: `Mesh '${meshName}' not found in scene`,
          data: { availableMeshes: scene.meshes.map(m => m.name) }
        };
      }

      const oldRotation = mesh.rotation.clone();

      const xRad = degToRad(x);
      const yRad = degToRad(y);
      const zRad = degToRad(z);

      if (relative) {
        mesh.rotation.x += xRad;
        mesh.rotation.y += yRad;
        mesh.rotation.z += zRad;
      } else {
        mesh.rotation.x = xRad;
        mesh.rotation.y = yRad;
        mesh.rotation.z = zRad;
      }

      const newRotation = mesh.rotation.clone();

      // Emit rotation changed event
      eventBus.emitRotationChanged({
        rotation: {
          x: newRotation.x,
          y: newRotation.y,
          z: newRotation.z
        },
        meshName,
        source: 'rotate_command'
      });

      console.log(`Mesh '${meshName}' rotated:`, {
        from: {
          x: radToDeg(oldRotation.x),
          y: radToDeg(oldRotation.y),
          z: radToDeg(oldRotation.z)
        },
        to: {
          x: radToDeg(newRotation.x),
          y: radToDeg(newRotation.y),
          z: radToDeg(newRotation.z)
        },
        relative
      });

      return {
        success: true,
        message: `Mesh '${meshName}' rotated successfully`,
        data: {
          meshName,
          oldRotation: {
            x: radToDeg(oldRotation.x),
            y: radToDeg(oldRotation.y),
            z: radToDeg(oldRotation.z)
          },
          newRotation: {
            x: radToDeg(newRotation.x),
            y: radToDeg(newRotation.y),
            z: radToDeg(newRotation.z)
          },
          relative
        }
      };

    } catch (error) {
      console.error('Error in rotateCommand:', error);
      return {
        success: false,
        message: `Rotation failed: ${(error as Error).message}`,
        data: { error: (error as Error).message, payload }
      };
    }
  };
}

// ================================
// SCALE COMMAND
// ================================

export function createScaleCommand(eventBus: EventBusService): CommandHandler<ScalePayload> {
  return async (scene: Scene, payload: ScalePayload): Promise<CommandResult> => {
    try {
      const { x, y, z, meshName = 'mainCube', uniform = false } = payload;

      if (!validateNumbers(x, y, z)) {
        return {
          success: false,
          message: 'Invalid scale values: must be finite numbers',
          data: { payload }
        };
      }

      const scaleX = uniform ? x : x;
      const scaleY = uniform ? x : y;
      const scaleZ = uniform ? x : z;

      if (scaleX <= 0 || scaleY <= 0 || scaleZ <= 0) {
        return {
          success: false,
          message: 'Scale values must be positive numbers',
          data: { payload }
        };
      }

      const mesh = getMeshByName(scene, meshName);
      if (!mesh) {
        return {
          success: false,
          message: `Mesh '${meshName}' not found in scene`,
          data: { availableMeshes: scene.meshes.map(m => m.name) }
        };
      }

      const oldScaling = mesh.scaling.clone();

      mesh.scaling.x = scaleX;
      mesh.scaling.y = scaleY;
      mesh.scaling.z = scaleZ;

      const newScaling = mesh.scaling.clone();

      console.log(`Mesh '${meshName}' scaled:`, {
        from: { x: oldScaling.x, y: oldScaling.y, z: oldScaling.z },
        to: { x: newScaling.x, y: newScaling.y, z: newScaling.z },
        uniform
      });

      return {
        success: true,
        message: `Mesh '${meshName}' scaled successfully`,
        data: {
          meshName,
          oldScaling: { x: oldScaling.x, y: oldScaling.y, z: oldScaling.z },
          newScaling: { x: newScaling.x, y: newScaling.y, z: newScaling.z },
          uniform
        }
      };

    } catch (error) {
      console.error('Error in scaleCommand:', error);
      return {
        success: false,
        message: `Scaling failed: ${(error as Error).message}`,
        data: { error: (error as Error).message, payload }
      };
    }
  };
}

