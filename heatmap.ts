// ============================================================================
// TYPES
// ============================================================================

/**
 * Sensore generico
 */
interface Sensor {
  id: string;
  position: BABYLON.Vector3;
  intensity: number;      // 0-1 valore generico di intensità interpretato dalla strategy
  radius: number;
  enabled: boolean;
  attachedMesh?: BABYLON.AbstractMesh;
}

/**
 * Link tra due sensori (mesh network)
 */
interface Link {
  id: string;
  sensorA: string;
  sensorB: string;
  weight: number;
}

/**
 * Punto di attenuazione del segnale
 */
interface AttenuationPoint {
  id: string;
  position: BABYLON.Vector3;
  factor: number;
  radius: number;
}

/**
 * Stop di colore per il gradiente
 */
interface ColorStop {
  value: number;          // 0-1
  color: string;          // hex color
}

/**
 * Modalità di combinazione di heatmap multiple
 */
type CombineMode = 'add' | 'max' | 'overlay';

/**
 * Configurazione globale del sistema heatmap
 */
interface HeatmapConfig {
  strategy: HeatmapStrategy;
  colorStops?: ColorStop[];
  defaultRadius?: number;
  thresholds?: { low: number; mid: number; high: number };
  combineMode?: CombineMode;
  zeroForceRed?: boolean;
  textureSize?: number;
  uvVFlipped?: boolean;
}

/**
 * Contesto passato alle strategie per il calcolo
 */
interface HeatmapContext {
  sensors: Sensor[];
  links: Link[];
  attenuators: AttenuationPoint[];
  config: HeatmapConfig;
  textureSize: number;
}

// ============================================================================
// HEATMAP STRATEGIES
// ============================================================================

/**
 * Interfaccia per strategie di calcolo heatmap
 */
interface HeatmapStrategy {
  readonly name: string;

  /**
   * Calcola l'influenza di un singolo sensore su un punto
   */
  computeInfluence(sensor: Sensor, point: BABYLON.Vector3, context: HeatmapContext): number;

  /**
   * Combina le influenze di più sensori
   */
  combineInfluences(values: number[], combineMode: CombineMode): number;

  /**
   * Aggiornamento periodico della strategia (chiamato ogni frame o quando forzato)
   */
  update(context: HeatmapContext): void;
}

/**
 * Classe base astratta con implementazione comune di combineInfluences
 */
abstract class BaseHeatmapStrategy implements HeatmapStrategy {
  abstract readonly name: string;
  abstract computeInfluence(sensor: Sensor, point: BABYLON.Vector3, context: HeatmapContext): number;
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

/**
 * Strategy basata su intensity interpretata come signal strength.
 * Considera distanza radiale, attenuatori e propagazione lungo i link.
 */
class SignalStrategy extends BaseHeatmapStrategy {
  readonly name = 'signal';

  computeInfluence(sensor: Sensor, point: BABYLON.Vector3, context: HeatmapContext): number {
    if (!sensor.enabled || sensor.intensity === 0) {
      return 0;
    }

    const distance = BABYLON.Vector3.Distance(sensor.position, point);

    let influence = Math.max(0, 1 - distance / sensor.radius) * sensor.intensity;

    if (context.links.length > 0) {
      let linkInfluence = 0;

      for (const link of context.links) {
        if (link.sensorA === sensor.id || link.sensorB === sensor.id) {
          const otherSensorId = link.sensorA === sensor.id ? link.sensorB : link.sensorA;
          const otherSensor = context.sensors.find(s => s.id === otherSensorId);

          if (otherSensor && otherSensor.enabled && otherSensor.intensity > 0) {
            const distFromSegment = this.pointToSegmentDistance(point, sensor.position, otherSensor.position);
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

    for (const att of context.attenuators) {
      const distToAtt = BABYLON.Vector3.Distance(att.position, point);
      if (distToAtt < att.radius) {
        const attenuationAmount = 1 - (1 - att.factor) * (1 - distToAtt / att.radius);
        influence *= attenuationAmount;
      }
    }

    return influence;
  }

  private pointToSegmentDistance(point: BABYLON.Vector3, segmentStart: BABYLON.Vector3, segmentEnd: BABYLON.Vector3): number {
    const segmentVector = segmentEnd.subtract(segmentStart);
    const pointVector = point.subtract(segmentStart);
    const segmentLength = segmentVector.length();
    if (segmentLength === 0) return pointVector.length();

    const t = Math.max(0, Math.min(1, BABYLON.Vector3.Dot(pointVector, segmentVector) / (segmentLength * segmentLength)));
    const projection = segmentStart.add(segmentVector.scale(t));
    return BABYLON.Vector3.Distance(point, projection);
  }

  update(context: HeatmapContext): void {
    // nessun processing necessario per signal
  }
}

/**
 * Strategia basata su intensity interpretata come livello di batteria.
 * Propaga valori di "battery" sulla mesh network per ottenere un effective intensity per ogni nodo.
 */
class BatteryStrategy extends BaseHeatmapStrategy {
  readonly name = 'battery';
  private effectiveIntensityCache: Map<string, number> = new Map();

  computeInfluence(sensor: Sensor, point: BABYLON.Vector3, context: HeatmapContext): number {
    if (!sensor.enabled) return 0;

    const distance = BABYLON.Vector3.Distance(sensor.position, point);
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

    if (context.links.length === 0) {
      return;
    }

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
          const neighbor = context.sensors.find(x => x.id === nId);
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
  private dynamicTexture: BABYLON.DynamicTexture;
  private context: CanvasRenderingContext2D;
  private material: BABYLON.StandardMaterial;

  constructor(private scene: BABYLON.Scene, private textureSize: number, private colorStops: ColorStop[]) {
    this.dynamicTexture = new BABYLON.DynamicTexture('heatmapTexture', { width: textureSize, height: textureSize }, scene, false);
    this.context = this.dynamicTexture.getContext();
    this.material = new BABYLON.StandardMaterial('heatmapMaterial', scene);
    this.material.diffuseTexture = this.dynamicTexture;
    this.material.specularColor = new BABYLON.Color3(0, 0, 0);
    this.material.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);
  }

  updateTexture(data: number[][]): void {
    const size = this.textureSize;
    const imageData = this.context.createImageData(size, size);

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
    this.dynamicTexture.update();
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

    const denom = (upperStop.value - lowerStop.value) || 1;
    const t = (value - lowerStop.value) / denom;
    const lowerColor = this.hexToRgb(lowerStop.color);
    const upperColor = this.hexToRgb(upperStop.color);

    return {
      r: Math.round(lowerColor.r + (upperColor.r - lowerColor.r) * t),
      g: Math.round(lowerColor.g + (upperColor.g - lowerColor.g) * t),
      b: Math.round(lowerColor.b + (upperColor.b - lowerColor.b) * t)
    };
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  getMaterial(): BABYLON.StandardMaterial {
    return this.material;
  }

  dispose(): void {
    this.dynamicTexture.dispose();
    this.material.dispose();
  }
}

// ============================================================================
// HEATMAP CONTROLLER
// ============================================================================

class HeatmapController {
  private sensors: Map<string, Sensor> = new Map();
  private links: Map<string, Link> = new Map();
  private attenuators: Map<string, AttenuationPoint> = new Map();
  private targetMeshes: Set<BABYLON.AbstractMesh> = new Set();
  private shaderManager: ShaderManager;
  private config: Required<HeatmapConfig>;
  private meshBounds: { min: BABYLON.Vector3; max: BABYLON.Vector3 } | null = null;
  private isDirty: boolean = true;
  private lastRenderTime: number = 0;
  private renderThrottle: number = 16;

  constructor(private scene: BABYLON.Scene, targetMeshes: BABYLON.AbstractMesh[], config: HeatmapConfig) {
    this.config = {
      strategy: config.strategy,
      colorStops: config.colorStops || [
        { value: 0, color: '#ff0000' },
        { value: 0.5, color: '#ffff00' },
        { value: 1, color: '#00ff00' }
      ],
      defaultRadius: config.defaultRadius || 2.5,
      thresholds: config.thresholds || { low: 0.2, mid: 0.6, high: 0.9 },
      combineMode: config.combineMode || 'max',
      zeroForceRed: config.zeroForceRed !== undefined ? config.zeroForceRed : true,
      textureSize: config.textureSize || 128,
      uvVFlipped: config.uvVFlipped !== undefined ? config.uvVFlipped : true
    };

    this.shaderManager = new ShaderManager(scene, this.config.textureSize, this.config.colorStops);
    targetMeshes.forEach(mesh => this.attachToMesh(mesh));
    this.updateBounds();
    this.updateStrategyImmediate();
  }

  // -----------------------------
  // SENSOR MANAGEMENT
  // -----------------------------

  addSensor(id: string, position: BABYLON.Vector3, options?: { intensity?: number; radius?: number; attachMesh?: BABYLON.AbstractMesh; }): Sensor {
    const sensor: Sensor = {
      id,
      position: position.clone(),
      intensity: options?.intensity !== undefined ? options.intensity : 1,
      radius: options?.radius || this.config.defaultRadius,
      enabled: true,
      attachedMesh: options?.attachMesh
    };

    this.sensors.set(id, sensor);
    this.isDirty = true;
    this.updateStrategyImmediate();
    return sensor;
  }

  removeSensor(id: string): void {
    this.sensors.delete(id);
    const linksToRemove: string[] = [];
    this.links.forEach((link, linkId) => {
      if (link.sensorA === id || link.sensorB === id) linksToRemove.push(linkId);
    });
    linksToRemove.forEach(linkId => this.links.delete(linkId));
    this.isDirty = true;
    this.updateStrategyImmediate();
  }

  updateSensor(id: string, patch: Partial<Sensor>): void {
    const sensor = this.sensors.get(id);
    if (!sensor) return;

    if (patch.position) {
      sensor.position.copyFrom(patch.position);
      const { position, ...rest } = patch as any;
      Object.assign(sensor, rest);
    } else {
      Object.assign(sensor, patch);
    }

    this.isDirty = true;

    if (patch.intensity !== undefined || patch.enabled !== undefined) {
      this.updateStrategyImmediate();
    }
  }

  getSensor(id: string): Sensor | undefined {
    return this.sensors.get(id);
  }

  // -----------------------------
  // LINK MANAGEMENT
  // -----------------------------

  addLink(sensorAId: string, sensorBId: string, weight: number = 1): Link {
    const id = `${sensorAId}-${sensorBId}`;
    const link: Link = { id, sensorA: sensorAId, sensorB: sensorBId, weight };
    this.links.set(id, link);
    this.isDirty = true;
    this.updateStrategyImmediate();
    return link;
  }

  removeLink(id: string): void {
    this.links.delete(id);
    this.isDirty = true;
    this.updateStrategyImmediate();
  }

  clearLinks(): void {
    this.links.clear();
    this.isDirty = true;
    this.updateStrategyImmediate();
  }

  // -----------------------------
  // ATTENUATOR MANAGEMENT
  // -----------------------------

  addAttenuator(id: string, position: BABYLON.Vector3, factor: number, radius: number): AttenuationPoint {
    const att: AttenuationPoint = { id, position: position.clone(), factor, radius };
    this.attenuators.set(id, att);
    this.isDirty = true;
    return att;
  }

  removeAttenuator(id: string): void {
    this.attenuators.delete(id);
    this.isDirty = true;
  }

  updateAttenuator(id: string, patch: Partial<AttenuationPoint>): void {
    const att = this.attenuators.get(id);
    if (!att) return;
    if (patch.position) att.position.copyFrom(patch.position);
    Object.assign(att, patch);
    this.isDirty = true;
  }

  // -----------------------------
  // STRATEGY & CONFIG
  // -----------------------------

  setStrategy(strategy: HeatmapStrategy): void {
    this.config.strategy = strategy;
    this.updateStrategyImmediate();
  }

  setConfig(patch: Partial<HeatmapConfig>): void {
    Object.assign(this.config, patch);
    if (patch.colorStops) {
      this.shaderManager.dispose();
      this.shaderManager = new ShaderManager(this.scene, this.config.textureSize, this.config.colorStops);
      this.targetMeshes.forEach(mesh => { mesh.material = this.shaderManager.getMaterial(); });
    }
    if (patch.textureSize) {
      this.shaderManager.dispose();
      this.shaderManager = new ShaderManager(this.scene, this.config.textureSize, this.config.colorStops);
      this.targetMeshes.forEach(mesh => { mesh.material = this.shaderManager.getMaterial(); });
      this.isDirty = true;
    }
  }

  // -----------------------------
  // MESH MANAGEMENT
  // -----------------------------

  attachToMesh(mesh: BABYLON.AbstractMesh): void {
    this.targetMeshes.add(mesh);
    mesh.material = this.shaderManager.getMaterial();
    this.updateBounds();
  }

  detachFromMesh(mesh: BABYLON.AbstractMesh): void {
    this.targetMeshes.delete(mesh);
    this.updateBounds();
  }

  private updateBounds(): void {
    if (this.targetMeshes.size === 0) {
      this.meshBounds = null;
      return;
    }

    let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
    let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);

    this.targetMeshes.forEach(mesh => {
      const boundingInfo = mesh.getBoundingInfo();
      min = BABYLON.Vector3.Minimize(min, boundingInfo.boundingBox.minimumWorld);
      max = BABYLON.Vector3.Maximize(max, boundingInfo.boundingBox.maximumWorld);
    });

    this.meshBounds = { min, max };
    this.isDirty = true;
  }

  // -----------------------------
  // STRATEGY HELPERS
  // -----------------------------

  private updateStrategyImmediate(): void {
    const context: HeatmapContext = {
      sensors: Array.from(this.sensors.values()),
      links: Array.from(this.links.values()),
      attenuators: Array.from(this.attenuators.values()),
      config: this.config,
      textureSize: this.config.textureSize
    };
    this.config.strategy.update(context);
    this.isDirty = true;
  }

  // -----------------------------
  // RENDERING
  // -----------------------------

  render(): void {
    if (!this.meshBounds) return;

    const now = performance.now();
    if (!this.isDirty && (now - this.lastRenderTime) < this.renderThrottle) {
      return;
    }

    this.lastRenderTime = now;
    this.isDirty = false;

    const context: HeatmapContext = {
      sensors: Array.from(this.sensors.values()),
      links: Array.from(this.links.values()),
      attenuators: Array.from(this.attenuators.values()),
      config: this.config,
      textureSize: this.config.textureSize
    };

    this.config.strategy.update(context);

    const heatmapData = this.computeHeatmap(context);
    this.shaderManager.updateTexture(heatmapData);
  }

  private computeHeatmap(context: HeatmapContext): number[][] {
    const size = this.config.textureSize;
    const data: number[][] = [];
    const bounds = this.meshBounds!;
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    const depth = bounds.max.z - bounds.min.z;

    const dimensions = [
      { name: 'x', size: width, min: bounds.min.x, max: bounds.max.x },
      { name: 'y', size: height, min: bounds.min.y, max: bounds.max.y },
      { name: 'z', size: depth, min: bounds.min.z, max: bounds.max.z }
    ].sort((a, b) => b.size - a.size);

    const dim1 = dimensions[0];
    const dim2 = dimensions[1];
    const dim3 = dimensions[2];

    for (let y = 0; y < size; y++) {
      const row: number[] = [];
      for (let x = 0; x < size; x++) {
        const u = x / (size - 1);
        const v = y / (size - 1);
        const vUsed = this.config.uvVFlipped ? 1 - v : v;

        const coord1 = dim1.min + u * dim1.size;
        const coord2 = dim2.min + vUsed * dim2.size;
        const coord3 = (dim3.min + dim3.max) / 2;

        const point = new BABYLON.Vector3(
          dim1.name === 'x' ? coord1 : (dim2.name === 'x' ? coord2 : coord3),
          dim1.name === 'y' ? coord1 : (dim2.name === 'y' ? coord2 : coord3),
          dim1.name === 'z' ? coord1 : (dim2.name === 'z' ? coord2 : coord3)
        );

        const influences: number[] = [];
        let enabledSensorsCount = 0;
        let zeroSensorsCount = 0;

        for (const sensor of context.sensors) {
          if (!sensor.enabled) continue;
          enabledSensorsCount++;

          if (this.config.zeroForceRed) {
            if (sensor.intensity === 0) zeroSensorsCount++;
          }

          const influence = this.config.strategy.computeInfluence(sensor, point, context);
          if (influence > 0) influences.push(influence);
        }

        let finalValue = 0;
        const allSensorsZero = enabledSensorsCount > 0 && zeroSensorsCount === enabledSensorsCount;

        if (allSensorsZero && this.config.zeroForceRed) {
          finalValue = 0;
        } else if (influences.length > 0) {
          finalValue = this.config.strategy.combineInfluences(influences, this.config.combineMode);
        }

        row.push(finalValue);
      }
      data.push(row);
    }

    return data;
  }

  // -----------------------------
  // CLEANUP
  // -----------------------------

  dispose(): void {
    this.shaderManager.dispose();
    this.sensors.clear();
    this.links.clear();
    this.attenuators.clear();
    this.targetMeshes.clear();
  }
}

// ============================================================================
// PLAYGROUND EXAMPLE
// ============================================================================

class Playground {
  public static CreateScene(engine: BABYLON.Engine, canvas: HTMLCanvasElement): BABYLON.Scene {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.15, 1);

    const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 12, new BABYLON.Vector3(0, 0, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 20;

    const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    const plane = BABYLON.MeshBuilder.CreateGround('heatmapPlane', { width: 6, height: 4, subdivisions: 32 }, scene);
    plane.position.y = 0;

    const controller = new HeatmapController(scene, [plane], {
      strategy: new SignalStrategy(),
      colorStops: [
        { value: 0, color: '#ff0000' },
        { value: 0.5, color: '#ffff00' },
        { value: 1, color: '#00ff00' }
      ],
      defaultRadius: 4,
      combineMode: 'max',
      zeroForceRed: true,
      textureSize: 128,
      uvVFlipped: true
    });

    const sensorMeshes = new Map<string, BABYLON.Mesh>();
    const attenuatorMeshes: BABYLON.Mesh[] = [];
    let currentStrategy: 'signal' | 'battery' = 'signal';

    const sensorPositions = [
      { id: 'A', pos: new BABYLON.Vector3(-2.5, 0.2, -1.5) },
      { id: 'B', pos: new BABYLON.Vector3(2.5, 0.2, -1.5) },
      { id: 'C', pos: new BABYLON.Vector3(2.5, 0.2, 1.5) },
      { id: 'D', pos: new BABYLON.Vector3(-2.5, 0.2, 1.5) }
    ];

    sensorPositions.forEach(({ id, pos }) => {
      controller.addSensor(id, pos, { intensity: 1, radius: 4 });

      const sphere = BABYLON.MeshBuilder.CreateSphere(`sensor${id}`, { diameter: 0.3 }, scene);
      sphere.position = pos.clone();

      const mat = new BABYLON.StandardMaterial(`sensorMat${id}`, scene);
      mat.diffuseColor = new BABYLON.Color3(0.2, 0.5, 1);
      mat.emissiveColor = new BABYLON.Color3(0.1, 0.3, 0.6);
      sphere.material = mat;

      sensorMeshes.set(id, sphere);

      const fixedY = sphere.position.y;
      const dragBehavior = new BABYLON.PointerDragBehavior({ dragPlaneNormal: new BABYLON.Vector3(0, 1, 0) });
      dragBehavior.useObjectOrientationForDragging = false;

      dragBehavior.onDragObservable.add(() => {
        sphere.position.y = fixedY;

        const s = controller.getSensor(id);
        if (s) {
          s.position.copyFrom(sphere.position);
          controller.updateSensor(id, {}); // marca dirty e triggera eventuale updateStrategyImmediate se necessario
        } else {
          controller.updateSensor(id, { position: sphere.position.clone() });
        }

        // Update durante debug/drag
        (controller as any).isDirty = true;
        controller.render();
      });

      dragBehavior.onDragStartObservable.add(() => camera.detachControl());
      dragBehavior.onDragEndObservable.add(() => {
        camera.attachControl(canvas, true);
        (controller as any).isDirty = true;
        controller.render();
      });

      sphere.addBehavior(dragBehavior);
    });

    const createMeshNetwork = () => {
      const sensorIds = ['A', 'B', 'C', 'D'];
      for (let i = 0; i < sensorIds.length; i++) {
        for (let j = i + 1; j < sensorIds.length; j++) {
          controller.addLink(sensorIds[i], sensorIds[j], 1);
        }
      }
    };

    createMeshNetwork();

    const wallPoints = 10;
    for (let i = 0; i < wallPoints; i++) {
      const z = -1.5 + (3 / (wallPoints - 1)) * i;
      const pos = new BABYLON.Vector3(0, 0.2, z);
      controller.addAttenuator(`wall${i}`, pos, 0.3, 0.8);

      const box = BABYLON.MeshBuilder.CreateBox(`attenuator${i}`, { size: 0.3 }, scene);
      box.position = pos;
      const mat = new BABYLON.StandardMaterial(`attMat${i}`, scene);
      mat.diffuseColor = new BABYLON.Color3(0.8, 0.3, 0.1);
      mat.alpha = 0.7;
      box.material = mat;
      attenuatorMeshes.push(box);
    }

    // UI
    const uiContainer = document.createElement('div');
    uiContainer.id = 'uiContainer';
    uiContainer.innerHTML = `
      <style>
        #uiContainer {
          position: absolute;
          top: 10px;
          right: 10px;
          background: rgba(20, 20, 30, 0.95);
          padding: 20px;
          border-radius: 8px;
          color: #fff;
          font-family: Arial, sans-serif;
          width: 320px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }
        h3 { margin: 0 0 15px 0; font-size: 16px; color: #4CAF50; border-bottom: 1px solid #444; padding-bottom: 8px; }
        .section { margin-bottom: 20px; }
        .control-row { margin-bottom: 12px; }
        label { display: block; margin-bottom: 5px; font-size: 13px; color: #ccc; }
        input[type="range"] { width: 100%; margin-bottom: 5px; }
        input[type="checkbox"] { margin-right: 8px; }
        button { width: 100%; padding: 8px; margin: 5px 0; background: #4CAF50; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; }
        button:hover { background: #45a049; }
        .value-display { display: inline-block; float: right; color: #4CAF50; font-weight: bold; }
        .mode-indicator { text-align: center; padding: 8px; background: #2196F3; border-radius: 4px; margin-bottom: 15px; font-weight: bold; }
      </style>

      <div class="mode-indicator" id="modeIndicator">Modalità: SIGNAL</div>

      <div class="section">
        <h3>Sensori</h3>
        <div class="control-row"><label><input type="checkbox" id="sensorA" checked> Sensore A</label></div>
        <div class="control-row"><label><input type="checkbox" id="sensorB" checked> Sensore B</label></div>
        <div class="control-row"><label><input type="checkbox" id="sensorC" checked> Sensore C</label></div>
        <div class="control-row"><label><input type="checkbox" id="sensorD" checked> Sensore D</label></div>
        <div class="control-row"><label><input type="checkbox" id="linkAll" checked> Link Mesh Network</label></div>
      </div>

      <div class="section">
        <button id="toggleMode">Passa a BATTERY Mode</button>
      </div>

      <div class="section" id="signalSection">
        <h3>Signal Mode</h3>
        <div class="control-row">
          <label>Intensità A <span class="value-display" id="intensityAVal">100%</span></label>
          <input type="range" id="intensityA" min="0" max="100" value="100">
        </div>
        <div class="control-row">
          <label>Intensità B <span class="value-display" id="intensityBVal">100%</span></label>
          <input type="range" id="intensityB" min="0" max="100" value="100">
        </div>
        <div class="control-row">
          <label>Intensità C <span class="value-display" id="intensityCVal">100%</span></label>
          <input type="range" id="intensityC" min="0" max="100" value="100">
        </div>
        <div class="control-row">
          <label>Intensità D <span class="value-display" id="intensityDVal">100%</span></label>
          <input type="range" id="intensityD" min="0" max="100" value="100">
        </div>
        <div class="control-row">
          <label>Attenuazione Muro <span class="value-display" id="wallAttVal">70%</span></label>
          <input type="range" id="wallAtt" min="0" max="100" value="70">
        </div>       
      </div>

      <div class="section" id="batterySection" style="display: none;">
        <h3>Battery Mode</h3>
        <div class="control-row">
          <label>Batteria A <span class="value-display" id="batteryAVal">100%</span></label>
          <input type="range" id="batteryA" min="0" max="100" value="100">
        </div>
        <div class="control-row">
          <label>Batteria B <span class="value-display" id="batteryBVal">100%</span></label>
          <input type="range" id="batteryB" min="0" max="100" value="100">
        </div>
        <div class="control-row">
          <label>Batteria C <span class="value-display" id="batteryCVal">100%</span></label>
          <input type="range" id="batteryC" min="0" max="100" value="100">
        </div>
        <div class="control-row">
          <label>Batteria D <span class="value-display" id="batteryDVal">100%</span></label>
          <input type="range" id="batteryD" min="0" max="100" value="100">
        </div>
      </div>
    `;

    document.body.appendChild(uiContainer);
    scene.onDisposeObservable.add(() => {
      if (document.body.contains(uiContainer)) document.body.removeChild(uiContainer);
    });


    ['A', 'B', 'C', 'D'].forEach(id => {
      const checkbox = document.getElementById(`sensor${id}`) as HTMLInputElement;
      checkbox.addEventListener('change', (e) => {
        const enabled = (e.target as HTMLInputElement).checked;
        controller.updateSensor(id, { enabled });
        const mesh = sensorMeshes.get(id);
        if (mesh && mesh.material) {
          (mesh.material as BABYLON.StandardMaterial).alpha = enabled ? 1 : 0.3;
        }
      });
    });

    const linkCheckbox = document.getElementById('linkAll') as HTMLInputElement;
    linkCheckbox.addEventListener('change', (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      if (enabled) createMeshNetwork();
      else controller.clearLinks();
    });

    const toggleBtn = document.getElementById('toggleMode') as HTMLButtonElement;
    toggleBtn.addEventListener('click', () => {
      currentStrategy = currentStrategy === 'signal' ? 'battery' : 'signal';

      if (currentStrategy === 'signal') {
        controller.setStrategy(new SignalStrategy());
        toggleBtn.textContent = 'Passa a BATTERY Mode';
        document.getElementById('modeIndicator')!.textContent = 'Modalità: SIGNAL';
        document.getElementById('modeIndicator')!.style.background = '#2196F3';
        document.getElementById('signalSection')!.style.display = 'block';
        document.getElementById('batterySection')!.style.display = 'none';
      } else {
        controller.setStrategy(new BatteryStrategy());
        toggleBtn.textContent = 'Passa a SIGNAL Mode';
        document.getElementById('modeIndicator')!.textContent = 'Modalità: BATTERY';
        document.getElementById('modeIndicator')!.style.background = '#FF9800';
        document.getElementById('signalSection')!.style.display = 'none';
        document.getElementById('batterySection')!.style.display = 'block';
      }
    });

    ['A', 'B', 'C', 'D'].forEach(id => {
      const slider = document.getElementById(`intensity${id}`) as HTMLInputElement;
      const display = document.getElementById(`intensity${id}Val`) as HTMLElement;

      slider.addEventListener('input', (e) => {
        const value = parseInt((e.target as HTMLInputElement).value) / 100;
        display.textContent = `${Math.round(value * 100)}%`;
        controller.updateSensor(id, { intensity: value });
      });
    });

    const wallSlider = document.getElementById('wallAtt') as HTMLInputElement;
    const wallDisplay = document.getElementById('wallAttVal') as HTMLElement;
    wallSlider.addEventListener('input', (e) => {
      const attenuationPercent = parseInt((e.target as HTMLInputElement).value) / 100;
      wallDisplay.textContent = `${Math.round(attenuationPercent * 100)}%`;
      const factor = 1 - attenuationPercent;
      for (let i = 0; i < 10; i++) {
        controller.updateAttenuator(`wall${i}`, { factor });
      }
    });

    ['A', 'B', 'C', 'D'].forEach(id => {
      const slider = document.getElementById(`battery${id}`) as HTMLInputElement;
      const display = document.getElementById(`battery${id}Val`) as HTMLElement;

      slider.addEventListener('input', (e) => {
        const value = parseInt((e.target as HTMLInputElement).value) / 100;
        display.textContent = `${Math.round(value * 100)}%`;
        controller.updateSensor(id, { intensity: value });
      });
    });

    scene.registerBeforeRender(() => {
      controller.render();
    });

    console.log('Heatmap System initialized (refactored: unified intensity concept).');

    return scene;
  }
}

export { Playground };
