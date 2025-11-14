import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventBusService } from '../../core/services/event-bus.service';
import { Vector3 } from '@babylonjs/core';
import { SensorType, SensorInfo, SensorLinkType, SensorDistanceCalculatedPayload } from '../../core/models/types.model';
import { getSensorDisplayName } from '../../core/models/sensor-configs';

@Component({
  selector: 'app-tree-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tree-panel.component.html',
  styleUrls: ['./tree-panel.component.scss']
})
export class TreePanelComponent implements OnInit {
  private eventBus = inject(EventBusService);

  // Expose enum for template
  SensorLinkType = SensorLinkType;

  // Active mesh for sensor creation
  activeMesh = signal<{ name: string; position: Vector3; normal?: Vector3 } | null>(null);

  // Sensors list
  sensors = signal<SensorInfo[]>([]);

  // Link sensors modal state
  showLinkModal = signal<boolean>(false);
  selectedSensor1: string = '';
  selectedSensor2: string = '';

  // Sensor insertion mode state
  isInSensorInsertionMode = signal<boolean>(false);
  selectedSensorType = signal<SensorType | null>(null);

  // Sensor link mode state
  isInSensorLinkMode = signal<boolean>(false);
  selectedLinkType = signal<SensorLinkType | null>(null);
  linkModeSensors = signal<SensorInfo[]>([]); // Track selected sensors during link mode

  // Sensor distance calculation mode state
  isInSensorDistanceMode = signal<boolean>(false);
  distanceModeSensors = signal<SensorInfo[]>([]); // Track selected sensors during distance calculation
  showDistanceResultModal = signal<boolean>(false);
  distanceResult = signal<{ distance: number; intersectedMeshes: string[]; sensor1: SensorInfo; sensor2: SensorInfo } | null>(null);

  // Prevent double clicks
  private isCreatingSensor = false;

  ngOnInit(): void {
    // Listen for mesh clicked events to track active mesh
    this.eventBus.meshClicked$.subscribe(payload => {
      this.activeMesh.set({ name: payload.meshName, position: payload.position, normal: payload.normal });
    });

    // Listen for sensor created events
    this.eventBus.sensorCreated$.subscribe(payload => {
      console.log('[TREE-PANEL] sensorCreated$ received:', payload.sensor);
      this.sensors.update(currentSensors => [...currentSensors, payload.sensor]);
      console.log('[TREE-PANEL] Sensor added to list. Total sensors:', this.sensors().length);
    });

    // Listen for mesh clicked events during link mode
    this.eventBus.meshClicked$.subscribe(payload => {
      if (this.isInSensorLinkMode() && payload.source === 'scene_manager') {
        // Check if clicked mesh is a sensor
        const clickedSensor = this.sensors().find(s => s.name === payload.meshName);
        if (clickedSensor) {
          this.onSensorClickedDuringLinkMode(clickedSensor);
        }
      }
    });

    // Listen for sensor link mode changes from scene manager
    this.eventBus.sensorLinkModeChanged$.subscribe(payload => {
      if (payload.source === 'scene_manager') {
        // Update local state when scene manager exits link mode
        this.isInSensorLinkMode.set(payload.isActive);
        this.selectedLinkType.set(payload.linkType);
        this.linkModeSensors.set([]);
        console.log('[TREE-PANEL] Link mode changed by scene manager:', payload.isActive);
      }
    });

    // Listen for sensor distance mode changes from scene manager
    this.eventBus.sensorDistanceModeChanged$.subscribe(payload => {
      if (payload.source === 'scene_manager') {
        // Update local state when scene manager exits distance mode
        this.isInSensorDistanceMode.set(payload.isActive);
        this.distanceModeSensors.set([]);
        console.log('[TREE-PANEL] Distance mode changed by scene manager:', payload.isActive);
      }
    });

    // Listen for distance calculation results
    this.eventBus.sensorDistanceCalculated$.subscribe((payload: SensorDistanceCalculatedPayload) => {
      console.log('[TREE-PANEL] Distance calculated:', payload);
      this.distanceResult.set({
        distance: payload.distance,
        intersectedMeshes: payload.intersectedMeshes,
        sensor1: payload.sensor1,
        sensor2: payload.sensor2
      });
      this.showDistanceResultModal.set(true);
    });
  }

  // Helper methods for template
  getSensorDisplayName(sensorType: SensorType): string {
    return getSensorDisplayName(sensorType);
  }

  // Sensor creation handler - now enters insertion mode
  onCreateSensor(sensorTypeString: string): void {
    const sensorType = sensorTypeString as SensorType;

    // Enter sensor insertion mode
    this.isInSensorInsertionMode.set(true);
    this.selectedSensorType.set(sensorType);

    console.log(`[TREE-PANEL] Entered sensor insertion mode for type: ${sensorType}`);

    // Emit event to notify scene manager of insertion mode
    this.eventBus.emitSensorInsertionModeChanged({
      isActive: true,
      sensorType: sensorType,
      source: 'tree_panel'
    });
  }

  // Exit sensor insertion mode
  onExitSensorInsertionMode(): void {
    this.isInSensorInsertionMode.set(false);
    this.selectedSensorType.set(null);

    console.log('[TREE-PANEL] Exited sensor insertion mode');

    // Emit event to notify scene manager
    this.eventBus.emitSensorInsertionModeChanged({
      isActive: false,
      sensorType: null,
      source: 'tree_panel'
    });
  }

  // Enter sensor link mode
  onEnterSensorLinkMode(linkType: SensorLinkType): void {
    // Make sure we're not in insertion mode
    if (this.isInSensorInsertionMode()) {
      this.onExitSensorInsertionMode();
    }

    this.isInSensorLinkMode.set(true);
    this.selectedLinkType.set(linkType);
    this.linkModeSensors.set([]);

    console.log(`[TREE-PANEL] Entered sensor link mode: ${linkType}`);

    // Emit event to notify scene manager
    this.eventBus.emitSensorLinkModeChanged({
      isActive: true,
      linkType: linkType,
      source: 'tree_panel'
    });
  }

  // Exit sensor link mode
  onExitSensorLinkMode(): void {
    this.isInSensorLinkMode.set(false);
    this.selectedLinkType.set(null);
    this.linkModeSensors.set([]);

    console.log('[TREE-PANEL] Exited sensor link mode');

    // Emit event to notify scene manager
    this.eventBus.emitSensorLinkModeChanged({
      isActive: false,
      linkType: null,
      source: 'tree_panel'
    });
  }

  // Enter sensor distance calculation mode
  onEnterSensorDistanceMode(): void {
    // Make sure we're not in insertion mode or link mode
    if (this.isInSensorInsertionMode()) {
      this.onExitSensorInsertionMode();
    }
    if (this.isInSensorLinkMode()) {
      this.onExitSensorLinkMode();
    }

    this.isInSensorDistanceMode.set(true);
    this.distanceModeSensors.set([]);

    console.log('[TREE-PANEL] Entered sensor distance calculation mode');

    // Emit event to notify scene manager
    this.eventBus.emitSensorDistanceModeChanged({
      isActive: true,
      source: 'tree_panel'
    });
  }

  // Exit sensor distance calculation mode
  onExitSensorDistanceMode(): void {
    this.isInSensorDistanceMode.set(false);
    this.distanceModeSensors.set([]);

    console.log('[TREE-PANEL] Exited sensor distance calculation mode');

    // Emit event to notify scene manager
    this.eventBus.emitSensorDistanceModeChanged({
      isActive: false,
      source: 'tree_panel'
    });
  }

  // Close distance result modal
  closeDistanceResultModal(): void {
    this.showDistanceResultModal.set(false);
    this.distanceResult.set(null);
  }

  // Handle sensor click during link mode
  onSensorClickedDuringLinkMode(sensor: SensorInfo): void {
    console.log('[TREE-PANEL] Sensor clicked during link mode:', sensor.id);

    // Add sensor to link mode selection
    this.linkModeSensors.update(sensors => [...sensors, sensor]);

    // If we have 2 sensors, create the link
    if (this.linkModeSensors().length === 2) {
      const [sensor1, sensor2] = this.linkModeSensors();

      console.log(`[TREE-PANEL] Creating ${this.selectedLinkType()} link between ${sensor1.id} and ${sensor2.id}`);

      // Emit sensor link event with link type
      this.eventBus.emitSensorLinkRequested({
        sensor1: sensor1,
        sensor2: sensor2,
        linkType: this.selectedLinkType()!,
        source: 'tree_panel'
      });

      // Exit link mode after creating the link
      this.onExitSensorLinkMode();
    }
  }

  // Sensor list click handler
  onSensorClick(sensor: SensorInfo): void {
    console.log('Sensor clicked in tree panel:', sensor);

    // If in link mode, handle it differently
    if (this.isInSensorLinkMode()) {
      this.onSensorClickedDuringLinkMode(sensor);
      return;
    }

    // Emit an event to highlight the sensor in the 3D scene and set it as active mesh
    this.eventBus.emitMeshClicked({
      meshName: sensor.name,
      position: sensor.position,
      normal: sensor.normal,
      source: 'tree_panel'
    });
  }

  // Link sensors modal methods
  onLinkSensorsClick(): void {
    if (this.sensors().length < 2) {
      console.warn('At least 2 sensors are required to create a link');
      return;
    }

    // Reset selections
    this.selectedSensor1 = '';
    this.selectedSensor2 = '';

    // Show modal
    this.showLinkModal.set(true);
  }

  closeLinkModal(): void {
    this.showLinkModal.set(false);
    this.selectedSensor1 = '';
    this.selectedSensor2 = '';
  }

  confirmLinkSensors(): void {
    if (!this.selectedSensor1 || !this.selectedSensor2) {
      console.warn('Both sensors must be selected');
      return;
    }

    if (this.selectedSensor1 === this.selectedSensor2) {
      console.warn('Cannot link a sensor to itself');
      return;
    }

    const sensor1 = this.sensors().find(s => s.id === this.selectedSensor1);
    const sensor2 = this.sensors().find(s => s.id === this.selectedSensor2);

    if (!sensor1 || !sensor2) {
      console.error('Selected sensors not found');
      return;
    }

    console.log(`Linking sensors: ${sensor1.id} <-> ${sensor2.id}`);

    // Emit sensor link event
    this.eventBus.emitSensorLinkRequested({
      sensor1: sensor1,
      sensor2: sensor2,
      source: 'tree_panel'
    });

    // Close modal
    this.closeLinkModal();
  }
}
