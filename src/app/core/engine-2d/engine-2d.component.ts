/**
 * @fileoverview Engine 2D Component - Renders 2D canvas
 *
 * Provides a 2D canvas rendering interface
 */

import { Component, OnInit, OnDestroy, ViewChild, ElementRef, signal, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Vector3 } from '@babylonjs/core';
import { EventBusService } from '../services/event-bus.service';
import { SensorType, SensorInfo, SensorLinkType } from '../models/types.model';
import { SENSOR_CONFIGS } from '../models/sensor-configs';

@Component({
  selector: 'app-engine-2d',
  imports: [CommonModule],
  templateUrl: './engine-2d.component.html',
  styleUrl: './engine-2d.component.scss'
})
export class Engine2DComponent implements OnInit, OnDestroy {
  @ViewChild('canvas2d', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  // Outputs
  canvasReady = output<void>();
  error = output<Error>();

  // State
  protected isReady = signal(false);
  private ctx: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private plantMapImage: HTMLImageElement | null = null;
  private imageLoaded = false;

  // Sensor state
  private eventBus = inject(EventBusService);
  private isInSensorInsertionMode = false;
  private currentSensorType: SensorType | null = null;
  private sensors: Map<string, { x: number; y: number; type: SensorType; id: string }> = new Map();
  private sensorRadius = 15; // Radius of sensor circles in pixels

  // Sensor link mode state
  private isInSensorLinkMode = false;
  private currentLinkType: SensorLinkType | null = null;
  private linkModeSensors: SensorInfo[] = []; // Track selected sensors during link mode
  private sensorLinks: Map<string, { sensor1Id: string; sensor2Id: string; linkType: SensorLinkType }> = new Map();

  // Drag state
  private isDragging = false;
  private draggedSensor: { x: number; y: number; type: SensorType; id: string } | null = null;
  private dragStartPosition: { x: number; y: number } | null = null;

  // Click vs Drag detection
  private pointerDownPosition: { x: number; y: number } | null = null;
  private hasMouseMoved = false;
  private readonly DRAG_THRESHOLD = 5; // pixels

  // Sensor selection and highlighting
  private selectedSensor: { x: number; y: number; type: SensorType; id: string } | null = null;

  ngOnInit(): void {
    this.initializeCanvas();
    this.setupEventBusListeners();
  }

  ngOnDestroy(): void {
    // Cancel animation frame
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  /**
   * Initialize the 2D canvas
   */
  private initializeCanvas(): void {
    try {
      const canvas = this.canvasRef.nativeElement;
      this.ctx = canvas.getContext('2d');

      if (!this.ctx) {
        throw new Error('Failed to get 2D rendering context');
      }

      // Set canvas size
      this.resizeCanvas();

      // Add resize listener
      window.addEventListener('resize', () => this.resizeCanvas());

      // Load plant map image
      this.loadPlantMapImage();

      // Setup canvas click event
      this.setupCanvasEvents();

      // Start rendering
      this.isReady.set(true);
      this.canvasReady.emit();
      this.render();

      console.log('2D Canvas initialized successfully');
    } catch (err) {
      console.error('Failed to initialize 2D canvas:', err);
      this.error.emit(err as Error);
    }
  }

  /**
   * Load the plant map image
   */
  private loadPlantMapImage(): void {
    this.plantMapImage = new Image();
    this.plantMapImage.onload = () => {
      this.imageLoaded = true;
      this.render();
      console.log('Plant map image loaded successfully');
    };
    this.plantMapImage.onerror = (err) => {
      console.error('Failed to load plant map image:', err);
      this.error.emit(new Error('Failed to load plant-map.png'));
    };
    this.plantMapImage.src = '/plant-map.png';
  }

  /**
   * Resize canvas to match container size
   */
  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    const container = canvas.parentElement;

    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;

      // Re-render after resize
      if (this.isReady()) {
        this.render();
      }
    }
  }

  /**
   * Render the 2D canvas
   */
  private render(): void {
    if (!this.ctx) return;

    const canvas = this.canvasRef.nativeElement;
    const ctx = this.ctx;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fill background
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw the plant map image if loaded
    if (this.imageLoaded && this.plantMapImage) {
      const padding = 20;
      const availableWidth = canvas.width - (padding * 2);
      const availableHeight = canvas.height - (padding * 2);

      // Calculate scaled dimensions maintaining aspect ratio
      const imageAspectRatio = this.plantMapImage.width / this.plantMapImage.height;
      let drawWidth = availableWidth;
      let drawHeight = drawWidth / imageAspectRatio;

      // If height exceeds available space, scale by height instead
      if (drawHeight > availableHeight) {
        drawHeight = availableHeight;
        drawWidth = drawHeight * imageAspectRatio;
      }

      // Center the image vertically and horizontally
      const x = (canvas.width - drawWidth) / 2;
      const y = (canvas.height - drawHeight) / 2;

      // Draw the image
      ctx.drawImage(this.plantMapImage, x, y, drawWidth, drawHeight);
    } else {
      // Draw loading text if image not yet loaded
      ctx.fillStyle = '#ffffff';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Loading plant map...', canvas.width / 2, canvas.height / 2);
    }

    // Draw sensors on top of the image
    this.drawSensors();
  }

  /**
   * Get the 2D rendering context (for external use)
   */
  public getContext(): CanvasRenderingContext2D | null {
    return this.ctx;
  }

  /**
   * Get canvas element (for external use)
   */
  public getCanvas(): HTMLCanvasElement {
    return this.canvasRef.nativeElement;
  }

  /**
   * Setup event bus listeners
   */
  private setupEventBusListeners(): void {
    // Listen for sensor insertion mode changes
    this.eventBus.sensorInsertionModeChanged$.subscribe((payload) => {
      this.isInSensorInsertionMode = payload.isActive;
      this.currentSensorType = payload.sensorType;

      console.log('[ENGINE-2D] Sensor insertion mode changed:', {
        isActive: this.isInSensorInsertionMode,
        sensorType: this.currentSensorType
      });

      // Update cursor style
      if (this.canvasRef?.nativeElement) {
        this.canvasRef.nativeElement.style.cursor = this.isInSensorInsertionMode ? 'crosshair' : 'default';
      }
    });

    // Listen for sensor link mode changes
    this.eventBus.sensorLinkModeChanged$.subscribe((payload) => {
      this.isInSensorLinkMode = payload.isActive;
      this.currentLinkType = payload.linkType;
      this.linkModeSensors = []; // Reset selected sensors

      console.log('[ENGINE-2D] Sensor link mode changed:', {
        isActive: this.isInSensorLinkMode,
        linkType: this.currentLinkType
      });

      // Update cursor style
      if (this.canvasRef?.nativeElement) {
        this.canvasRef.nativeElement.style.cursor = this.isInSensorLinkMode ? 'pointer' :
          (this.isInSensorInsertionMode ? 'crosshair' : 'default');
      }

      // Re-render to clear any temporary visual feedback
      this.render();
    });

    // Listen for mesh clicked events from other components (e.g., tree panel)
    this.eventBus.meshClicked$.subscribe((payload) => {
      if (payload.source !== 'engine_2d') {
        if (payload.meshName === '') {
          this.selectedSensor = null;
        } else {
          let sensor = this.sensors.get(payload.meshName);

          if (sensor) {
            this.selectedSensor = sensor;
          } else {
            this.selectedSensor = null;
          }
        }
        // Re-render to show selection changes
        this.render();
      }
    });
  }

  /**
   * Setup canvas events for clicks, dragging, and hover
   */
  private setupCanvasEvents(): void {
    const canvas = this.canvasRef.nativeElement;

    // Mouse down event - record initial position for click vs drag detection
    canvas.addEventListener('mousedown', (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;

      // Record initial pointer position for click vs drag detection
      this.pointerDownPosition = { x, y };
      this.hasMouseMoved = false;
    });

    // Mouse move event - handle dragging and hover
    canvas.addEventListener('mousemove', (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;

      // Check if mouse has moved beyond threshold
      if (this.pointerDownPosition && !this.hasMouseMoved) {
        const deltaX = Math.abs(x - this.pointerDownPosition.x);
        const deltaY = Math.abs(y - this.pointerDownPosition.y);
        if (deltaX > this.DRAG_THRESHOLD || deltaY > this.DRAG_THRESHOLD) {
          this.hasMouseMoved = true;

          // Check if we should start dragging a sensor
          if (!this.isDragging && this.pointerDownPosition) {
            const sensorAtPosition = this.getSensorAtPosition(this.pointerDownPosition.x, this.pointerDownPosition.y);
            if (sensorAtPosition) {
              this.startSensorDrag(sensorAtPosition, this.pointerDownPosition);
            }
          }
        }
      }

      // Update drag position if dragging
      if (this.isDragging) {
        this.updateSensorDrag(x, y);
      }

      // Handle hover feedback for different modes
      if (!this.isDragging) {
        const hoveredSensor = this.getSensorAtPosition(x, y);

        if (this.isInSensorLinkMode) {
          canvas.style.cursor = hoveredSensor ? 'pointer' : 'default';
        } else if (hoveredSensor) {
          canvas.style.cursor = 'move';
        } else {
          canvas.style.cursor = this.isInSensorInsertionMode ? 'crosshair' : 'default';
        }
      }
    });

    // Mouse up event - handle click or end drag
    canvas.addEventListener('mouseup', (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;

      if (this.isDragging) {
        this.endSensorDrag();
      } else if (!this.hasMouseMoved) {
        // Handle click (not drag)
        this.handleCanvasClick(x, y);
      }

      // Reset pointer tracking
      this.pointerDownPosition = null;
      this.hasMouseMoved = false;
    });

    // Mouse leave event - end drag if mouse leaves canvas
    canvas.addEventListener('mouseleave', () => {
      if (this.isDragging) {
        this.endSensorDrag();
      }
      this.pointerDownPosition = null;
      this.hasMouseMoved = false;
    });

    // Keyboard event listener for ESC key to cancel drag
    canvas.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.isDragging) {
        this.endSensorDrag();
      }
    });

    // Make canvas focusable to receive keyboard events
    canvas.tabIndex = 0;
  }

  /**
   * Handle canvas click events (not drag)
   */
  private handleCanvasClick(x: number, y: number): void {
    // Handle sensor link mode
    if (this.isInSensorLinkMode && this.currentLinkType) {
      this.handleSensorClickInLinkMode(x, y);
      return;
    }

    // Handle sensor insertion mode
    if (this.isInSensorInsertionMode && this.currentSensorType) {
      this.createSensor(x, y, this.currentSensorType);
      return;
    }

    // Normal mode: handle sensor selection/deselection
    const clickedSensor = this.getSensorAtPosition(x, y);

    if (clickedSensor) {
      // Sensor clicked - select it
      this.selectSensor(clickedSensor);
    } else {
      // Empty area clicked - deselect any selected sensor
      this.deselectSensor();
    }
  }

  /**
   * Create a sensor at the specified position
   */
  private createSensor(x: number, y: number, sensorType: SensorType): void {
    const sensorId = `${sensorType}_${Date.now()}_2d`;
    const config = SENSOR_CONFIGS[sensorType];

    // Store sensor data
    this.sensors.set(sensorId, { x, y, type: sensorType, id: sensorId });

    console.log('[ENGINE-2D] Sensor created:', {
      id: sensorId,
      type: sensorType,
      position: { x, y },
      color: config.color
    });

    // Emit sensor created event
    const sensorInfo: SensorInfo = {
      id: sensorId,
      type: sensorType,
      name: `${sensorType}_2d`,
      position: { x, y, z: 0 } as any, // 2D position
      meshName: '2d_canvas',
      createdAt: Date.now()
    };

    this.eventBus.emitSensorCreated({ sensor: sensorInfo });

    // Re-render canvas to show new sensor
    this.render();
  }

  /**
   * Draw all sensors on the canvas
   */
  private drawSensors(): void {
    if (!this.ctx) return;

    const ctx = this.ctx;

    // Draw sensor links first (so they appear behind sensors)
    this.drawSensorLinks();

    this.sensors.forEach((sensor) => {
      const config = SENSOR_CONFIGS[sensor.type];

      // Check if sensor is selected in link mode
      const isSelectedInLinkMode = this.linkModeSensors.some(s => s.id === sensor.id);

      // Check if sensor is selected (clicked)
      const isSelected = this.selectedSensor?.id === sensor.id;

      // Check if sensor is being dragged
      const isBeingDragged = this.isDragging && this.draggedSensor?.id === sensor.id;

      // Set transparency for dragged sensor
      const originalAlpha = ctx.globalAlpha;
      if (isBeingDragged) {
        ctx.globalAlpha = 0.7;
      }

      // Draw sensor circle
      ctx.beginPath();
      ctx.arc(sensor.x, sensor.y, this.sensorRadius, 0, 2 * Math.PI);
      ctx.fillStyle = config.color;
      ctx.fill();

      // Highlight sensors with different borders based on state
      if (isBeingDragged) {
        ctx.strokeStyle = '#ffff00'; // Yellow border for dragged sensor
        ctx.lineWidth = 3;
      } else if (isSelected) {
        ctx.strokeStyle = '#ffff00'; // Yellow border for selected sensor (same as drag for consistency)
        ctx.lineWidth = 3;
      } else if (isSelectedInLinkMode) {
        ctx.strokeStyle = '#00ff00'; // Green border for link mode selection
        ctx.lineWidth = 4;
      } else {
        ctx.strokeStyle = '#ffffff'; // White border for normal sensor
        ctx.lineWidth = 2;
      }
      ctx.stroke();      // Draw sensor label
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sensor.type.charAt(0).toUpperCase(), sensor.x, sensor.y);

      // Restore original alpha
      ctx.globalAlpha = originalAlpha;
    });
  }

  /**
   * Check if a point is inside a sensor circle
   */
  private getSensorAtPosition(x: number, y: number): { x: number; y: number; type: SensorType; id: string } | null {
    for (const [id, sensor] of this.sensors.entries()) {
      const distance = Math.sqrt(Math.pow(x - sensor.x, 2) + Math.pow(y - sensor.y, 2));
      if (distance <= this.sensorRadius) {
        return sensor;
      }
    }
    return null;
  }

  /**
   * Handle sensor click during link mode
   */
  private handleSensorClickInLinkMode(x: number, y: number): void {
    const clickedSensor = this.getSensorAtPosition(x, y);

    if (!clickedSensor) {
      console.log('[ENGINE-2D] No sensor at click position');
      return;
    }

    console.log('[ENGINE-2D] Sensor clicked in link mode:', clickedSensor.id);

    // Create SensorInfo from clicked sensor
    const sensorInfo: SensorInfo = {
      id: clickedSensor.id,
      type: clickedSensor.type,
      name: `${clickedSensor.type}_2d`,
      position: { x: clickedSensor.x, y: clickedSensor.y, z: 0 } as any,
      meshName: '2d_canvas',
      createdAt: Date.now()
    };

    // Add sensor to link mode selection
    this.linkModeSensors.push(sensorInfo);

    // If we have 2 sensors, create the link
    if (this.linkModeSensors.length === 2) {
      const sensor1 = this.linkModeSensors[0];
      const sensor2 = this.linkModeSensors[1];

      console.log('[ENGINE-2D] Creating link between sensors:', {
        sensor1: sensor1.id,
        sensor2: sensor2.id,
        linkType: this.currentLinkType
      });

      // Create the link
      this.createSensorLink(sensor1, sensor2, this.currentLinkType || SensorLinkType.PRIMARY);

      // Emit link requested event
      this.eventBus.emitSensorLinkRequested({
        sensor1,
        sensor2,
        linkType: this.currentLinkType || SensorLinkType.PRIMARY
      });

      // Reset selection for next link
      this.linkModeSensors = [];
    } else {
      console.log('[ENGINE-2D] First sensor selected, waiting for second sensor');
    }

    // Re-render to show selection
    this.render();
  }

  /**
   * Create a link between two sensors
   */
  private createSensorLink(sensor1: SensorInfo, sensor2: SensorInfo, linkType: SensorLinkType): void {
    const linkId = `link_${sensor1.id}_${sensor2.id}`;

    // Store link data
    this.sensorLinks.set(linkId, {
      sensor1Id: sensor1.id,
      sensor2Id: sensor2.id,
      linkType
    });

    console.log('[ENGINE-2D] Sensor link created:', {
      id: linkId,
      sensor1: sensor1.id,
      sensor2: sensor2.id,
      linkType
    });

    // Re-render to show the new link
    this.render();
  }

  /**
   * Draw sensor links (lines connecting sensors)
   */
  private drawSensorLinks(): void {
    if (!this.ctx) return;

    const ctx = this.ctx;

    this.sensorLinks.forEach((link) => {
      const sensor1 = this.sensors.get(link.sensor1Id);
      const sensor2 = this.sensors.get(link.sensor2Id);

      if (!sensor1 || !sensor2) {
        return;
      }

      // Draw line connecting the two sensors
      ctx.beginPath();
      ctx.moveTo(sensor1.x, sensor1.y);
      ctx.lineTo(sensor2.x, sensor2.y);

      // Set line style based on link type
      if (link.linkType === SensorLinkType.PRIMARY) {
        ctx.strokeStyle = '#0000ff'; // Blue for primary
        ctx.lineWidth = 3;
      } else {
        ctx.strokeStyle = '#ff69b4'; // Pink for secondary
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]); // Dashed line for secondary
      }

      ctx.stroke();
      ctx.setLineDash([]); // Reset dash pattern
    });
  }

  /**
   * Start dragging a sensor
   */
  private startSensorDrag(sensor: { x: number; y: number; type: SensorType; id: string }, startPosition: { x: number; y: number }): void {
    this.isDragging = true;
    this.draggedSensor = sensor;
    this.dragStartPosition = startPosition;

    // Update cursor
    if (this.canvasRef?.nativeElement) {
      this.canvasRef.nativeElement.style.cursor = 'grabbing';
    }
  }

  /**
   * Update sensor position during drag
   */
  private updateSensorDrag(x: number, y: number): void {
    if (!this.isDragging || !this.draggedSensor) return;

    // Update sensor position
    this.draggedSensor.x = x;
    this.draggedSensor.y = y;

    // Update sensor in the map
    this.sensors.set(this.draggedSensor.id, this.draggedSensor);

    // Re-render canvas to show updated position
    this.render();
  }

  /**
   * End sensor dragging
   */
  private endSensorDrag(): void {
    if (this.isDragging && this.draggedSensor) {
      // Emit position change event
      const sensorInfo: SensorInfo = {
        id: this.draggedSensor.id,
        type: this.draggedSensor.type,
        name: `${this.draggedSensor.type}_2d`,
        position: { x: this.draggedSensor.x, y: this.draggedSensor.y, z: 0 } as any,
        meshName: '2d_canvas',
        createdAt: Date.now()
      };

      this.eventBus.emitPositionChanged(sensorInfo);
    }

    // Reset cursor
    if (this.canvasRef?.nativeElement) {
      this.canvasRef.nativeElement.style.cursor = 'default';
    }

    this.isDragging = false;
    this.draggedSensor = null;
    this.dragStartPosition = null;
  }

  /**
   * Select a sensor and emit the selection event
   */
  private selectSensor(sensor: { x: number; y: number; type: SensorType; id: string }): void {
    this.selectedSensor = sensor;

    const sensorInfo: SensorInfo = {
      id: sensor.id,
      type: sensor.type,
      name: `${sensor.type}_2d`,
      position: { x: sensor.x, y: sensor.y, z: 0 } as any,
      meshName: '2d_canvas',
      createdAt: Date.now()
    };

    this.eventBus.emitMeshClicked({
      meshName: sensor.id,
      position: new Vector3(sensor.x, sensor.y, 0),
      source: 'engine_2d'
    });

    // Re-render to show selection
    this.render();
  }

  /**
   * Deselect the currently selected sensor
   */
  private deselectSensor(): void {
    if (this.selectedSensor) {
      console.log('[ENGINE-2D] Sensor deselected:', this.selectedSensor.id);
      this.selectedSensor = null;

      // Emit deselection event (empty mesh name indicates deselection)
      this.eventBus.emitMeshClicked({
        meshName: '',
        position: new Vector3(0, 0, 0),
        source: 'engine_2d'
      });

      // Re-render to clear selection
      this.render();
    }
  }

  /**
   * Check if a sensor is currently being dragged
   */
  public isDraggingSensor(): boolean {
    return this.isDragging;
  }

  /**
   * Get the ID of the sensor currently being dragged
   */
  public getDraggedSensorId(): string | null {
    return this.draggedSensor?.id || null;
  }

  /**
   * Get all sensors
   */
  public getSensors(): Map<string, { x: number; y: number; type: SensorType; id: string }> {
    return new Map(this.sensors);
  }

  /**
   * Get the currently selected sensor
   */
  public getSelectedSensor(): { x: number; y: number; type: SensorType; id: string } | null {
    return this.selectedSensor;
  }

  /**
   * Select a sensor by ID (public method)
   */
  public selectSensorById(sensorId: string): void {
    const sensor = this.sensors.get(sensorId);
    if (sensor) {
      this.selectSensor(sensor);
    }
  }

  /**
   * Select a sensor by type (public method)
   */
  public selectSensorByType(sensorType: SensorType): void {
    const sensor = Array.from(this.sensors.values()).find(s => s.type === sensorType);
    if (sensor) {
      this.selectSensor(sensor);
    }
  }

  /**
   * Select a sensor by name/meshName (public method) - flexible matching
   */
  public selectSensorByName(meshName: string): void {
    // First try exact ID match
    let sensor = this.sensors.get(meshName);

    if (!sensor) {
      // Try to find by sensor type or partial match
      sensor = Array.from(this.sensors.values()).find(s => {
        return s.type === meshName ||
               s.id.toLowerCase().includes(meshName.toLowerCase()) ||
               meshName.toLowerCase().includes(s.type.toLowerCase());
      });
    }

    if (sensor) {
      this.selectSensor(sensor);
    }
  }

  /**
   * Clear sensor selection (public method)
   */
  public clearSensorSelection(): void {
    this.deselectSensor();
  }

  /**
   * Check if canvas is ready
   */
  public isCanvasReady(): boolean {
    return this.isReady();
  }
}
