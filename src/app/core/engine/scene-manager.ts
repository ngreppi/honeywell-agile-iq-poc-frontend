/**
 * @fileoverview Scene Manager for BabylonJS engine management
 *
 * Manages the lifecycle of BabylonJS Engine and Scene, adapted for Angular with
 * dependency injection support.
 */

import {
  Engine,
  Scene,
  Camera,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  FreeCamera,
  Viewport,
  Mesh,
  SceneLoader,
  Matrix,
  Quaternion,
  Ray
} from '@babylonjs/core';
import { AdvancedDynamicTexture, TextBlock, Control } from '@babylonjs/gui';
import '@babylonjs/loaders/glTF/2.0';

import { EventType, EngineConfig, RotationChangedPayload, PositionChangedPayload, SceneReadyPayload, MeshClickedPayload, MeshVisibilityChangedPayload, ModelImportRequestedPayload, SensorType, SensorCreationRequestedPayload, SensorInfo, SensorCreatedPayload, SensorLinkRequestedPayload, SensorInsertionModeChangedPayload, SensorLinkModeChangedPayload, SensorLinkType, SensorDistanceModeChangedPayload, SensorDistanceCalculatedPayload, HeatmapVisibilityChangedPayload, HeatmapModeChangedPayload } from '../models/types.model';
import { EventBusService } from '../services/event-bus.service';
import { LoggerService } from '../services/logger.service';
import { HeatmapService } from '../services/heatmap.service';
import { getSensorConfig } from '../models/sensor-configs';
import { environment } from '../../../environments/environment';

/**
 * Scene Manager for BabylonJS
 */
export class SceneManager {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private camera: ArcRotateCamera | null = null;
  private axesCamera: FreeCamera | null = null;
  private mainCube: Mesh | null = null;
  private referenceAxes: { xAxis: any; yAxis: any; zAxis: any } | null = null;
  private secondaryCube: Mesh | null = null;
  private sensors: Map<string, Mesh> = new Map(); // Track created sensors by ID
  private sensorLinks: Map<string, Mesh> = new Map(); // Track sensor link lines by ID
  private sensorMetadata: Map<string, { meshName: string; normal?: Vector3; originalSurfacePoint: Vector3 }> = new Map(); // Track sensor surface metadata
  private sensorIPBoxes: Map<string, Mesh> = new Map(); // Track IP address text boxes by sensor ID

  // Sensor insertion mode state
  private isInSensorInsertionMode = false;
  private currentSensorType: SensorType | null = null;

  // Sensor link mode state
  private isInSensorLinkMode = false;
  private currentLinkType: SensorLinkType | null = null;
  private linkModeSensors: SensorInfo[] = []; // Track selected sensors during link mode

  // Sensor distance calculation mode state
  private isInSensorDistanceMode = false;
  private distanceModeSensors: SensorInfo[] = []; // Track selected sensors during distance calculation

  // Drag state
  private isDragging = false;
  private draggedSensor: Mesh | null = null;
  private dragStartPosition: Vector3 | null = null;
  private dragTargetMesh: Mesh | null = null;
  private draggedIPBoxOffset: Vector3 | null = null; // Store initial IP box offset during drag

  // Click vs Drag detection
  private pointerDownPosition: { x: number; y: number } | null = null;
  private hasMouseMoved = false;
  private readonly DRAG_THRESHOLD = 5; // pixels

  // Mesh highlighting
  private highlightedMesh: Mesh | null = null;
  private originalMaterial: any = null;
  private highlightMaterial: StandardMaterial | null = null;

  // Sensor highlighting
  private highlightedSensor: Mesh | null = null;
  private originalSensorMaterial: any = null;
  private sensorHighlightMaterial: StandardMaterial | null = null;

  // Performance optimization flags
  private isRotating = false;
  private rotationTimeout: number = 0;

  private isInitialized = false;
  private isDisposed = false;
  private lastReadyState = false;

  private config: EngineConfig = {
    antialias: true,
    adaptToDeviceRatio: true,
    generateMipMaps: true,
    enableOfflineSupport: false
  };

  constructor(
    private eventBus: EventBusService,
    private logger: LoggerService,
    private heatmapService: HeatmapService
  ) { }

  // ================================
  // INITIALIZATION
  // ================================

  /**
   * Initialize the BabylonJS engine and scene
   */
  async initialize(canvas: HTMLCanvasElement, config?: Partial<EngineConfig>): Promise<void> {
    if (this.isInitialized && !this.isDisposed && this.scene && !(this.scene as any).isDisposed) {
      console.log('SceneManager already initialized and valid, reusing existing instance');
      return;
    }

    this.isDisposed = false;
    this.isInitialized = false;

    this.canvas = canvas;
    this.config = { ...this.config, ...config };

    try {
      console.log('Initializing SceneManager...');

      // Create BabylonJS engine
      this.engine = new Engine(
        canvas,
        this.config.antialias,
        {
          adaptToDeviceRatio: this.config.adaptToDeviceRatio,
        }
      );

      // Create scene
      this.scene = new Scene(this.engine);

      // Enable multiple active cameras for rendering axes in separate viewport
      this.scene.activeCameras = [];

      // Initialize heatmap service
      this.heatmapService.initialize(this.scene);

      // Setup scene (camera, lights, objects)
      await this.setupScene();

      // Configure event listeners
      this.setupEventListeners();

      // Setup event bus listeners
      this.setupEventBusListeners();

      // Start render loop
      this.startRenderLoop();

      this.isInitialized = true;

      // Emit scene ready event
      this.emitSceneReady();

      this.logger.info('SceneManager initialized successfully', 'SceneManager', {
        meshCount: this.scene?.meshes.length || 0,
        cameraType: 'FreeCamera'
      });

    } catch (error) {
      this.eventBus.emitError(error as Error, 'scene_initialization');
      this.logger.error(`Scene initialization failed: ${(error as Error).message}`, 'SceneManager', { error });
      throw error;
    }
  }

  /**
   * Setup the 3D scene (camera, lights, objects)
   */
  private async setupScene(): Promise<void> {
    if (!this.scene) return;

    console.log('Setting up 3D scene...');
    console.log('   Canvas dimensions:', this.canvas?.width, 'x', this.canvas?.height);
    console.log('   Canvas client dimensions:', this.canvas?.clientWidth, 'x', this.canvas?.clientHeight);

    // CAMERA: ArcRotateCamera for rotation around objects with zoom support
    this.camera = new ArcRotateCamera(
      'mainCamera',
      -Math.PI / 2, // alpha: horizontal rotation (starts at -90 degrees)
      Math.PI / 3, // beta: vertical rotation (starts at 60 degrees from top)
      15, // radius: distance from target
      Vector3.Zero(), // target: look at origin
      this.scene
    );

    this.camera.attachControl(this.canvas!, true);

    // Camera settings
    this.camera.lowerRadiusLimit = 2; // Minimum zoom distance
    this.camera.upperRadiusLimit = 100; // Maximum zoom distance
    this.camera.wheelPrecision = 20; // Zoom speed with mouse wheel
    this.camera.panningSensibility = 50; // Panning speed
    this.camera.angularSensibilityX = 1000; // Horizontal rotation sensitivity
    this.camera.angularSensibilityY = 1000; // Vertical rotation sensitivity

    // Enable panning with Ctrl+Left mouse button
    this.camera.panningAxis = new Vector3(1, 1, 0);

    // Limit vertical rotation to prevent flipping
    this.camera.lowerBetaLimit = 0.1; // Slightly above top
    this.camera.upperBetaLimit = Math.PI - 0.1; // Slightly above bottom

    // Add main camera to active cameras array
    this.scene.activeCameras!.push(this.camera);

    // LIGHTING: Hemispheric light
    const light = new HemisphericLight('hemiLight', new Vector3(1, 1, 0), this.scene);
    light.intensity = 2.0;

    // BACKGROUND: Clear color
    this.scene.clearColor = new Color4(0.498, 0.498, 0.498, 1.0);

    // CREATE REFERENCE AXES
    this.createReferenceAxes();

    // CREATE HIGHLIGHT MATERIAL
    this.createHighlightMaterial();

    // CREATE SENSOR HIGHLIGHT MATERIAL
    this.createSensorHighlightMaterial();

    console.log('Scene configured:');
    console.log(`   Camera: ${this.camera.getClassName()} at alpha ${this.camera.alpha.toFixed(2)}, beta ${this.camera.beta.toFixed(2)}, radius ${this.camera.radius.toFixed(2)}`);
    console.log(`   Light: ${light.getClassName()} intensity ${light.intensity}`);
    console.log(`   Total meshes in scene: ${this.scene.meshes.length}`);

    // Test rendering
    setTimeout(() => {
      if (this.scene && this.engine) {
        console.log('Force rendering test...');
        this.scene.render();
        console.log('   Engine render stats:', {
          fps: this.engine.getFps(),
          isDisposed: (this.engine as any).isDisposed,
          sceneIsReady: this.scene.isReady()
        });
      }
    }, 1000);

    // Load default model if enabled in environment
    if (environment.loadDefaultModel) {
      console.log('Loading default model as configured in environment...');
      this.loadDefaultGLBModel().catch(error => {
        console.error('Failed to load default model:', error);
      });
    }

    // Register heatmap render loop
    this.scene.registerBeforeRender(() => {
      this.heatmapService.render();
    });
  }

  /**
   * Create reference axes (X, Y, Z) that will be positioned in the top-right corner
   * using a dedicated camera with a fixed viewport
   */
  private createReferenceAxes(): void {
    if (!this.scene || !this.camera) return;

    const axisLength = 1.5;
    const axisRadius = 0.05;
    const arrowHeight = 0.3;
    const arrowRadius = 0.12;
    const sphereRadius = 0.15;

    // Create a dedicated camera for the axes with a viewport in the top-right corner
    // The viewport uses normalized coordinates: [minX, minY, width, height]
    // Position: top-right corner, size: 150x150 pixels (approximately 0.15 of viewport)
    this.axesCamera = new FreeCamera('axesCamera', new Vector3(0, 0, -10), this.scene);
    this.axesCamera.mode = Camera.ORTHOGRAPHIC_CAMERA;

    // Set orthographic frustum for proper fixed-size rendering
    const orthoSize = 2;
    this.axesCamera.orthoLeft = -orthoSize;
    this.axesCamera.orthoRight = orthoSize;
    this.axesCamera.orthoTop = orthoSize;
    this.axesCamera.orthoBottom = -orthoSize;

    // Create viewport for top-right corner (150px x 150px)
    // We'll update this dynamically based on canvas size
    this.updateAxesViewport();

    // Set layer mask so axes are only rendered by the axes camera
    const axesLayerMask = 0x20000000;
    this.axesCamera.layerMask = axesLayerMask;

    // Add axes camera to the active cameras array
    this.scene.activeCameras!.push(this.axesCamera);

    // Create central sphere
    const centralSphere = MeshBuilder.CreateSphere('axisSphere', {
      diameter: sphereRadius * 2
    }, this.scene);
    const sphereMaterial = new StandardMaterial('sphereMaterial', this.scene);
    sphereMaterial.emissiveColor = new Color3(0.3, 0.3, 0.3);
    sphereMaterial.diffuseColor = new Color3(0, 0, 0);
    sphereMaterial.specularColor = new Color3(0, 0, 0);
    centralSphere.material = sphereMaterial;
    centralSphere.layerMask = axesLayerMask;

    // Create X axis (Red) - pointing right
    const xCylinder = MeshBuilder.CreateCylinder('xAxisCylinder', {
      height: axisLength,
      diameter: axisRadius * 2
    }, this.scene);
    xCylinder.rotation.z = -Math.PI / 2;
    xCylinder.position.x = axisLength / 2;
    xCylinder.layerMask = axesLayerMask;

    const xArrow = MeshBuilder.CreateCylinder('xAxisArrow', {
      height: arrowHeight,
      diameterTop: 0,
      diameterBottom: arrowRadius * 2
    }, this.scene);
    xArrow.rotation.z = -Math.PI / 2;
    xArrow.position.x = axisLength + arrowHeight / 2;
    xArrow.layerMask = axesLayerMask;

    const xMaterial = new StandardMaterial('xAxisMaterial', this.scene);
    xMaterial.emissiveColor = new Color3(1, 0, 0); // Red
    xMaterial.diffuseColor = new Color3(0, 0, 0);
    xMaterial.specularColor = new Color3(0, 0, 0);
    xCylinder.material = xMaterial;
    xArrow.material = xMaterial;

    // Create Y axis (Green) - pointing up
    const yCylinder = MeshBuilder.CreateCylinder('yAxisCylinder', {
      height: axisLength,
      diameter: axisRadius * 2
    }, this.scene);
    yCylinder.position.y = axisLength / 2;
    yCylinder.layerMask = axesLayerMask;

    const yArrow = MeshBuilder.CreateCylinder('yAxisArrow', {
      height: arrowHeight,
      diameterTop: 0,
      diameterBottom: arrowRadius * 2
    }, this.scene);
    yArrow.position.y = axisLength + arrowHeight / 2;
    yArrow.layerMask = axesLayerMask;

    const yMaterial = new StandardMaterial('yAxisMaterial', this.scene);
    yMaterial.emissiveColor = new Color3(0, 1, 0); // Green
    yMaterial.diffuseColor = new Color3(0, 0, 0);
    yMaterial.specularColor = new Color3(0, 0, 0);
    yCylinder.material = yMaterial;
    yArrow.material = yMaterial;

    // Create Z axis (Blue) - pointing forward
    const zCylinder = MeshBuilder.CreateCylinder('zAxisCylinder', {
      height: axisLength,
      diameter: axisRadius * 2
    }, this.scene);
    zCylinder.rotation.x = -Math.PI / 2;
    zCylinder.position.z = axisLength / 2;
    zCylinder.layerMask = axesLayerMask;

    const zArrow = MeshBuilder.CreateCylinder('zAxisArrow', {
      height: arrowHeight,
      diameterTop: 0,
      diameterBottom: arrowRadius * 2
    }, this.scene);
    zArrow.rotation.x = Math.PI / 2;
    zArrow.position.z = axisLength + arrowHeight / 2;
    zArrow.layerMask = axesLayerMask;

    const zMaterial = new StandardMaterial('zAxisMaterial', this.scene);
    zMaterial.emissiveColor = new Color3(0, 0, 1); // Blue
    zMaterial.diffuseColor = new Color3(0, 0, 0);
    zMaterial.specularColor = new Color3(0, 0, 0);
    zCylinder.material = zMaterial;
    zArrow.material = zMaterial;

    // Group all parts into parent meshes for each axis
    const xAxis = MeshBuilder.CreateBox('xAxis', { size: 0.01 }, this.scene);
    xAxis.isVisible = false;
    xAxis.layerMask = axesLayerMask;
    xCylinder.parent = xAxis;
    xArrow.parent = xAxis;
    centralSphere.parent = xAxis;

    const yAxis = MeshBuilder.CreateBox('yAxis', { size: 0.01 }, this.scene);
    yAxis.isVisible = false;
    yAxis.layerMask = axesLayerMask;
    yCylinder.parent = yAxis;
    yArrow.parent = yAxis;

    const zAxis = MeshBuilder.CreateBox('zAxis', { size: 0.01 }, this.scene);
    zAxis.isVisible = false;
    zAxis.layerMask = axesLayerMask;
    zCylinder.parent = zAxis;
    zArrow.parent = zAxis;

    this.referenceAxes = { xAxis, yAxis, zAxis };

    // Position axes at origin - they'll be rotated by the axes camera
    this.referenceAxes.xAxis.position = Vector3.Zero();
    this.referenceAxes.yAxis.position = Vector3.Zero();
    this.referenceAxes.zAxis.position = Vector3.Zero();

    // Sync axes camera with main camera rotation
    // Use optimized approach with cached values and throttling
    let lastAxesUpdateTime = 0;
    const AXES_UPDATE_INTERVAL = 16; // ~60fps

    this.camera.onViewMatrixChangedObservable.add(() => {
      if (!this.camera || !this.axesCamera) return;

      // Throttle axes updates for better performance
      const now = performance.now();
      if (now - lastAxesUpdateTime < AXES_UPDATE_INTERVAL) return;
      lastAxesUpdateTime = now;

      // Position the axes camera to match the main camera's direction
      // Get the camera's direction vector
      const direction = this.camera.getDirection(Vector3.Forward()).normalize();
      const radius = 10;

      // Position axes camera in the opposite direction (looking at origin)
      this.axesCamera.position.set(
        -direction.x * radius,
        -direction.y * radius,
        -direction.z * radius
      );
      this.axesCamera.setTarget(Vector3.Zero());
    });

    // Update viewport on window resize
    if (this.engine) {
      this.engine.onResizeObservable.add(() => {
        this.updateAxesViewport();
      });
    }
  }

  /**
   * Update the viewport for the axes camera based on canvas size
   */
  private updateAxesViewport(): void {
    if (!this.axesCamera || !this.engine) return;

    const canvasWidth = this.engine.getRenderWidth();
    const canvasHeight = this.engine.getRenderHeight();

    // Fixed size for axes viewport: 150x150 pixels
    const axesSize = 150;
    const margin = 10; // pixels from edge

    // Calculate normalized coordinates
    const width = axesSize / canvasWidth;
    const height = axesSize / canvasHeight;
    const x = 1 - width - (margin / canvasWidth);
    const y = 1 - height - (margin / canvasHeight);

    this.axesCamera.viewport = new Viewport(x, y, width, height);
  }

  /**
   * Create highlight material for mesh selection
   */
  private createHighlightMaterial(): void {
    if (!this.scene) return;

    this.highlightMaterial = new StandardMaterial('highlightMaterial', this.scene);
    this.highlightMaterial.emissiveColor = new Color3(0.3, 0.3, 0); // yellow
    this.highlightMaterial.diffuseColor = new Color3(1, 1, 0.2); // main yellow color
    this.highlightMaterial.specularColor = new Color3(0.1, 0.1, 0); // minimal highlights
    this.highlightMaterial.alpha = 1.0;
    this.highlightMaterial.backFaceCulling = false;
    this.highlightMaterial.twoSidedLighting = true;
  }

  /**
   * Create highlight material for sensor selection
   */
  private createSensorHighlightMaterial(): void {
    if (!this.scene) return;

    this.sensorHighlightMaterial = new StandardMaterial('sensorHighlightMaterial', this.scene);
    this.sensorHighlightMaterial.emissiveColor = new Color3(0.4, 0.4, 0); // bright yellow
    this.sensorHighlightMaterial.diffuseColor = new Color3(1, 1, 0); // full yellow color
    this.sensorHighlightMaterial.specularColor = new Color3(0.2, 0.2, 0); // slight highlights
    this.sensorHighlightMaterial.alpha = 1.0;
    this.sensorHighlightMaterial.backFaceCulling = true;
  }

  /**
   * Highlight a mesh by changing its material to light yellow
   */
  private highlightMesh(mesh: Mesh): void {
    if (!mesh || !this.highlightMaterial) return;

    // Clear previous highlight first
    this.clearHighlight();

    // Store original material
    this.originalMaterial = mesh.material;
    this.highlightedMesh = mesh;

    // Apply highlight material
    mesh.material = this.highlightMaterial;

    console.log(`Mesh highlighted: ${mesh.name}`);
    this.logger.info(`Mesh highlighted: ${mesh.name}`, 'SceneManager', { meshName: mesh.name });
  }

  /**
   * Clear mesh highlight by restoring original material
   */
  private clearHighlight(): void {
    if (this.highlightedMesh && this.originalMaterial) {
      this.highlightedMesh.material = this.originalMaterial;
      this.logger.info(`Highlight cleared for mesh: ${this.highlightedMesh.name}`, 'SceneManager', {
        meshName: this.highlightedMesh.name
      });
    }

    this.highlightedMesh = null;
    this.originalMaterial = null;
  }

  /**
   * Highlight a sensor by changing its material to yellow
   */
  private highlightSensor(sensor: Mesh): void {
    if (!sensor || !this.sensorHighlightMaterial) return;

    // Clear previous sensor highlight first
    this.clearSensorHighlight();

    // Store original material
    this.originalSensorMaterial = sensor.material;
    this.highlightedSensor = sensor;

    // Apply highlight material
    sensor.material = this.sensorHighlightMaterial;

    console.log(`Sensor highlighted: ${sensor.id}`);
    this.logger.info(`Sensor highlighted: ${sensor.id}`, 'SceneManager', { sensorId: sensor.id });
  }

  /**
   * Clear sensor highlight by restoring original material
   */
  private clearSensorHighlight(): void {
    if (this.highlightedSensor && this.originalSensorMaterial) {
      this.highlightedSensor.material = this.originalSensorMaterial;
      console.log(`Sensor highlight cleared: ${this.highlightedSensor.id}`);
      this.logger.info(`Sensor highlight cleared: ${this.highlightedSensor.id}`, 'SceneManager');
    }

    this.highlightedSensor = null;
    this.originalSensorMaterial = null;
  }

  // ================================
  // SENSOR CREATION METHODS
  // ================================

  /**
   * Generate a random IP address
   */
  private generateRandomIP(): string {
    const octet1 = Math.floor(Math.random() * 254) + 1; // 1-254
    const octet2 = Math.floor(Math.random() * 256); // 0-255
    const octet3 = Math.floor(Math.random() * 256); // 0-255
    const octet4 = Math.floor(Math.random() * 254) + 1; // 1-254
    return `${octet1}.${octet2}.${octet3}.${octet4}`;
  }

  /**
   * Create a text box with IP address next to a sensor
   */
  private createSensorIPBox(sensorId: string, sensor: Mesh, ipAddress: string): void {
    if (!this.scene) return;

    try {
      // Create a larger plane for the text background
      const textPlane = MeshBuilder.CreatePlane(`${sensorId}_ip_box`, {
        width: 2.5,
        height: 0.6
      }, this.scene);

      // Make the plane a billboard that always faces the camera
      textPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;

      // Create material for the text box - white background
      const textMaterial = new StandardMaterial(`${sensorId}_ip_material`, this.scene);
      textMaterial.diffuseColor = new Color3(1, 1, 1); // White background
      textMaterial.emissiveColor = new Color3(0.9, 0.9, 0.9); // Slight white glow to ensure visibility
      textMaterial.alpha = 1.0;
      textMaterial.backFaceCulling = false;

      textPlane.material = textMaterial;

      // Create advanced dynamic texture for text rendering with higher resolution
      const advancedTexture = AdvancedDynamicTexture.CreateForMesh(textPlane, 512, 128);

      // Set background color for the texture to ensure visibility
      advancedTexture.background = '#FFFFFF';

      // Create text block for the IP address
      const textBlock = new TextBlock(`${sensorId}_text`);
      textBlock.text = ipAddress;
      textBlock.color = '#333333';
      textBlock.fontSize = 48;
      textBlock.fontFamily = 'Arial, sans-serif';
      textBlock.fontWeight = 'bold';
      textBlock.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      textBlock.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;

      // Add a subtle shadow effect
      textBlock.shadowOffsetX = 2;
      textBlock.shadowOffsetY = 2;
      textBlock.shadowColor = '#CCCCCC';
      textBlock.shadowBlur = 3;

      // Add the text to the texture
      advancedTexture.addControl(textBlock);

      // Get the sensor's metadata to access the surface normal
      const metadata = this.sensorMetadata.get(sensorId);
      let surfaceNormal = new Vector3(0, 1, 0); // Default upward normal

      if (metadata && metadata.normal) {
        surfaceNormal = metadata.normal.normalize();
      }

      // Position the text box above the sensor along the surface normal
      const offset = surfaceNormal.scale(0.8); // Move 0.8 units along the normal
      textPlane.position = sensor.position.add(offset);

      // Make it non-pickable so it doesn't interfere with interactions
      textPlane.isPickable = false;

      // Store the IP box
      this.sensorIPBoxes.set(sensorId, textPlane);

      this.logger.info(`Created IP box for sensor ${sensorId} with IP: ${ipAddress}`);

    } catch (error) {
      console.error(`Failed to create IP box for sensor ${sensorId}:`, error);
    }
  }

  /**
   * Position and orient a sensor according to mesh normal with offset
   */
  private positionAndOrientSensor(sensor: Mesh, position: Vector3, normal?: Vector3): void {
    if (!normal) {
      // Fallback: position at the click point without orientation
      sensor.position = position.clone();
      return;
    }

    // Normalize the normal vector
    const normalizedNormal = normal.normalize();

    // Calculate offset distance (half of the sensor's height to ensure it sits on the surface)
    const boundingInfo = sensor.getBoundingInfo();
    const size = boundingInfo.boundingBox.maximumWorld.subtract(boundingInfo.boundingBox.minimumWorld);
    const offset = size.y / 2; // Use height for offset

    // Position the sensor offset from the surface along the normal
    const offsetVector = normalizedNormal.scale(offset);
    sensor.position = position.add(offsetVector);

    // Orient the sensor so its bottom face aligns with the surface
    // Use lookAt to orient the sensor toward the normal direction
    const targetPoint = position.add(normalizedNormal);
    sensor.lookAt(targetPoint);

    // Adjust rotation to make the sensor sit properly on the surface
    // Rotate 90 degrees around X to make the bottom face align with the surface
    sensor.rotation.x += Math.PI / 2;
  }

  /**
   * Create a proximity sensor (box oriented according to mesh normal)
   */
  private createProximitySensor(position: Vector3, config: any, normal?: Vector3): Mesh {
    if (!this.scene) throw new Error('Scene not initialized');

    // Create a small sensor box
    const box = MeshBuilder.CreateBox('proximitySensor', {
      width: 0.4,
      height: 0.2,
      depth: 0.3
    }, this.scene);

    // Solid material (not transparent)
    const material = new StandardMaterial('proximitySensorMat', this.scene);
    material.diffuseColor = Color3.FromHexString(config.color);
    material.alpha = 1.0;
    material.backFaceCulling = true;
    material.wireframe = false;

    box.material = material;
    box.isPickable = true;

    // Position and orient the sensor
    this.positionAndOrientSensor(box, position, normal);

    return box;
  }

  /**
   * Create a motion sensor (box oriented according to mesh normal)
   */
  private createMotionSensor(position: Vector3, config: any, normal?: Vector3): Mesh {
    if (!this.scene) throw new Error('Scene not initialized');

    // Create a small sensor box
    const box = MeshBuilder.CreateBox('motionSensor', {
      width: 0.4,
      height: 0.2,
      depth: 0.3
    }, this.scene);

    // Solid material (not transparent)
    const material = new StandardMaterial('motionSensorMat', this.scene);
    material.diffuseColor = Color3.FromHexString(config.color);
    material.alpha = 1.0;
    material.backFaceCulling = true;
    material.wireframe = false;

    box.material = material;
    box.isPickable = true;

    // Position and orient the sensor
    this.positionAndOrientSensor(box, position, normal);

    return box;
  }

  /**
   * Create a temperature sensor (box oriented according to mesh normal)
   */
  private createTemperatureSensor(position: Vector3, config: any, normal?: Vector3): Mesh {
    if (!this.scene) throw new Error('Scene not initialized');

    // Create a small sensor box
    const box = MeshBuilder.CreateBox('temperatureSensor', {
      width: 0.4,
      height: 0.2,
      depth: 0.3
    }, this.scene);

    const material = new StandardMaterial('temperatureSensorMat', this.scene);
    material.diffuseColor = Color3.FromHexString(config.color);
    material.alpha = 1.0;
    material.backFaceCulling = true;
    material.wireframe = false;

    box.material = material;
    box.isPickable = true;

    // Position and orient the sensor
    this.positionAndOrientSensor(box, position, normal);

    return box;
  }

  /**
   * Create a camera sensor (box oriented according to mesh normal)
   */
  private createCameraSensor(position: Vector3, config: any, normal?: Vector3): Mesh {
    if (!this.scene) throw new Error('Scene not initialized');

    // Create a small sensor box
    const box = MeshBuilder.CreateBox('cameraSensor', {
      width: 0.4,
      height: 0.2,
      depth: 0.3
    }, this.scene);

    const material = new StandardMaterial('cameraSensorMat', this.scene);
    material.diffuseColor = Color3.FromHexString(config.color);
    material.alpha = 1.0;
    material.backFaceCulling = true;
    material.wireframe = false;

    box.material = material;
    box.isPickable = true;

    // Position and orient the sensor
    this.positionAndOrientSensor(box, position, normal);

    return box;
  }

  /**
   * Create a sensor based on type and configuration
   */
  private createSensor(sensorType: SensorType, position: Vector3, meshName: string, normal?: Vector3): void {
    try {
      const config = getSensorConfig(sensorType);
      const sensorId = `${sensorType}_${meshName}_${Date.now()}`;

      let sensor: Mesh;

      switch (sensorType) {
        case SensorType.PROXIMITY:
          sensor = this.createProximitySensor(position, config, normal);
          break;
        case SensorType.MOTION:
          sensor = this.createMotionSensor(position, config, normal);
          break;
        case SensorType.TEMPERATURE:
          sensor = this.createTemperatureSensor(position, config, normal);
          break;
        case SensorType.CAMERA:
          sensor = this.createCameraSensor(position, config, normal);
          break;
        default:
          throw new Error(`Unknown sensor type: ${sensorType}`);
      }

      // Set unique ID and store sensor
      sensor.id = sensorId;
      sensor.name = sensorId;
      this.sensors.set(sensorId, sensor);

      // Generate random IP address for this sensor
      const ipAddress = this.generateRandomIP();

      // Create IP address text box next to the sensor
      this.createSensorIPBox(sensorId, sensor, ipAddress);

      // Store sensor metadata for drag operations
      this.sensorMetadata.set(sensorId, {
        meshName,
        normal: normal?.clone(),
        originalSurfacePoint: position.clone()
      });

      // Enable dragging for the sensor
      this.enableSensorDragging(sensor);

      // Create sensor info object
      const sensorInfo: SensorInfo = {
        id: sensorId,
        type: sensorType,
        name: sensorId,
        position: position.clone(),
        meshName,
        normal: normal?.clone(),
        createdAt: Date.now()
      };

      // Emit sensor created event
      this.eventBus.emitSensorCreated({
        sensor: sensorInfo,
        source: 'scene_manager'
      });

      this.logger.info(`Created ${sensorType} sensor at position (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`, 'SceneManager', {
        sensorType,
        sensorId,
        meshName,
        position: { x: position.x, y: position.y, z: position.z }
      });
    } catch (error) {
      this.logger.error(`Failed to create sensor: ${(error as Error).message}`, 'SceneManager', { error, sensorType, meshName });
    }
  }

  /**
   * Create a line connecting two sensors
   */
  private createSensorLink(sensor1: SensorInfo, sensor2: SensorInfo, linkType: SensorLinkType = SensorLinkType.PRIMARY): void {
    try {
      if (!this.scene) {
        throw new Error('Scene not initialized');
      }

      // Get the actual sensor meshes
      const sensorMesh1 = this.sensors.get(sensor1.id);
      const sensorMesh2 = this.sensors.get(sensor2.id);

      if (!sensorMesh1 || !sensorMesh2) {
        throw new Error('One or both sensors not found in scene');
      }

      // Create a unique ID for this link
      const linkId = `link_${linkType}_${sensor1.id}_${sensor2.id}_${Date.now()}`;

      // Create points for the line
      const points = [
        sensor1.position.clone(),
        sensor2.position.clone()
      ];

      // Create the line using CreateLines
      const linkLine = MeshBuilder.CreateLines(linkId, {
        points: points,
        updatable: true
      }, this.scene);

      // Create material for the line based on link type
      const lineMaterial = new StandardMaterial(`${linkId}_material`, this.scene);
      if (linkType === SensorLinkType.SECONDARY) {
        lineMaterial.emissiveColor = new Color3(1, 0.4, 0.7); // Pink color for secondary links
      } else {
        lineMaterial.emissiveColor = new Color3(0, 0, 1); // Blue color for primary links
      }
      lineMaterial.disableLighting = true; // Make it always visible
      linkLine.material = lineMaterial;

      // Set properties
      linkLine.id = linkId;
      linkLine.name = linkId;
      linkLine.isPickable = false;

      // Store the link
      this.sensorLinks.set(linkId, linkLine);

      this.logger.info(`Created ${linkType} sensor link between ${sensor1.id} and ${sensor2.id}`, 'SceneManager', {
        linkId,
        linkType,
        sensor1Id: sensor1.id,
        sensor2Id: sensor2.id,
        sensor1Position: { x: sensor1.position.x, y: sensor1.position.y, z: sensor1.position.z },
        sensor2Position: { x: sensor2.position.x, y: sensor2.position.y, z: sensor2.position.z }
      });
    } catch (error) {
      this.logger.error(`Failed to create sensor link: ${(error as Error).message}`, 'SceneManager', {
        error,
        sensor1Id: sensor1.id,
        sensor2Id: sensor2.id
      });
    }
  }

  /**
   * Calculate distance between two sensors and find all intersected meshes
   */
  private calculateSensorDistance(sensor1: SensorInfo, sensor2: SensorInfo): { distance: number; intersectedMeshes: string[] } {
    if (!this.scene) {
      return { distance: 0, intersectedMeshes: [] };
    }

    // Calculate distance between sensors
    const distance = Vector3.Distance(sensor1.position, sensor2.position);

    // Create a ray from sensor1 to sensor2
    const direction = sensor2.position.subtract(sensor1.position).normalize();
    const ray = new Ray(sensor1.position, direction, distance);

    // Find all meshes intersected by the ray
    const intersectedMeshes: string[] = [];
    const picks = ray.intersectsMeshes(
      this.scene.meshes.filter(mesh => {
        // Exclude sensors, sensor IP boxes, and sensor links
        return !this.sensors.has(mesh.id) &&
               !this.sensorIPBoxes.has(mesh.id) &&
               !this.sensorLinks.has(mesh.id) &&
               !mesh.id.startsWith('link_') &&
               mesh.isPickable &&
               mesh.isVisible;
      })
    );

    // Collect unique mesh names
    const meshNames = new Set<string>();
    picks.forEach(pick => {
      if (pick.hit && pick.pickedMesh) {
        meshNames.add(pick.pickedMesh.name);
      }
    });

    intersectedMeshes.push(...Array.from(meshNames));

    console.log(`[SCENE-MANAGER] Distance between sensors: ${distance.toFixed(2)} units`);
    console.log(`[SCENE-MANAGER] Intersected meshes:`, intersectedMeshes);

    return { distance, intersectedMeshes };
  }

  /**
   * Load default GLB model from assets into the scene
   */
  private async loadDefaultGLBModel(): Promise<void> {
    if (!this.scene) {
      console.error('Scene is not initialized');
      return;
    }

    const defaultModelPath = 'scene-imports/L20034-MEP-00_23.glb';

    try {
      // Use SceneLoader.ImportMeshAsync for local assets served from public folder
      const result = await SceneLoader.ImportMeshAsync(
        null, // Load all meshes
        environment.rootUrlModel, // Root URL (empty for public folder assets)
        defaultModelPath, // Model path relative to public folder
        this.scene
      );

      console.log('Default GLB model loaded successfully');
      console.log(`   Loaded ${result.meshes.length} meshes`);
      console.log(`   Root mesh: ${result.meshes[0]?.name}`);

      // Center the loaded model properly (same logic as loadGLBModelFromFile)
      if (result.meshes.length > 0) {
        // Get all non-empty meshes (exclude root nodes without geometry)
        const meshesWithGeometry = result.meshes.filter(mesh =>
          mesh.getTotalVertices() > 0
        );

        if (meshesWithGeometry.length > 0) {
          // Calculate the bounding box of all meshes combined
          let minPoint = meshesWithGeometry[0].getBoundingInfo().boundingBox.minimumWorld.clone();
          let maxPoint = meshesWithGeometry[0].getBoundingInfo().boundingBox.maximumWorld.clone();

          meshesWithGeometry.forEach(mesh => {
            const boundingBox = mesh.getBoundingInfo().boundingBox;
            if (boundingBox.minimumWorld.x < minPoint.x) minPoint.x = boundingBox.minimumWorld.x;
            if (boundingBox.minimumWorld.y < minPoint.y) minPoint.y = boundingBox.minimumWorld.y;
            if (boundingBox.minimumWorld.z < minPoint.z) minPoint.z = boundingBox.minimumWorld.z;
            if (boundingBox.maximumWorld.x > maxPoint.x) maxPoint.x = boundingBox.maximumWorld.x;
            if (boundingBox.maximumWorld.y > maxPoint.y) maxPoint.y = boundingBox.maximumWorld.y;
            if (boundingBox.maximumWorld.z > maxPoint.z) maxPoint.z = boundingBox.maximumWorld.z;
          });

          // Calculate the center point of the bounding box
          const center = Vector3.Center(minPoint, maxPoint);
          console.log(`   Model bounding box: min(${minPoint.x.toFixed(2)}, ${minPoint.y.toFixed(2)}, ${minPoint.z.toFixed(2)}) max(${maxPoint.x.toFixed(2)}, ${maxPoint.y.toFixed(2)}, ${maxPoint.z.toFixed(2)})`);
          console.log(`   Model center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);

          // Move the root mesh so that the model center is at origin
          const rootMesh = result.meshes[0];
          const offsetToCenter = center.negate();
          rootMesh.position = offsetToCenter;

          console.log(`   Positioned root mesh at (${offsetToCenter.x.toFixed(2)}, ${offsetToCenter.y.toFixed(2)}, ${offsetToCenter.z.toFixed(2)}) to center model at origin`);

          // Log model dimensions
          const size = maxPoint.subtract(minPoint);
          const maxDimension = Math.max(size.x, size.y, size.z);
          console.log(`   Model dimensions: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
          console.log(`   Max dimension: ${maxDimension.toFixed(2)}`);
        } else {
          // Fallback: just position the root mesh at origin
          const rootMesh = result.meshes[0];
          rootMesh.position = new Vector3(0, 0, 0);
          console.log(`   No geometry found, positioned root mesh at origin`);
        }
      }

      this.logger.info('Default GLB model loaded successfully', 'SceneManager', {
        modelPath: defaultModelPath,
        meshCount: result.meshes.length,
        rootMesh: result.meshes[0]?.name
      });

    } catch (error) {
      this.logger.error(`Failed to load default GLB model: ${(error as Error).message}`, 'SceneManager', { error });
      console.error('Error loading default GLB model:', error);
      console.error('Full error details:', error);
    }
  }

  /**
   * Load GLB model from a file into the scene
   */
  private async loadGLBModelFromFile(file: File): Promise<void> {
    if (!this.scene) {
      console.error('Scene is not initialized');
      return;
    }

    console.log('Loading GLB model from file:', file.name);
    console.log('   File size:', (file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('   File type:', file.type);

    try {
      // Create a URL for the file
      const url = URL.createObjectURL(file);
      console.log('   Created blob URL:', url);

      // Use SceneLoader.ImportMeshAsync with proper parameters
      // Parameters: meshNames, rootUrl, sceneFilename, scene
      const result = await SceneLoader.ImportMeshAsync(
        null, // Load all meshes
        '',   // No root URL needed for blob
        url,  // The blob URL
        this.scene,
        undefined, // onProgress callback
        '.glb' // File extension hint
      );

      // Clean up the object URL
      URL.revokeObjectURL(url);

      console.log('GLB model loaded successfully');
      console.log(`   Loaded ${result.meshes.length} meshes`);
      console.log(`   Root mesh: ${result.meshes[0]?.name}`);

      // Center the loaded model properly
      if (result.meshes.length > 0) {
        // Get all non-empty meshes (exclude root nodes without geometry)
        const meshesWithGeometry = result.meshes.filter(mesh =>
          mesh.getTotalVertices() > 0
        );

        if (meshesWithGeometry.length > 0) {
          // Calculate the bounding box of all meshes combined
          let minPoint = meshesWithGeometry[0].getBoundingInfo().boundingBox.minimumWorld.clone();
          let maxPoint = meshesWithGeometry[0].getBoundingInfo().boundingBox.maximumWorld.clone();

          meshesWithGeometry.forEach(mesh => {
            const boundingInfo = mesh.getBoundingInfo();
            const meshMin = boundingInfo.boundingBox.minimumWorld;
            const meshMax = boundingInfo.boundingBox.maximumWorld;

            minPoint = Vector3.Minimize(minPoint, meshMin);
            maxPoint = Vector3.Maximize(maxPoint, meshMax);
          });

          // Calculate the center point of the bounding box
          const center = Vector3.Center(minPoint, maxPoint);
          console.log(`   Model bounding box: min(${minPoint.x.toFixed(2)}, ${minPoint.y.toFixed(2)}, ${minPoint.z.toFixed(2)}) max(${maxPoint.x.toFixed(2)}, ${maxPoint.y.toFixed(2)}, ${maxPoint.z.toFixed(2)})`);
          console.log(`   Model center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);

          // Move the root mesh so that the model center is at origin
          const rootMesh = result.meshes[0];
          const offsetToCenter = center.negate();
          rootMesh.position = offsetToCenter;

          console.log(`   Positioned root mesh at (${offsetToCenter.x.toFixed(2)}, ${offsetToCenter.y.toFixed(2)}, ${offsetToCenter.z.toFixed(2)}) to center model at origin`);

          // Optional: Auto-scale the model to fit in the view
          const size = maxPoint.subtract(minPoint);
          const maxDimension = Math.max(size.x, size.y, size.z);
          console.log(`   Model dimensions: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
          console.log(`   Max dimension: ${maxDimension.toFixed(2)}`);

          // Uncomment the following lines to auto-scale large models
          // if (maxDimension > 10) {
          //   const scaleFactor = 10 / maxDimension;
          //   rootMesh.scaling = new Vector3(scaleFactor, scaleFactor, scaleFactor);
          //   console.log(`   Applied scaling factor: ${scaleFactor.toFixed(3)}`);
          // }
        } else {
          // Fallback: just position the root mesh at origin
          const rootMesh = result.meshes[0];
          rootMesh.position = new Vector3(0, 0, 0);
          console.log(`   No geometry found, positioned root mesh at origin`);
        }
      }

      this.logger.info('GLB model loaded successfully', 'SceneManager', {
        fileName: file.name,
        meshCount: result.meshes.length,
        rootMesh: result.meshes[0]?.name
      });

    } catch (error) {
      this.logger.error(`Failed to load GLB model: ${(error as Error).message}`, 'SceneManager', { error });
      console.error('Error loading GLB model:', error);
      console.error('Full error details:', error);
      alert(`Failed to load model: ${(error as Error).message}`);
    }
  }

  /**
   * Enable dragging functionality for a sensor
   */
  private enableSensorDragging(sensor: Mesh): void {
    if (!sensor || !this.scene) return;

    // Make sensor pickable for drag interactions
    sensor.isPickable = true;
  }

  /**
   * Check if a mesh is a sensor
   */
  private isSensor(mesh: Mesh): boolean {
    return this.sensors.has(mesh.id);
  }

  /**
   * Start dragging a sensor
   */
  private startSensorDrag(sensor: Mesh, pickPoint: Vector3): void {
    this.isDragging = true;
    this.draggedSensor = sensor;
    this.dragStartPosition = pickPoint.clone();

    // Calculate and store the initial offset between sensor and IP box
    const ipBox = this.sensorIPBoxes.get(sensor.id);
    if (ipBox) {
      this.draggedIPBoxOffset = ipBox.position.subtract(sensor.position);
    }

    // Find the original mesh this sensor was placed on
    const metadata = this.sensorMetadata.get(sensor.id);
    if (metadata && this.scene) {
      this.dragTargetMesh = this.scene.getMeshByName(metadata.meshName) as Mesh;
    }

    // Disable camera controls during drag
    if (this.camera) {
      this.camera.detachControl();
    }

    // Add visual feedback - make sensor slightly transparent during drag
    if (sensor.material && 'alpha' in sensor.material) {
      (sensor.material as any).alpha = 0.7;
    }
  }

  /**
   * Update sensor position during drag, constraining to surface
   */
  private updateSensorDrag(pointerX: number, pointerY: number): void {
    if (!this.isDragging || !this.draggedSensor || !this.scene || !this.camera) return;

    // Cast ray from pointer position
    const pickResult = this.scene.pick(pointerX, pointerY, (mesh) => {
      // Only pick the original mesh this sensor was placed on
      return mesh === this.dragTargetMesh;
    }, false, this.camera);

    if (pickResult && pickResult.hit && pickResult.pickedPoint) {
      const newPosition = pickResult.pickedPoint;
      const normal = pickResult.getNormal(true, true);

      // Update sensor position and orientation
      this.positionAndOrientSensor(this.draggedSensor, newPosition, normal || undefined);

      // Update IP box position maintaining the initial offset
      const ipBox = this.sensorIPBoxes.get(this.draggedSensor.id);
      if (ipBox && this.draggedIPBoxOffset) {
        // Apply the stored offset to the new sensor position
        ipBox.position = this.draggedSensor.position.add(this.draggedIPBoxOffset);
      }

      // Update metadata
      const metadata = this.sensorMetadata.get(this.draggedSensor.id);
      if (metadata) {
        metadata.originalSurfacePoint = newPosition.clone();
        if (normal) {
          metadata.normal = normal.clone();
        }
      }

      // Emit position change event
      this.emitPositionChanged(this.draggedSensor.id, newPosition);
    }
  }

  /**
   * End sensor dragging
   */
  private endSensorDrag(): void {
    if (this.isDragging && this.draggedSensor) {
      if (this.draggedSensor.material && 'alpha' in this.draggedSensor.material) {
        (this.draggedSensor.material as any).alpha = 1.0;
      }

      const finalPosition = this.draggedSensor.position;
      this.logger.info(`Sensor dragged to new position: ${this.draggedSensor.id}`, 'SceneManager', {
        sensorId: this.draggedSensor.id,
        newPosition: { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z }
      });
    }

    // Re-enable camera controls immediately
    if (this.camera && this.canvas) {
      this.camera.attachControl(this.canvas, true);
    }

    this.isDragging = false;
    this.draggedSensor = null;
    this.dragStartPosition = null;
    this.dragTargetMesh = null;
    this.draggedIPBoxOffset = null;
  }

  /**
   * Setup event listeners for mouse and interactions
   */
  private setupEventListeners(): void {
    if (!this.scene || !this.camera) return;

    console.log('Setting up event listeners...');

    // Track camera rotation with optimized throttling
    let lastCameraRotation = this.camera.rotation.clone();
    let rotationThrottle = false;
    let frameCount = 0;

    this.scene.registerBeforeRender(() => {
      if (!this.camera) return;

      frameCount++;
      if (frameCount % 3 !== 0) return;

      const currentRotation = this.camera.rotation;

      if (Math.abs(currentRotation.x - lastCameraRotation.x) > 0.005 ||
        Math.abs(currentRotation.y - lastCameraRotation.y) > 0.005 ||
        Math.abs(currentRotation.z - lastCameraRotation.z) > 0.005) {

        if (!rotationThrottle) {
          rotationThrottle = true;
          requestAnimationFrame(() => { rotationThrottle = false; });

          const rotationPayload: Omit<RotationChangedPayload, 'timestamp'> = {
            rotation: {
              x: currentRotation.x,
              y: currentRotation.y,
              z: currentRotation.z
            },
            meshName: 'mainCamera',
            source: 'camera_rotation'
          };

          this.eventBus.emitRotationChanged(rotationPayload);
          this.logger.debug('Camera rotation changed', 'SceneManager', {
            x: currentRotation.x.toFixed(2),
            y: currentRotation.y.toFixed(2),
            z: currentRotation.z.toFixed(2)
          });

          lastCameraRotation = currentRotation.clone();
        }
      }
    });

    // Handle pointer events for clicks and sensor dragging
    this.scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case 1: // PointerEventTypes.POINTERDOWN
          // Record initial pointer position for click vs drag detection
          this.pointerDownPosition = { x: this.scene!.pointerX, y: this.scene!.pointerY };
          this.hasMouseMoved = false;
          // Note: We don't start sensor drag immediately on POINTERDOWN,
          // we wait for POINTERMOVE to determine if it's a drag or just a click
          break;

        case 4: // PointerEventTypes.POINTERMOVE
          // Check if mouse has moved beyond threshold
          if (this.pointerDownPosition && !this.hasMouseMoved) {
            const deltaX = Math.abs(this.scene!.pointerX - this.pointerDownPosition.x);
            const deltaY = Math.abs(this.scene!.pointerY - this.pointerDownPosition.y);
            if (deltaX > this.DRAG_THRESHOLD || deltaY > this.DRAG_THRESHOLD) {
              this.hasMouseMoved = true;

              // Check if we should start dragging a sensor
              if (!this.isDragging && this.pointerDownPosition) {
                const pickResult = this.scene!.pick(
                  this.pointerDownPosition.x,
                  this.pointerDownPosition.y,
                  (mesh) => {
                    return mesh.isPickable && mesh.isVisible;
                  },
                  false,
                  this.camera!
                );

                if (pickResult && pickResult.hit && pickResult.pickedMesh && pickResult.pickedPoint) {
                  // Check if it's a sensor and start dragging
                  if (this.isSensor(pickResult.pickedMesh as Mesh)) {
                    this.startSensorDrag(pickResult.pickedMesh as Mesh, pickResult.pickedPoint);
                  }
                }
              }
            }
          }

          if (this.isDragging) {
            this.updateSensorDrag(this.scene!.pointerX, this.scene!.pointerY);
          }
          break;

        case 2: // PointerEventTypes.POINTERUP
        case 16: // PointerEventTypes.POINTERLEAVE (mouse leaves canvas)
          if (this.isDragging) {
            this.endSensorDrag();
          } else if (pointerInfo.type === 2 && !this.hasMouseMoved) { // Only handle click for POINTERUP, not POINTERLEAVE, and only if mouse didn't move (not a drag)
            // Handle different click behaviors based on current mode
            if (this.isInSensorInsertionMode && this.currentSensorType) {
              // In sensor insertion mode: create sensor on click
              const pickResult = this.scene!.pick(
                this.scene!.pointerX,
                this.scene!.pointerY,
                (mesh) => {
                  return mesh.isPickable && mesh.isVisible && !this.isSensor(mesh as Mesh);
                },
                false, // fastCheck
                this.camera!
              );

              if (pickResult && pickResult.hit && pickResult.pickedMesh && pickResult.pickedPoint) {
                console.log(`[SCENE-MANAGER] Creating sensor in insertion mode:`, pickResult);

                // Calculate normal at the picked point
                const normal = pickResult.getNormal(true, true);

                // Create sensor directly
                this.createSensor(this.currentSensorType, pickResult.pickedPoint, pickResult.pickedMesh.name, normal || undefined);
              }
            } else {
              // Normal mode: check for both regular meshes and sensors
              const pickResult = this.scene!.pick(
                this.scene!.pointerX,
                this.scene!.pointerY,
                (mesh) => {
                  return mesh.isPickable && mesh.isVisible;
                },
                false, // fastCheck
                this.camera!
              );

              if (pickResult && pickResult.hit && pickResult.pickedMesh && pickResult.pickedPoint) {
                const pickedMesh = pickResult.pickedMesh as Mesh;

                if (this.isSensor(pickedMesh)) {
                  // Sensor clicked

                  // If in link mode, handle sensor selection for linking
                  if (this.isInSensorLinkMode && this.currentLinkType) {
                    const clickedSensorInfo = this.getSensorInfoById(pickedMesh.id);
                    if (clickedSensorInfo) {
                      this.handleSensorClickInLinkMode(clickedSensorInfo);
                    }
                  }
                  // If in distance mode, handle sensor selection for distance calculation
                  else if (this.isInSensorDistanceMode) {
                    const clickedSensorInfo = this.getSensorInfoById(pickedMesh.id);
                    if (clickedSensorInfo) {
                      this.handleSensorClickInDistanceMode(clickedSensorInfo);
                    }
                  }
                  else {
                    // Normal mode: highlight sensor and emit sensor-specific event

                    // Highlight the clicked sensor
                    this.highlightSensor(pickedMesh);

                    const clickPayload: Omit<MeshClickedPayload, 'timestamp'> = {
                      meshName: pickedMesh.name, // Use sensor name as mesh name
                      position: pickResult.pickedPoint,
                      normal: undefined, // Sensors don't have meaningful normals for clicking
                      source: 'scene_manager'
                    };

                    this.eventBus.emitMeshClicked(clickPayload);
                    this.logger.info(`Sensor clicked: ${pickedMesh.id}`, 'SceneManager', {
                      sensorId: pickedMesh.id,
                      position: clickPayload.position
                    });
                  }
                } else {
                  // Regular mesh clicked: highlight it and emit mesh clicked event

                  // Clear sensor highlight when clicking on a regular mesh
                  this.clearSensorHighlight();

                  // Highlight the clicked mesh
                  this.highlightMesh(pickedMesh);

                  // Calculate normal at the picked point
                  const normal = pickResult.getNormal(true, true); // Get world-space normal

                  const clickPayload: Omit<MeshClickedPayload, 'timestamp'> = {
                    meshName: pickedMesh.name,
                    position: pickResult.pickedPoint,
                    normal: normal || undefined,
                    source: 'mouse_click'
                  };

                  this.eventBus.emitMeshClicked(clickPayload);
                  this.logger.info(`Mesh clicked: ${pickedMesh.name}`, 'SceneManager', {
                    meshName: pickedMesh.name,
                    position: clickPayload.position,
                    normal: normal
                  });
                }
              } else {
                // Click on empty space: clear all highlights
                this.clearHighlight();
                this.clearSensorHighlight();
                console.log('Clicked on empty space - highlights cleared');
              }
            }
          }

          // Reset click vs drag tracking variables
          this.pointerDownPosition = null;
          this.hasMouseMoved = false;
          break;
      }
    });

    // Add keyboard event listener for ESC key to cancel drag
    if (this.canvas) {
      this.canvas.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && this.isDragging) {
          this.endSensorDrag();
        }
      });

      // Make canvas focusable to receive keyboard events
      this.canvas.tabIndex = 0;
    }
  }

  /**
   * Setup event bus listeners for external events
   */
  private setupEventBusListeners(): void {
    // Listen for mesh clicked events from tree panel (sensor selection)
    this.eventBus.meshClicked$.subscribe((payload: MeshClickedPayload) => {
      if (payload.source === 'tree_panel' && this.scene) {
        // Find the sensor mesh by name
        const sensorMesh = Array.from(this.sensors.values()).find(mesh => mesh.name === payload.meshName);
        if (sensorMesh) {
          // Highlight the sensor
          this.highlightSensor(sensorMesh);
          this.logger.info(`Sensor highlighted from tree panel: ${sensorMesh.id}`, 'SceneManager');
        }
      }
    });

    // Listen for mesh visibility changes
    this.eventBus.meshVisibilityChanged$.subscribe((payload: MeshVisibilityChangedPayload) => {
      if (!this.scene) return;

      this.logger.info(`Mesh visibility change requested: ${payload.meshName} -> ${payload.visible}`);

      // Find the mesh by name
      const mesh = this.scene.getMeshByName(payload.meshName);
      if (mesh) {
        mesh.isVisible = payload.visible;
        this.logger.info(
          `Mesh visibility changed: ${payload.meshName} is now ${payload.visible ? 'visible' : 'hidden'}`,
          'SceneManager',
          { meshName: payload.meshName, visible: payload.visible }
        );
      } else {
        this.logger.warn(
          `Mesh not found: ${payload.meshName}`,
          'SceneManager',
          { meshName: payload.meshName }
        );
      }
    });

    // Listen for model import requests
    this.eventBus.modelImportRequested$.subscribe((payload: ModelImportRequestedPayload) => {
      this.logger.info('Model import requested:', 'SceneManager', { fileName: payload.file.name });
      this.loadGLBModelFromFile(payload.file);
    });

    // Listen for sensor creation requests
    this.eventBus.sensorCreationRequested$.subscribe((payload: SensorCreationRequestedPayload) => {
      this.logger.info(`Sensor creation requested: ${payload.sensorType} at mesh ${payload.meshName}`);
      this.createSensor(payload.sensorType, payload.position, payload.meshName, payload.normal);
    });

    // Listen for sensor link requests
    this.eventBus.sensorLinkRequested$.subscribe((payload: SensorLinkRequestedPayload) => {
      const linkType = payload.linkType || SensorLinkType.PRIMARY;
      this.logger.info(`Sensor link requested: ${payload.sensor1.id} <-> ${payload.sensor2.id} (${linkType})`, 'SceneManager');
      this.createSensorLink(payload.sensor1, payload.sensor2, linkType);
    });

    // Listen for sensor insertion mode changes
    this.eventBus.sensorInsertionModeChanged$.subscribe((payload: SensorInsertionModeChangedPayload) => {
      this.isInSensorInsertionMode = payload.isActive;
      this.currentSensorType = payload.sensorType;
      this.logger.info(`[SCENE-MANAGER] Sensor insertion mode ${payload.isActive ? 'activated' : 'deactivated'}${payload.sensorType ? ` for type: ${payload.sensorType}` : ''}`);
    });

    // Listen for sensor link mode changes
    this.eventBus.sensorLinkModeChanged$.subscribe((payload: SensorLinkModeChangedPayload) => {
      this.isInSensorLinkMode = payload.isActive;
      this.currentLinkType = payload.linkType;
      this.linkModeSensors = [];
      this.logger.info(`[SCENE-MANAGER] Sensor link mode ${payload.isActive ? 'activated' : 'deactivated'}${payload.linkType ? ` for type: ${payload.linkType}` : ''}`);
    });

    // Listen for sensor distance mode changes
    this.eventBus.sensorDistanceModeChanged$.subscribe((payload: SensorDistanceModeChangedPayload) => {
      this.isInSensorDistanceMode = payload.isActive;
      this.distanceModeSensors = [];
      this.logger.info(`[SCENE-MANAGER] Sensor distance mode ${payload.isActive ? 'activated' : 'deactivated'}`);
    });

    this.logger.info('Event bus listeners configured', 'SceneManager');
  }

  /**
   * Start the BabylonJS render loop
   */
  private startRenderLoop(): void {
    if (!this.engine || !this.scene) return;

    this.logger.info('Starting render loop...', 'SceneManager');

    this.engine.runRenderLoop(() => {
      if (this.scene && !this.isDisposed && !(this.scene as any).isDisposed) {
        this.scene.render();
      }
    });
  }

  /**
   * Emit scene ready event
   */
  private emitSceneReady(): void {
    if (!this.scene) return;

    const sceneReadyPayload: Omit<SceneReadyPayload, 'timestamp'> = {
      meshCount: this.scene.meshes.length,
      cameraType: this.camera?.getClassName() || 'unknown',
      source: 'scene_manager'
    };

    this.eventBus.emitSceneReady(sceneReadyPayload);
    this.logger.info('Scene is ready for interaction', 'SceneManager', {
      meshCount: sceneReadyPayload.meshCount,
      cameraType: sceneReadyPayload.cameraType
    });
  }

  getScene(): Scene | null {
    return this.scene;
  }

  getEngine(): Engine | null {
    return this.engine;
  }

  getCamera(): ArcRotateCamera | null {
    return this.camera;
  }

  getMainCube(): any {
    return this.mainCube;
  }

  isReady(): boolean {
    const initialized = this.isInitialized;
    const hasScene = !!this.scene;
    const sceneNotDisposed = this.scene ? !(this.scene as any).isDisposed : false;
    const ready = initialized && hasScene && sceneNotDisposed;

    if (ready !== this.lastReadyState) {
      console.log(`SceneManager ready state changed: ${ready}`);
      console.log(`   isInitialized: ${initialized}`);
      console.log(`   hasScene: ${hasScene}`);
      console.log(`   sceneNotDisposed: ${sceneNotDisposed}`);
      this.lastReadyState = ready;
    }
    return ready;
  }

  render(): void {
    if (this.scene && !this.isDisposed && !(this.scene as any).isDisposed) {
      this.scene.render();
    }
  }

  emitPositionChanged(meshName: string, position: Vector3): void {
    const positionPayload: Omit<PositionChangedPayload, 'timestamp'> = {
      position: {
        x: position.x,
        y: position.y,
        z: position.z
      },
      meshName,
      source: 'scene_manager'
    };

    this.eventBus.emitPositionChanged(positionPayload);
  }

  /**
   * Get all created sensors
   */
  getSensors(): Map<string, Mesh> {
    return new Map(this.sensors);
  }

  /**
   * Get sensor by ID
   */
  getSensor(sensorId: string): Mesh | undefined {
    return this.sensors.get(sensorId);
  }

  /**
   * Remove sensor by ID
   */
  removeSensor(sensorId: string): boolean {
    const sensor = this.sensors.get(sensorId);
    if (sensor && this.scene) {
      // Dispose of the sensor
      sensor.dispose();
      this.sensors.delete(sensorId);

      // Dispose of the IP box if it exists
      const ipBox = this.sensorIPBoxes.get(sensorId);
      if (ipBox) {
        ipBox.dispose();
        this.sensorIPBoxes.delete(sensorId);
      }

      this.sensorMetadata.delete(sensorId);
      this.logger.info(`Sensor removed: ${sensorId}`, 'SceneManager', { sensorId });
      return true;
    }
    return false;
  }

  /**
   * Remove all sensors
   */
  removeAllSensors(): void {
    this.sensors.forEach((sensor, sensorId) => {
      sensor.dispose();

      // Dispose of the IP box if it exists
      const ipBox = this.sensorIPBoxes.get(sensorId);
      if (ipBox) {
        ipBox.dispose();
      }

      this.logger.info(`Sensor removed: ${sensorId}`, 'SceneManager', { sensorId });
    });
    this.sensors.clear();
    this.sensorIPBoxes.clear();
    this.sensorMetadata.clear();
  }

  /**
   * Get sensor count
   */
  getSensorCount(): number {
    return this.sensors.size;
  }

  /**
   * Get sensor metadata by ID
   */
  getSensorMetadata(sensorId: string): { meshName: string; normal?: Vector3; originalSurfacePoint: Vector3 } | undefined {
    return this.sensorMetadata.get(sensorId);
  }

  /**
   * Check if a sensor is currently being dragged
   */
  isDraggingSensor(): boolean {
    return this.isDragging;
  }

  /**
   * Get the ID of the sensor currently being dragged
   */
  getDraggedSensorId(): string | null {
    return this.draggedSensor?.id || null;
  }

  /**
   * Get IP box for a specific sensor
   */
  getSensorIPBox(sensorId: string): Mesh | undefined {
    return this.sensorIPBoxes.get(sensorId);
  }

  /**
   * Get all sensor IP boxes
   */
  getSensorIPBoxes(): Map<string, Mesh> {
    return new Map(this.sensorIPBoxes);
  }

  /**
   * Get the currently highlighted mesh
   */
  getHighlightedMesh(): Mesh | null {
    return this.highlightedMesh;
  }

  /**
   * Clear current mesh highlight
   */
  clearMeshHighlight(): void {
    this.clearHighlight();
  }

  /**
   * Get the currently highlighted sensor
   */
  getHighlightedSensor(): Mesh | null {
    return this.highlightedSensor;
  }

  /**
   * Clear current sensor highlight (public method)
   */
  clearCurrentSensorHighlight(): void {
    this.clearSensorHighlight();
  }

  /**
   * Highlight a sensor by ID
   */
  highlightSensorById(sensorId: string): void {
    const sensor = this.sensors.get(sensorId);
    if (sensor) {
      this.highlightSensor(sensor);
    }
  }

  /**
   * Highlight a sensor by name
   */
  highlightSensorByName(sensorName: string): void {
    const sensor = Array.from(this.sensors.values()).find(mesh => mesh.name === sensorName);
    if (sensor) {
      this.highlightSensor(sensor);
    }
  }

  /**
   * Get sensor info by ID
   */
  private getSensorInfoById(sensorId: string): SensorInfo | null {
    const metadata = this.sensorMetadata.get(sensorId);
    const sensor = this.sensors.get(sensorId);

    if (!metadata || !sensor) {
      return null;
    }

    return {
      id: sensorId,
      type: this.getSensorTypeFromId(sensorId),
      name: sensor.name,
      position: sensor.position.clone(),
      meshName: metadata.meshName,
      normal: metadata.normal?.clone(),
      createdAt: Date.now() // We don't store this, so using current time
    };
  }

  /**
   * Get sensor type from sensor ID
   */
  private getSensorTypeFromId(sensorId: string): SensorType {
    // Sensor IDs are formatted as: proximity_1234567890_meshName or similar
    if (sensorId.startsWith('proximity_')) return SensorType.PROXIMITY;
    if (sensorId.startsWith('motion_')) return SensorType.MOTION;
    if (sensorId.startsWith('temperature_')) return SensorType.TEMPERATURE;
    if (sensorId.startsWith('camera_')) return SensorType.CAMERA;
    return SensorType.PROXIMITY; // Default
  }

  /**
   * Handle sensor click during link mode
   */
  private handleSensorClickInLinkMode(sensorInfo: SensorInfo): void {
    console.log('[SCENE-MANAGER] Sensor clicked in link mode:', sensorInfo.id);

    // Highlight the clicked sensor
    const sensorMesh = this.sensors.get(sensorInfo.id);
    if (sensorMesh) {
      this.highlightSensor(sensorMesh);
    }

    // Add sensor to link mode selection
    this.linkModeSensors.push(sensorInfo);

    // If we have 2 sensors, create the link
    if (this.linkModeSensors.length === 2) {
      const [sensor1, sensor2] = this.linkModeSensors;

      console.log(`[SCENE-MANAGER] Creating ${this.currentLinkType} link between ${sensor1.id} and ${sensor2.id}`);

      // Create the link with the current link type
      this.createSensorLink(sensor1, sensor2, this.currentLinkType!);

      // Reset link mode state
      this.linkModeSensors = [];
      this.isInSensorLinkMode = false;
      this.currentLinkType = null;

      // Notify that link mode is done
      this.eventBus.emitSensorLinkModeChanged({
        isActive: false,
        linkType: null,
        source: 'scene_manager'
      });
    } else {
      console.log(`[SCENE-MANAGER] Waiting for second sensor. Selected: ${this.linkModeSensors.length}/2`);
    }
  }

  /**
   * Handle sensor click during distance calculation mode
   */
  private handleSensorClickInDistanceMode(sensorInfo: SensorInfo): void {
    console.log('[SCENE-MANAGER] Sensor clicked in distance mode:', sensorInfo.id);

    // Highlight the clicked sensor
    const sensorMesh = this.sensors.get(sensorInfo.id);
    if (sensorMesh) {
      this.highlightSensor(sensorMesh);
    }

    // Add sensor to distance mode selection
    this.distanceModeSensors.push(sensorInfo);

    // If we have 2 sensors, calculate distance and find intersected meshes
    if (this.distanceModeSensors.length === 2) {
      const [sensor1, sensor2] = this.distanceModeSensors;

      console.log(`[SCENE-MANAGER] Calculating distance between ${sensor1.id} and ${sensor2.id}`);

      // Calculate distance and get intersected meshes
      const { distance, intersectedMeshes } = this.calculateSensorDistance(sensor1, sensor2);

      // Emit the result
      this.eventBus.emitSensorDistanceCalculated({
        sensor1: sensor1,
        sensor2: sensor2,
        distance: distance,
        intersectedMeshes: intersectedMeshes,
        source: 'scene_manager'
      });

      // Reset distance mode state
      this.distanceModeSensors = [];
      this.isInSensorDistanceMode = false;

      // Notify that distance mode is done
      this.eventBus.emitSensorDistanceModeChanged({
        isActive: false,
        source: 'scene_manager'
      });
    } else {
      console.log(`[SCENE-MANAGER] Waiting for second sensor. Selected: ${this.distanceModeSensors.length}/2`);
    }
  }

  dispose(): void {
    if (this.isDisposed) return;

    console.log('Disposing SceneManager...');

    // Clean up sensors
    this.removeAllSensors();

    // Clean up highlighting
    this.clearHighlight();
    this.clearSensorHighlight();
    if (this.highlightMaterial) {
      this.highlightMaterial.dispose();
      this.highlightMaterial = null;
    }

    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }

    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
    }

    this.canvas = null;
    this.camera = null;
    this.axesCamera = null;
    this.mainCube = null;
    this.referenceAxes = null;
    this.sensors.clear();
    this.sensorIPBoxes.clear();
    this.sensorMetadata.clear();

    // Clear drag state and re-enable camera if needed
    if (this.isDragging && this.camera && this.canvas) {
      (this.camera as ArcRotateCamera).attachControl(this.canvas, true);
    }
    this.isDragging = false;
    this.draggedSensor = null;
    this.dragStartPosition = null;
    this.dragTargetMesh = null;

    // Clear click vs drag tracking
    this.pointerDownPosition = null;
    this.hasMouseMoved = false;

    // Dispose heatmap service
    this.heatmapService.dispose();

    this.isInitialized = false;
    this.isDisposed = true;

    this.logger.info('SceneManager disposed', 'SceneManager');
  }
}

