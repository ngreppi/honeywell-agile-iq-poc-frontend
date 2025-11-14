/**
 * @fileoverview Main App Component - Entry point for the Angular application
 *
 * Orchestrates the 3-panel layout with command registry initialization
 */

import { Component, OnInit, ViewChild, signal, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { SceneCanvasComponent } from './components/scene-canvas/scene-canvas.component';
import { DebugConsoleComponent } from './components/debug-console/debug-console.component';
import { PropertiesPanelComponent } from './components/properties-panel/properties-panel.component';
import { TreePanelComponent } from './components/tree-panel/tree-panel.component';
import { Engine2DComponent } from './core/engine-2d/engine-2d.component';
import { CommandRegistryService } from './core/services/command-registry.service';
import { EventBusService } from './core/services/event-bus.service';
import { registerAllCommands } from './core/engine/commands';
import { CommandResult } from './core/models/types.model';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    CommonModule,
    SceneCanvasComponent,
    Engine2DComponent,
    DebugConsoleComponent,
    PropertiesPanelComponent,
    TreePanelComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  @ViewChild(SceneCanvasComponent) sceneCanvas?: SceneCanvasComponent;
  @ViewChild(Engine2DComponent) engine2d?: Engine2DComponent;

  protected readonly title = signal('Pittway3D Angular');
  protected isInitialized = signal(false);
  protected initError = signal<string | null>(null);
  isProduction = signal(environment.production);
  is2DEabled = signal(environment.enable2d);

  // Panel visibility states
  propertiesPanelVisible = signal(true);

  // Mode state: '2d' or '3d'
  protected currentMode = signal<'2d' | '3d'>('3d');

  private subscriptions: Subscription[] = [];

  constructor(
    private commandRegistry: CommandRegistryService,
    private eventBus: EventBusService
  ) { }

  ngOnInit(): void {
    this.detectMode();
    this.initializeApp();
    this.setupEventListeners();
  }

  /**
   * Detect mode from URL query parameters
   */
  private detectMode(): void {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');

    if (mode === '2d') {
      this.currentMode.set('2d');
      console.log('Mode: 2D Canvas');
    } else if (mode === '3d') {
      this.currentMode.set('3d');
      console.log('Mode: 3D Scene');
    } else {
      // Default to 3D
      this.currentMode.set('3d');
      console.log('Mode: 3D Scene (default)');
    }
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private async initializeApp(): Promise<void> {
    try {
      console.log('Initializing Pittway3D Template...');

      // Register all command handlers
      registerAllCommands(this.commandRegistry, this.eventBus);

      this.isInitialized.set(true);
      console.log('App initialized successfully');

    } catch (error) {
      console.error('App initialization failed:', error);
      this.initError.set((error as Error).message);
    }
  }

  /**
   * Handler for command execution
   */
  protected handleCommandExecuted(result: CommandResult): void {
    if (result.success) {
      console.log('Command executed successfully:', result.message);
    } else {
      console.warn('Command failed:', result.message);
    }
  }

  /**
   * Handler for command errors
   */
  protected handleCommandError(error: Error): void {
    console.error('Command panel error:', error);
  }

  /**
   * Handler for scene initialization errors
   */
  protected handleSceneError(error: Error): void {
    console.error('Scene initialization error:', error);
    this.initError.set(`Scene Error: ${error.message}`);
  }

  /**
   * Handler for scene ready event
   */
  protected handleSceneReady(): void {
    console.log('3D Scene is ready');

    // Store scene manager globally for command panel access
    if (this.sceneCanvas) {
      (window as any).__sceneManager = this.sceneCanvas.getSceneManager();
    }
  }

  /**
   * Handler for 2D canvas ready event
   */
  protected handle2DCanvasReady(): void {
    console.log('2D Canvas is ready');

    // Store 2D canvas globally for potential command panel access
    if (this.engine2d) {
      (window as any).__canvas2D = this.engine2d.getCanvas();
      (window as any).__ctx2D = this.engine2d.getContext();
    }
  }

  /**
   * Setup event listeners for panel visibility changes
   */
  private setupEventListeners(): void {
    // Listen for panel visibility changes
    const panelVisibilitySubscription = this.eventBus.panelVisibilityChanged$.subscribe(payload => {
      if (payload.panelName === 'properties') {
        this.propertiesPanelVisible.set(payload.visible);

        // Trigger canvas resize after panel visibility change
        setTimeout(() => {
          this.handleCanvasResize();
        }, 300); // Wait for CSS transition to complete
      }
    });

    this.subscriptions.push(panelVisibilitySubscription);
  }

  /**
   * Handle canvas resize when panel visibility changes
   */
  private handleCanvasResize(): void {
    if (this.sceneCanvas) {
      const sceneManager = this.sceneCanvas.getSceneManager();
      const engine = sceneManager?.getEngine();

      if (engine && sceneManager?.isReady()) {
        // Force engine to recalculate canvas size
        engine.resize();

        // Also trigger a render to ensure the scene is displayed correctly
        sceneManager.render();

        console.log('Canvas resized and re-rendered due to panel visibility change');
      } else {
        console.warn('Engine or SceneManager not ready for resize');
      }
    }
  }

  /**
   * Show the properties panel
   */
  protected showPropertiesPanel(): void {
    this.propertiesPanelVisible.set(true);

    // Trigger canvas resize after panel is shown
    setTimeout(() => {
      this.handleCanvasResize();
    }, 300); // Wait for CSS transition to complete

    console.log('Properties panel opened');
  }

  /**
   * Reload the page
   */
  protected reloadPage(): void {
    window.location.reload();
  }
}
