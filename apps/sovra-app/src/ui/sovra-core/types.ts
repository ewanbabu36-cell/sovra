/**
 * SOVRA Core Interaction System — Types & Definitions
 * File: apps/sovra-app/src/ui/sovra-core/types.ts
 */

export type SovraCoreState =
  | 'closed'
  | 'opening'
  | 'open'
  | 'transitioning'
  | 'surface-active';

export type CoreNodeId =
  | 'home'
  | 'feed'
  | 'reels'
  | 'watch'
  | 'chat'
  | 'logout'
  | 'notifications'
  | 'create'
  | 'profile';

export interface CoreNodeConfig {
  id: string;
  pathId: string;
  action: CoreNodeId;
  angle: number;
  label: string;
  accent: string;
  glow: string;
  category?: 'social' | 'media' | 'communication' | 'identity' | 'create' | undefined;
}

export interface RadialPoint {
  x: number;
  y: number;
}

export type CoreStateChangeListener = (
  newState: SovraCoreState,
  previousState: SovraCoreState
) => void;

export interface SovraCoreControllerOptions {
  overlayId?: string | undefined;
  triggerBtnId?: string | undefined;
  centerBtnId?: string | undefined;
  nodesLayerId?: string | undefined;
  energySvgId?: string | undefined;
}
