import { Component, inject, OnInit, signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventBusService } from '../../core/services/event-bus.service';
import { Vector3 } from '@babylonjs/core';
import { SensorType } from '../../core/models/types.model';

interface LayerState {
  floor1: boolean;
  floor2: boolean;
}

interface TagState {
  architecture: boolean;
  systems: boolean;
  forniture: boolean;
}

type HeatmapMode = 'battery' | 'signal';

interface SelectionProperties {
  object: string;
  material: string;
  attenuationIndex: number;
}

@Component({
  selector: 'app-properties-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './properties-panel.component.html',
  styleUrls: ['./properties-panel.component.scss']
})
export class PropertiesPanelComponent implements OnInit {
  private eventBus = inject(EventBusService);
  activeMesh = signal<{ name: string; position: Vector3; normal?: Vector3 } | null>(null);
  meshVisible = signal<boolean>(true);
  isVisible = signal<boolean>(true);

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // Global Properties - Layers
  layers = signal<LayerState>({
    floor1: true,
    floor2: true
  });

  // Global Properties - Tags
  tags = signal<TagState>({
    architecture: true,
    systems: true,
    forniture: true
  });

  // Global Properties - Heatmap
  heatmapMode = signal<HeatmapMode>('battery');
  heatmapVisible = signal<boolean>(true);

  // Selection Properties
  selectionProperties = signal<SelectionProperties>({
    object: 'Wall',
    material: 'Concrete',
    attenuationIndex: 0.5
  });

  // Material options for dropdown
  materialOptions = ['Concrete', 'Wood', 'Metal', 'Glass', 'Brick'];



  ngOnInit(): void {
    this.eventBus.meshClicked$.subscribe(payload => {
      this.activeMesh.set({ name: payload.meshName, position: payload.position, normal: payload.normal });
      // Reset visibility to true when a new mesh is selected
      this.meshVisible.set(true);
    });
  }

  // Layer toggle handlers
  onLayerToggle(layer: keyof LayerState, checked: boolean): void {
    this.layers.update(current => ({
      ...current,
      [layer]: checked
    }));
    console.log(`Layer ${layer} toggled:`, checked);
  }

  // Tag toggle handlers
  onTagToggle(tag: keyof TagState, checked: boolean): void {
    this.tags.update(current => ({
      ...current,
      [tag]: checked
    }));
    console.log(`Tag ${tag} toggled:`, checked);
  }

  // Heatmap mode change handler
  onHeatmapModeChange(mode: HeatmapMode): void {
    this.heatmapMode.set(mode);
    console.log('Heatmap mode changed:', mode);
  }

  // Heatmap visibility toggle handler
  onHeatmapVisibilityToggle(checked: boolean): void {
    this.heatmapVisible.set(checked);
    console.log('Heatmap visibility changed:', checked);
  }

  // Selection properties change handlers
  onObjectChange(value: string): void {
    this.selectionProperties.update(current => ({
      ...current,
      object: value
    }));
    console.log('Object changed:', value);
  }

  onMaterialChange(value: string): void {
    this.selectionProperties.update(current => ({
      ...current,
      material: value
    }));
    console.log('Material changed:', value);
  }

  onAttenuationChange(value: number): void {
    this.selectionProperties.update(current => ({
      ...current,
      attenuationIndex: value
    }));
    console.log('Attenuation index changed:', value);
  }

  // Visibility toggle handler
  onVisibilityToggle(checked: boolean): void {
    this.meshVisible.set(checked);
    const meshName = this.activeMesh()?.name;
    if (meshName) {
      this.eventBus.emitMeshVisibilityChanged({
        meshName,
        visible: checked,
        source: 'properties_panel'
      });
      console.log(`Mesh ${meshName} visibility changed to:`, checked);
    }
  }

  // Helper methods for template
  parseFloat(value: string): number {
    return parseFloat(value);
  }







  // Model import handlers
  onImportButtonClick(): void {
    // Add a small delay to ensure the user gesture is properly registered
    setTimeout(() => {
      const input = this.fileInput.nativeElement;

      // Ensure the input is properly configured for mobile
      input.accept = '.glb,.gltf';
      input.multiple = false;

      // Trigger the file picker
      input.click();
    }, 100);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];

      // Validate file type
      const validExtensions = ['.glb', '.gltf'];
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

      if (!validExtensions.includes(fileExtension)) {
        console.error('Invalid file type. Please select a .glb or .gltf file.');
        alert('Invalid file type. Please select a .glb or .gltf file.');
        return;
      }

      console.log('File selected for import:', file.name);

      // Emit event to load the model
      this.eventBus.emitModelImportRequested({
        file,
        source: 'properties_panel'
      });

      // Reset input so the same file can be selected again
      input.value = '';
    }
  }

  // Panel visibility toggle handler
  onClosePanel(): void {
    this.isVisible.set(false);
    // Emit event to notify parent component about panel closure
    this.eventBus.emitPanelVisibilityChanged({
      panelName: 'properties',
      visible: false,
      source: 'properties_panel'
    });
    console.log('Properties panel closed');
  }

}

