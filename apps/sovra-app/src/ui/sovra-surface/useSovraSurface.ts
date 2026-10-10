/**
 * Client accessor / hook for SOVRA Spatial Surface Engine
 * File: apps/sovra-app/src/ui/sovra-surface/useSovraSurface.ts
 */

import { surfaceEngine, SovraSurfaceEngine } from './SovraSurfaceEngine.js';

export function useSovraSurface(): SovraSurfaceEngine {
  return surfaceEngine;
}
