/**
 * @fileoverview Scene Canvas Component - BabylonJS rendering canvas
 *
 * Standalone component that manages the 3D canvas and SceneManager lifecycle
 */

import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  Input,
  Output,
  EventEmitter,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { EngineConfig } from '../../core/models/types.model';
import { SceneManager } from '../../core/engine/scene-manager';
import { EventBusService } from '../../core/services/event-bus.service';
import { LoggerService } from '../../core/services/logger.service';

@Component({
  selector: 'app-scene-canvas',
  imports: [CommonModule],
  templateUrl: './scene-canvas.component.html',
  styleUrl: './scene-canvas.component.scss'
})
export class SceneCanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('sceneCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() engineConfig?: Partial<EngineConfig>;
  @Output() sceneReady = new EventEmitter<void>();
  @Output() error = new EventEmitter<Error>();

  protected isInitializing = signal(false);
  protected isReady = signal(false);
  protected errorMessage = signal<string | null>(null);

  private sceneManager: SceneManager | null = null;

  constructor(
    private eventBus: EventBusService,
    private logger: LoggerService
  ) {}

  ngAfterViewInit(): void {
    this.initializeScene();
  }

  ngOnDestroy(): void {
    console.log('Cleaning up SceneCanvas...');

    // In development, preserve scene for hot reload
    const isDevelopment = !this.isProduction();

    if (!isDevelopment) {
      if (this.sceneManager?.isReady()) {
        this.sceneManager.dispose();
      }
      this.sceneManager = null;
    } else {
      console.log('Development mode: preserving SceneManager for hot reload');
    }

    console.log('SceneCanvas cleanup completed');
  }

  private async initializeScene(): Promise<void> {
    if (!this.canvasRef?.nativeElement || this.isInitializing()) return;

    try {
      this.isInitializing.set(true);
      this.errorMessage.set(null);

      console.log('Initializing 3D scene...');
      console.log(' Canvas element:', this.canvasRef.nativeElement);
      console.log(' Canvas size:', this.canvasRef.nativeElement.clientWidth, 'x', this.canvasRef.nativeElement.clientHeight);

      // Create new SceneManager instance
      this.sceneManager = new SceneManager(this.eventBus, this.logger);

      // Initialize the scene
      await this.sceneManager.initialize(this.canvasRef.nativeElement, this.engineConfig);

      console.log('3D scene initialized successfully');
      console.log('   Scene manager ready:', this.sceneManager?.isReady());
      console.log('   Scene object:', this.sceneManager?.getScene());
      console.log('   Engine object:', this.sceneManager?.getEngine());

      // Emit success
      this.sceneReady.emit();
      this.isReady.set(true);

    } catch (err) {
      console.error('Failed to initialize 3D scene:', err);
      const errorObj = err as Error;
      this.errorMessage.set(errorObj.message);
      this.error.emit(errorObj);
    } finally {
      this.isInitializing.set(false);
    }
  }

  /**
   * Get the SceneManager instance (for external access)
   */
  getSceneManager(): SceneManager | null {
    return this.sceneManager;
  }

  /**
   * Check if running in production
   */
  isProduction(): boolean {
    // Angular production check
    return typeof ngDevMode === 'undefined' || !ngDevMode;
  }
}

