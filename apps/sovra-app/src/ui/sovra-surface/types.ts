/**
 * SOVRA Spatial Holographic Surface Engine — Types & Definitions
 * File: apps/sovra-app/src/ui/sovra-surface/types.ts
 */

export type SurfaceId = string;
export type SurfaceType = string;
export type SurfaceOrigin = { x: number; y: number } | HTMLElement | null;

export type SurfaceAnimationState = 'emerging' | 'active' | 'receded' | 'closing';

export interface SurfaceOptions {
  id?: SurfaceId | undefined;
  type?: SurfaceType | undefined;
  title: string;
  subtitle?: string | undefined;
  context?: Record<string, any> | undefined;
  origin?: SurfaceOrigin | undefined;
  params?: Record<string, any> | undefined;
  parent?: SurfaceId | undefined;
  dismissible?: boolean | undefined;
  modal?: boolean | undefined;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  render?: ((bodyEl: HTMLElement, ctx: SurfaceRenderContext) => void) | undefined;
  renderFooter?: ((footerEl: HTMLElement, ctx: SurfaceRenderContext) => void) | undefined;
}

export interface SurfaceRecord {
  id: SurfaceId;
  type: SurfaceType;
  title: string;
  subtitle?: string | undefined;
  context: Record<string, any>;
  origin?: SurfaceOrigin | undefined;
  params: Record<string, any>;
  parent?: SurfaceId | undefined;
  dismissible: boolean;
  modal: boolean;
  el: HTMLElement;
  bodyEl: HTMLElement;
  breadcrumbsEl?: HTMLElement | undefined;
  animationState: SurfaceAnimationState;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}

export interface SurfaceRenderContext {
  surfaceId: SurfaceId;
  pushSurface: (options: SurfaceOptions) => SurfaceRecord;
  popSurface: () => SurfaceRecord | null;
  replaceSurface: (options: SurfaceOptions) => SurfaceRecord;
  closeSurface: (surfaceId?: SurfaceId) => void;
  closeAllSurfaces: () => void;
  params: Record<string, any>;
  context: Record<string, any>;
}

export interface SovraSurfaceEngineInterface {
  openSurface: (options: SurfaceOptions) => SurfaceRecord;
  pushSurface: (options: SurfaceOptions) => SurfaceRecord;
  replaceSurface: (options: SurfaceOptions) => SurfaceRecord;
  popSurface: (opts?: { fromHistory?: boolean }) => SurfaceRecord | null;
  closeSurface: (surfaceId?: SurfaceId) => void;
  closeAllSurfaces: () => void;
  popTo: (targetSurfaceId: SurfaceId) => void;
  getCurrentSurface: () => SurfaceRecord | null;
  getStack: () => SurfaceRecord[];
  getDepth: () => number;
}
