/**
 * SOVRA Spatial Holographic Surface Engine Singleton
 * File: apps/sovra-app/src/ui/sovra-surface/SovraSurfaceEngine.ts
 */

import { SovraSurfaceStack } from './SovraSurfaceStack.js';
import { SovraSurfaceEngineInterface, SurfaceId, SurfaceOptions, SurfaceRecord } from './types.js';

export class SovraSurfaceEngine implements SovraSurfaceEngineInterface {
  private static instance: SovraSurfaceEngine | null = null;
  private stackManager: SovraSurfaceStack;

  private constructor() {
    this.stackManager = new SovraSurfaceStack();
  }

  public static getInstance(): SovraSurfaceEngine {
    if (!SovraSurfaceEngine.instance) {
      SovraSurfaceEngine.instance = new SovraSurfaceEngine();
    }
    return SovraSurfaceEngine.instance;
  }

  public openSurface(options: SurfaceOptions): SurfaceRecord {
    return this.stackManager.push(options);
  }

  public pushSurface(options: SurfaceOptions): SurfaceRecord {
    return this.stackManager.push(options);
  }

  public replaceSurface(options: SurfaceOptions): SurfaceRecord {
    return this.stackManager.replace(options);
  }

  public popSurface(opts?: { fromHistory?: boolean }): SurfaceRecord | null {
    return this.stackManager.pop(opts);
  }

  public closeSurface(surfaceId?: SurfaceId): void {
    this.stackManager.close(surfaceId);
  }

  public closeAllSurfaces(): void {
    this.stackManager.closeAll();
  }

  public popTo(targetSurfaceId: SurfaceId): void {
    this.stackManager.popTo(targetSurfaceId);
  }

  public getCurrentSurface(): SurfaceRecord | null {
    return this.stackManager.getCurrent();
  }

  public getStack(): SurfaceRecord[] {
    return this.stackManager.getStack();
  }

  public getDepth(): number {
    return this.stackManager.getDepth();
  }
}

export const surfaceEngine = SovraSurfaceEngine.getInstance();
