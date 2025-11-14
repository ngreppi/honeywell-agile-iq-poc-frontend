import { Injectable, inject } from '@angular/core';
import {
  Scene,
  Vector3,
  AbstractMesh,
  DynamicTexture,
  StandardMaterial,
  Color3,
  Material,
  VertexBuffer,
} from '@babylonjs/core';
import { EventBusService } from './event-bus.service';
import { LoggerService } from './logger.service';
import {
  HeatmapConfig,
  HeatmapMode,
  ColorStop,
  SensorCreatedPayload,
  SensorLinkRequestedPayload,
} from '../models/types.model';

// ============================================================================
// TYPES
// ============================================================================

interface Sensor {
  id: string;
  position: Vector3; // Posizione fisica del sensore (sopra la mesh)
  surfaceAnchor?: Vector3; // Punto di ancoraggio sulla superficie (per heatmap)
  intensity: number;
  radius: number;
  enabled: boolean;
  attachedMesh?: AbstractMesh;
  attachedMeshId?: string;
  normal?: Vector3;
}

interface Link {
  id: string;
  sensorA: string;
  sensorB: string;
  weight: number;
}

interface AttenuationPoint {
  id: string;
  position: Vector3;
  factor: number;
  radius: number;
}

type CombineMode = 'add' | 'max' | 'overlay';

interface HeatmapContext {
  sensors: Sensor[];
  links: Link[];
  attenuators: AttenuationPoint[];
  config: Required<HeatmapConfig>;
  textureSize: number;
}

// ============================================================================
// HEATMAP STRATEGIES
// ============================================================================

interface HeatmapStrategy {
  readonly name: string;
  computeInfluence(sensor: Sensor, point: Vector3, context: HeatmapContext): number;
  combineInfluences(values: number[], combineMode: CombineMode): number;
  update(context: HeatmapContext): void;
}

abstract class BaseHeatmapStrategy implements HeatmapStrategy {
  abstract readonly name: string;
  abstract computeInfluence(sensor: Sensor, point: Vector3, context: HeatmapContext): number;
  abstract update(context: HeatmapContext): void;

  combineInfluences(values: number[], combineMode: CombineMode): number {
    if (values.length === 0) return 0;

    switch (combineMode) {
      case 'add':
        return Math.min(1, values.reduce((sum, v) => sum + v, 0));
      case 'max':
        return Math.max(...values);
      case 'overlay':
        return 1 - values.reduce((acc, v) => acc * (1 - v), 1);
      default:
        return Math.max(...values);
    }
  }
}

class SignalStrategy extends BaseHeatmapStrategy {
  readonly name = 'signal';

  computeInfluence(sensor: Sensor, point: Vector3, context: HeatmapContext): number {
    if (!sensor.enabled || sensor.intensity === 0) {
      return 0;
    }

    // Usa surfaceAnchor se disponibile, altrimenti position
    const sensorPos = sensor.surfaceAnchor || sensor.position;
    const distance = Vector3.Distance(sensorPos, point);
    let influence = Math.max(0, 1 - distance / sensor.radius) * sensor.intensity;

    // Links influence
    if (context.links.length > 0) {
      let linkInfluence = 0;

      for (const link of context.links) {
        if (link.sensorA === sensor.id || link.sensorB === sensor.id) {
          const otherSensorId = link.sensorA === sensor.id ? link.sensorB : link.sensorA;
          const otherSensor = context.sensors.find((s) => s.id === otherSensorId);

          if (otherSensor && otherSensor.enabled && otherSensor.intensity > 0) {
            const otherPos = otherSensor.surfaceAnchor || otherSensor.position;
            const distFromSegment = this.pointToSegmentDistance(
              point,
              sensorPos,
              otherPos
            );
            const maxLinkRadius = Math.max(sensor.radius, otherSensor.radius) * 0.5;
            if (distFromSegment < maxLinkRadius) {
              const linkFactor = Math.max(0, 1 - distFromSegment / maxLinkRadius);
              const avgIntensity = (sensor.intensity + otherSensor.intensity) * 0.5;
              linkInfluence = Math.max(linkInfluence, linkFactor * avgIntensity * link.weight);
            }
          }
        }
      }

      influence = Math.max(influence, linkInfluence);
    }

    // Attenuators
    for (const att of context.attenuators) {
      const distToAtt = Vector3.Distance(att.position, point);
      if (distToAtt < att.radius) {
        const attenuationAmount = 1 - (1 - att.factor) * (1 - distToAtt / att.radius);
        influence *= attenuationAmount;
      }
    }

    return influence;
  }

  private pointToSegmentDistance(
    point: Vector3,
    segmentStart: Vector3,
    segmentEnd: Vector3
  ): number {
    const segmentVector = segmentEnd.subtract(segmentStart);
    const pointVector = point.subtract(segmentStart);
    const segmentLength = segmentVector.length();
    if (segmentLength === 0) return pointVector.length();

    const t = Math.max(
      0,
      Math.min(1, Vector3.Dot(pointVector, segmentVector) / (segmentLength * segmentLength))
    );
    const projection = segmentStart.add(segmentVector.scale(t));
    return Vector3.Distance(point, projection);
  }

  update(context: HeatmapContext): void {
    // No processing needed for signal
  }
}

class BatteryStrategy extends BaseHeatmapStrategy {
  readonly name = 'battery';
  private effectiveIntensityCache: Map<string, number> = new Map();

  computeInfluence(sensor: Sensor, point: Vector3, context: HeatmapContext): number {
    if (!sensor.enabled) return 0;

    const distance = Vector3.Distance(sensor.position, point);
    if (distance > sensor.radius) return 0;

    const distanceFactor = 1 - Math.pow(distance / sensor.radius, 2);
    const effective = this.effectiveIntensityCache.get(sensor.id) ?? sensor.intensity;
    return effective * distanceFactor;
  }

  update(context: HeatmapContext): void {
    this.effectiveIntensityCache.clear();

    const maxIterations = 5;
    const currentValues = new Map<string, number>();

    for (const s of context.sensors) {
      const base = s.enabled ? s.intensity : 0;
      currentValues.set(s.id, base);
      this.effectiveIntensityCache.set(s.id, base);
    }

    if (context.links.length === 0) return;

    for (let iter = 0; iter < maxIterations; iter++) {
      let maxChange = 0;
      const newValues = new Map<string, number>();

      for (const s of context.sensors) {
        if (!s.enabled) {
          newValues.set(s.id, 0);
          continue;
        }

        const neighbors: string[] = [];
        for (const link of context.links) {
          if (link.sensorA === s.id) neighbors.push(link.sensorB);
          else if (link.sensorB === s.id) neighbors.push(link.sensorA);
        }

        let sum = s.intensity;
        let count = 1;

        for (const nId of neighbors) {
          const neighbor = context.sensors.find((x) => x.id === nId);
          if (neighbor && neighbor.enabled) {
            const nv = currentValues.get(nId) ?? 0;
            sum += nv;
            count++;
          }
        }

        const newVal = sum / count;
        const oldVal = currentValues.get(s.id) ?? 0;
        maxChange = Math.max(maxChange, Math.abs(newVal - oldVal));
        newValues.set(s.id, newVal);
      }

      for (const [id, v] of newValues.entries()) {
        currentValues.set(id, v);
        this.effectiveIntensityCache.set(id, v);
      }

      if (maxChange < 0.001) break;
    }
  }
}

// ============================================================================
// SHADER MANAGER
// ============================================================================

class ShaderManager {
  private dynamicTexture: DynamicTexture;
  private context: CanvasRenderingContext2D;
  private material: StandardMaterial;

  constructor(private scene: Scene, private textureSize: number, private colorStops: ColorStop[]) {
    console.log('[ShaderManager] Creating instance:', { textureSize, colorStops });

    this.dynamicTexture = new DynamicTexture(
      `heatmapTexture_${Date.now()}`,
      { width: textureSize, height: textureSize },
      scene,
      false,
      DynamicTexture.TRILINEAR_SAMPLINGMODE
    );

    this.context = this.dynamicTexture.getContext() as CanvasRenderingContext2D;

    this.material = new StandardMaterial(`heatmapMaterial_${Date.now()}`, scene);
    this.material.diffuseTexture = this.dynamicTexture;
    this.material.emissiveTexture = this.dynamicTexture;
    this.material.specularColor = new Color3(0, 0, 0);
    this.material.backFaceCulling = false;
    this.material.disableLighting = false;
    this.material.alpha = 0.7;
    this.material.alphaMode = 2;

    console.log('[ShaderManager] Material created');
  }

  updateTexture(data: number[][]): void {
    const size = this.textureSize;
    const imageData = this.context.createImageData(size, size);

    let maxValue = 0;
    let minValue = 1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        maxValue = Math.max(maxValue, data[y][x]);
        minValue = Math.min(minValue, data[y][x]);
      }
    }

    console.log('[ShaderManager] Texture data range:', { minValue, maxValue });

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const value = Math.max(0, Math.min(1, data[y][x]));
        const color = this.valueToColor(value);
        const idx = (y * size + x) * 4;

        imageData.data[idx] = color.r;
        imageData.data[idx + 1] = color.g;
        imageData.data[idx + 2] = color.b;
        imageData.data[idx + 3] = 255;
      }
    }

    this.context.putImageData(imageData, 0, 0);
    this.dynamicTexture.update(false);
  }

  private valueToColor(value: number): { r: number; g: number; b: number } {
    let lowerStop = this.colorStops[0];
    let upperStop = this.colorStops[this.colorStops.length - 1];

    for (let i = 0; i < this.colorStops.length - 1; i++) {
      if (value >= this.colorStops[i].value && value <= this.colorStops[i + 1].value) {
        lowerStop = this.colorStops[i];
        upperStop = this.colorStops[i + 1];
        break;
      }
    }

    const denom = upperStop.value - lowerStop.value || 1;
    const t = (value - lowerStop.value) / denom;
    const lowerColor = this.hexToRgb(lowerStop.color);
    const upperColor = this.hexToRgb(upperStop.color);

    return {
      r: Math.round(lowerColor.r + (upperColor.r - lowerColor.r) * t),
      g: Math.round(lowerColor.g + (upperColor.g - lowerColor.g) * t),
      b: Math.round(lowerColor.b + (upperColor.b - lowerColor.b) * t),
    };
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  }

  getMaterial(): StandardMaterial {
    return this.material;
  }

  dispose(): void {
    console.log('[ShaderManager] Disposing');
    this.dynamicTexture.dispose();
    this.material.dispose();
  }
}

// ============================================================================
// HEATMAP SERVICE
// ============================================================================

@Injectable({
  providedIn: 'root',
})
export class HeatmapService {
  private eventBus = inject(EventBusService);
  private logger = inject(LoggerService);

  private scene: Scene | null = null;
  private sensors: Map<string, Sensor> = new Map();
  private links: Map<string, Link> = new Map();
  private attenuators: Map<string, AttenuationPoint> = new Map();

  private targetMeshes: Map<
    string,
    {
      mesh: AbstractMesh;
      shaderManager: ShaderManager;
      originalMaterial: Material | null;
    }
  > = new Map();

  private signalStrategy: HeatmapStrategy = new SignalStrategy();
  private batteryStrategy: HeatmapStrategy = new BatteryStrategy();

  private config: Required<HeatmapConfig> = {
    mode: 'signal',
    visible: false,
    colorStops: [
      { value: 0, color: '#ff0000' },
      { value: 0.5, color: '#ffff00' },
      { value: 1, color: '#00ff00' },
    ],
    defaultRadius: 20, // Aumentato da 2.5 a 20 per coprire la distanza sensore-mesh
    textureSize: 256,
  };

  private isDirty = false;
  private lastRenderTime = 0;
  private renderThrottle = 16;

  constructor() {
    this.subscribeToEvents();
  }

  initialize(scene: Scene): void {
    this.scene = scene;
    this.logger.info('HeatmapService initialized');
  }

  dispose(): void {
    this.targetMeshes.forEach(({ mesh, shaderManager, originalMaterial }) => {
      if (mesh && !mesh.isDisposed()) {
        mesh.material = originalMaterial;
      }
      shaderManager.dispose();
    });
    this.targetMeshes.clear();
    this.sensors.clear();
    this.links.clear();
    this.attenuators.clear();
    this.scene = null;
  }

  getSensor(id: string): Sensor | undefined {
    return this.sensors.get(id);
  }

  /**
   * Estrae l'ID della mesh dal nome del sensore
   * Formato: "sensorType_meshId_timestamp"
   * Esempio: "camera_0oUCPx3t1CihT4CbXTV0NN_1763135117966"
   */
  private extractMeshIdFromSensorName(sensorName: string): string | null {
    const parts = sensorName.split('_');
    if (parts.length >= 3) {
      // Ritorna la seconda parte (mesh ID)
      return parts[1];
    }
    return null;
  }

  addSensor(
    id: string,
    position: Vector3,
    options?: {
      intensity?: number;
      radius?: number;
      attachedMesh?: AbstractMesh;
      normal?: Vector3;
    }
  ): void {
    // Estrai mesh ID dal nome del sensore
    const attachedMeshId = this.extractMeshIdFromSensorName(id);
    
    // Calcola il punto di ancoraggio sulla superficie
    // Il sensore è posizionato sopra la mesh, proiettiamolo sulla superficie
    const normal = options?.normal?.clone() ?? new Vector3(0, -1, 0);
    const surfaceAnchor = position.clone().add(normal.scale(-0.5)); // Proietta 0.5 unità lungo la normale

    const sensor: Sensor = {
      id,
      position: position.clone(),
      surfaceAnchor: surfaceAnchor,
      intensity: options?.intensity ?? 1,
      radius: options?.radius ?? this.config.defaultRadius,
      enabled: true,
      attachedMesh: options?.attachedMesh,
      attachedMeshId: attachedMeshId || undefined,
      normal: normal,
    };

    this.sensors.set(id, sensor);
    
    console.log('[HeatmapService] Sensor added:', {
      id,
      attachedMeshId,
      intensity: sensor.intensity,
      radius: sensor.radius,
      position: { 
        x: position.x.toFixed(2), 
        y: position.y.toFixed(2), 
        z: position.z.toFixed(2) 
      },
      surfaceAnchor: {
        x: surfaceAnchor.x.toFixed(2),
        y: surfaceAnchor.y.toFixed(2),
        z: surfaceAnchor.z.toFixed(2)
      },
      normal: sensor.normal ? {
        x: sensor.normal.x.toFixed(2),
        y: sensor.normal.y.toFixed(2),
        z: sensor.normal.z.toFixed(2)
      } : null
    });

    this.isDirty = true;
    this.updateStrategyImmediate();
  }

  removeSensor(id: string): void {
    this.sensors.delete(id);

    const linksToRemove: string[] = [];
    this.links.forEach((link, linkId) => {
      if (link.sensorA === id || link.sensorB === id) {
        linksToRemove.push(linkId);
      }
    });
    linksToRemove.forEach((linkId) => this.links.delete(linkId));

    this.isDirty = true;
    this.updateStrategyImmediate();
  }

  updateSensor(id: string, patch: Partial<Sensor>): void {
    const sensor = this.sensors.get(id);
    if (!sensor) {
      console.warn('[HeatmapService] Sensor not found for update:', id);
      return;
    }

    if (patch.position) {
      sensor.position.copyFrom(patch.position);
    }
    
    // Applica tutte le altre modifiche
    Object.assign(sensor, patch);

    console.log('[HeatmapService] Sensor updated:', {
      id,
      newIntensity: sensor.intensity,
      enabled: sensor.enabled
    });

    this.isDirty = true;

    if (patch.intensity !== undefined || patch.enabled !== undefined) {
      this.updateStrategyImmediate();
    }
  }

  addLink(sensorAId: string, sensorBId: string, weight: number = 1): void {
    const id = `${sensorAId}-${sensorBId}`;
    const link: Link = { id, sensorA: sensorAId, sensorB: sensorBId, weight };
    this.links.set(id, link);
    this.isDirty = true;
    this.updateStrategyImmediate();
  }

  clearLinks(): void {
    this.links.clear();
    this.isDirty = true;
    this.updateStrategyImmediate();
  }

  setConfig(config: Partial<HeatmapConfig>): void {
    const oldVisible = this.config.visible;
    const oldMode = this.config.mode;

    Object.assign(this.config, config);

    console.log('[HeatmapService] Config changed:', {
      visible: this.config.visible,
      mode: this.config.mode,
      oldVisible,
      oldMode
    });

    if (config.visible !== undefined && config.visible !== oldVisible) {
      this.logger.info(`Heatmap visibility changed to: ${config.visible}`);

      if (config.visible) {
        // Mostra heatmap
        this.updateTargetMeshes();
        this.isDirty = true;
        this.updateStrategyImmediate();
      } else {
        // Nascondi heatmap - ripristina materiali originali
        this.targetMeshes.forEach(({ mesh, originalMaterial }) => {
          if (mesh && !mesh.isDisposed()) {
            mesh.material = originalMaterial;
          }
        });
      }
    }

    if (config.colorStops || config.textureSize) {
      this.logger.info('Heatmap textures need recreation');
      
      // Ricrea tutte le texture con nuovi parametri
      this.targetMeshes.forEach(({ mesh, shaderManager, originalMaterial }) => {
        if (mesh && !mesh.isDisposed()) {
          mesh.material = originalMaterial;
        }
        shaderManager.dispose();
      });
      this.targetMeshes.clear();
      this.isDirty = true;
    }

    if (config.mode !== undefined && config.mode !== oldMode) {
      this.logger.info(`Heatmap mode changed to: ${config.mode}`);
      this.updateStrategyImmediate();
    }
  }

  render(): void {
    if (!this.scene || !this.config.visible) return;

    const now = performance.now();
    if (!this.isDirty && now - this.lastRenderTime < this.renderThrottle) return;

    this.lastRenderTime = now;
    this.isDirty = false;

    this.updateTargetMeshes();

    this.targetMeshes.forEach(({ mesh, shaderManager }) => {
      const context: HeatmapContext = {
        sensors: Array.from(this.sensors.values()),
        links: Array.from(this.links.values()),
        attenuators: Array.from(this.attenuators.values()),
        config: this.config,
        textureSize: this.config.textureSize,
      };

      const heatmapData = this.computeHeatmap(mesh, context);
      shaderManager.updateTexture(heatmapData);
    });
  }

  private updateTargetMeshes(): void {
    if (!this.scene) return;

    const currentTargetIds = new Set<string>();

    for (const sensor of this.sensors.values()) {
      if (!sensor.enabled) continue;

      // METODO SEMPLIFICATO: usa attachedMeshId invece di raycast
      const meshId = sensor.attachedMeshId;
      
      if (!meshId) {
        console.warn('[HeatmapService] Sensor has no attached mesh ID:', sensor.id);
        continue;
      }

      // Trova la mesh nella scena usando l'ID estratto
      const targetMesh = this.scene.getMeshById(meshId) as AbstractMesh;
      
      if (!targetMesh) {
        console.warn('[HeatmapService] Mesh not found in scene:', meshId);
        continue;
      }

      currentTargetIds.add(meshId);

      if (!this.targetMeshes.has(meshId)) {
        console.log('[HeatmapService] Adding target mesh:', {
          meshId,
          meshName: targetMesh.name,
          sensorId: sensor.id
        });

        // Verifica e genera UV se necessario
        let hasUVs = targetMesh.getVerticesData(VertexBuffer.UVKind) !== null;
        if (!hasUVs) {
          console.warn('[HeatmapService] Generating planar UVs for mesh:', meshId);
          this.generatePlanarUVs(targetMesh);
        }

        const shaderManager = new ShaderManager(
          this.scene,
          this.config.textureSize,
          this.config.colorStops
        );

        const originalMaterial = targetMesh.material;

        if (this.config.visible) {
          targetMesh.material = shaderManager.getMaterial();
          console.log('[HeatmapService] Material applied to mesh:', meshId);
        }

        this.targetMeshes.set(meshId, {
          mesh: targetMesh,
          shaderManager,
          originalMaterial,
        });

        this.isDirty = true;
      }
    }

    // Rimuovi mesh non più targetizzate
    for (const [meshId, { mesh, shaderManager, originalMaterial }] of this.targetMeshes) {
      if (!currentTargetIds.has(meshId)) {
        console.log('[HeatmapService] Removing target mesh:', meshId);

        if (mesh && !mesh.isDisposed()) {
          mesh.material = originalMaterial;
        }
        shaderManager.dispose();
        this.targetMeshes.delete(meshId);
      }
    }
  }

  private generatePlanarUVs(mesh: AbstractMesh): void {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;

    const bounds = mesh.getBoundingInfo().boundingBox;
    const width = bounds.maximum.x - bounds.minimum.x;
    const height = bounds.maximum.y - bounds.minimum.y;
    const depth = bounds.maximum.z - bounds.minimum.z;

    const dimensions = [
      { name: 'x', size: width, min: bounds.minimum.x, max: bounds.maximum.x, idx: 0 },
      { name: 'y', size: height, min: bounds.minimum.y, max: bounds.maximum.y, idx: 1 },
      { name: 'z', size: depth, min: bounds.minimum.z, max: bounds.maximum.z, idx: 2 },
    ].sort((a, b) => b.size - a.size);

    const dim1 = dimensions[0];
    const dim2 = dimensions[1];

    const uvs: number[] = [];

    for (let i = 0; i < positions.length; i += 3) {
      const coord1 = positions[i + dim1.idx];
      const coord2 = positions[i + dim2.idx];

      const u = (coord1 - dim1.min) / (dim1.size || 1);
      const v = (coord2 - dim2.min) / (dim2.size || 1);

      uvs.push(u, v);
    }

    mesh.setVerticesData(VertexBuffer.UVKind, uvs);
    console.log('[HeatmapService] UV generated:', {
      meshName: mesh.name,
      uvCount: uvs.length / 2
    });
  }

  private computeHeatmap(targetMesh: AbstractMesh, context: HeatmapContext): number[][] {
    const size = this.config.textureSize;
    const data: number[][] = [];
    const bounds = targetMesh.getBoundingInfo().boundingBox;

    // Filtra solo i sensori attivi sulla mesh corrente
    const relevantSensors = context.sensors.filter(
      (s) => s.enabled && s.attachedMeshId === targetMesh.id
    );

    if (relevantSensors.length === 0) {
      console.warn('[HeatmapService] No active sensors on mesh:', targetMesh.id);
      // Restituisci una heatmap vuota (tutta rossa)
      for (let y = 0; y < size; y++) {
        data.push(new Array(size).fill(0));
      }
      return data;
    }

    console.log('[HeatmapService] Computing heatmap:', {
      meshId: targetMesh.id,
      textureSize: size,
      sensorsCount: relevantSensors.length,
      avgIntensity: relevantSensors.reduce((sum, s) => sum + s.intensity, 0) / relevantSensors.length,
      sensorPositions: relevantSensors.map(s => ({ 
        id: s.id, 
        pos: { x: s.position.x.toFixed(2), y: s.position.y.toFixed(2), z: s.position.z.toFixed(2) },
        radius: s.radius,
        intensity: s.intensity
      }))
    });

    let maxInfluence = 0;
    let totalNonZero = 0;
    let minDistance = Infinity;
    let maxDistance = 0;

    // Usa le dimensioni della bounding box per calcolare i punti sulla mesh
    const minX = bounds.minimum.x;
    const maxX = bounds.maximum.x;
    const minY = bounds.minimum.y;
    const maxY = bounds.maximum.y;
    const minZ = bounds.minimum.z;
    const maxZ = bounds.maximum.z;

    // Determina le due dimensioni principali (le più grandi)
    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;

    const dimensions = [
      { name: 'x', size: width, min: minX, max: maxX },
      { name: 'y', size: height, min: minY, max: maxY },
      { name: 'z', size: depth, min: minZ, max: maxZ }
    ].sort((a, b) => b.size - a.size);

    const dim1 = dimensions[0]; // Dimensione più grande
    const dim2 = dimensions[1]; // Seconda dimensione più grande
    const dim3 = dimensions[2]; // Dimensione più piccola (usa il centro)

    console.log('[HeatmapService] Mesh dimensions:', {
      width: width.toFixed(2),
      height: height.toFixed(2),
      depth: depth.toFixed(2),
      primaryDim: dim1.name,
      secondaryDim: dim2.name,
      fixedDim: dim3.name
    });

    for (let y = 0; y < size; y++) {
      const row: number[] = [];
      for (let x = 0; x < size; x++) {
        const u = x / (size - 1);
        const v = y / (size - 1);

        // Calcola coordinate sulla superficie della mesh
        const coord1 = dim1.min + u * dim1.size;
        const coord2 = dim2.min + v * dim2.size;
        const coord3 = (dim3.min + dim3.max) / 2; // Usa il centro per la dimensione più piccola

        // Crea il punto sulla superficie
        const point = new Vector3(
          dim1.name === 'x' ? coord1 : (dim2.name === 'x' ? coord2 : coord3),
          dim1.name === 'y' ? coord1 : (dim2.name === 'y' ? coord2 : coord3),
          dim1.name === 'z' ? coord1 : (dim2.name === 'z' ? coord2 : coord3)
        );

        const influences: number[] = [];
        for (const sensor of relevantSensors) {
          const distance = Vector3.Distance(sensor.position, point);
          
          // Traccia distanze per debug
          if (distance < minDistance) minDistance = distance;
          if (distance > maxDistance) maxDistance = distance;

          const influence = this.getStrategy().computeInfluence(sensor, point, context);
          if (influence > 0) {
            influences.push(influence);
            totalNonZero++;
          }
        }

        const finalValue =
          influences.length > 0
            ? this.getStrategy().combineInfluences(influences, 'max')
            : 0;

        if (finalValue > maxInfluence) maxInfluence = finalValue;

        row.push(finalValue);
      }
      data.push(row);
    }

    console.log('[HeatmapService] Heatmap stats:', {
      maxInfluence: maxInfluence.toFixed(4),
      totalNonZero,
      totalPixels: size * size,
      coverage: ((totalNonZero / (size * size)) * 100).toFixed(2) + '%',
      minDistance: minDistance.toFixed(2),
      maxDistance: maxDistance.toFixed(2),
      sensorRadius: relevantSensors[0]?.radius.toFixed(2)
    });

    return data;
  }

  private getStrategy(): HeatmapStrategy {
    return this.config.mode === 'signal' ? this.signalStrategy : this.batteryStrategy;
  }

  private updateStrategyImmediate(): void {
    if (!this.config.visible) return;

    const context: HeatmapContext = {
      sensors: Array.from(this.sensors.values()),
      links: Array.from(this.links.values()),
      attenuators: Array.from(this.attenuators.values()),
      config: this.config,
      textureSize: this.config.textureSize,
    };

    this.getStrategy().update(context);
    this.isDirty = true;
  }

  private subscribeToEvents(): void {
    this.eventBus.heatmapVisibilityChanged$.subscribe((payload) => {
      console.log('[HeatmapService] Visibility change event:', payload.visible);
      this.setConfig({ visible: payload.visible });
    });

    this.eventBus.heatmapModeChanged$.subscribe((payload) => {
      console.log('[HeatmapService] Mode change event:', payload.mode);
      this.setConfig({ mode: payload.mode });
    });

    this.eventBus.sensorCreated$.subscribe((payload) => {
      console.log('[HeatmapService] Sensor created event:', payload.sensor.id);
      this.addSensor(payload.sensor.id, payload.sensor.position, {
        normal: payload.sensor.normal,
        intensity: 1.0, // Intensità iniziale al 100%
      });
    });

    this.eventBus.sensorLinkRequested$.subscribe((payload) => {
      this.addLink(
        payload.sensor1.id,
        payload.sensor2.id,
        payload.linkType === 'primary' ? 1 : 0.5
      );
    });

    // AGGIUNTO: Ascolta gli eventi di posizione cambiata per aggiornare anche l'intensity
    this.eventBus.positionChanged$.subscribe((payload) => {
      // Verifica se è un sensore
      const sensor = this.sensors.get(payload.meshName);
      if (sensor) {
        console.log('[HeatmapService] Sensor position changed:', payload.meshName);
        this.updateSensor(payload.meshName, {
          position: new Vector3(payload.position.x, payload.position.y, payload.position.z)
        });
      }
    });
  }
}