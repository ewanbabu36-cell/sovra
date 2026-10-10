/**
 * SOVRA Core Controller
 * File: apps/sovra-app/src/ui/sovra-core/SovraCoreController.ts
 *
 * Coordinates radial/orbital layouts, animation origins, and handoffs
 * to the SOVRA Spatial Surface Engine.
 */

import {
  CoreNodeConfig,
  SovraCoreControllerOptions,
  SovraCoreState,
} from './types.js';
import { SovraCoreStateMachine } from './SovraCoreStateMachine.js';

export class SovraCoreController {
  private static instance: SovraCoreController | null = null;

  private stateMachine = new SovraCoreStateMachine();
  private options: SovraCoreControllerOptions;

  public static readonly DEFAULT_NODES: readonly CoreNodeConfig[] = [
    { id: 'holo-node-home',   pathId: 'holo-path-home',   action: 'home',          angle: 0,   label: 'Home',          accent: '#3b82f6', glow: 'rgba(59, 130, 246, 0.5)', category: 'social' },
    { id: 'holo-node-feed',   pathId: 'holo-path-feed',   action: 'feed',          angle: 40,  label: 'Feed',          accent: '#06b6d4', glow: 'rgba(6, 182, 212, 0.5)', category: 'social' },
    { id: 'holo-node-chat',   pathId: 'holo-path-chat',   action: 'chat',          angle: 80,  label: 'Chat',          accent: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.5)', category: 'communication' },
    { id: 'holo-node-logout', pathId: 'holo-path-logout', action: 'logout',        angle: 120, label: 'Logout',        accent: '#f43f5e', glow: 'rgba(244, 63, 94, 0.5)', category: 'identity' },
    { id: 'holo-node-notif',  pathId: 'holo-path-notif',  action: 'notifications', angle: 160, label: 'Notifications', accent: '#d946ef', glow: 'rgba(217, 70, 239, 0.5)', category: 'communication' },
    { id: 'holo-node-create', pathId: 'holo-path-create', action: 'create',        angle: 200, label: 'Create',        accent: '#10b981', glow: 'rgba(16, 185, 129, 0.5)', category: 'create' },
    { id: 'holo-node-profile',pathId: 'holo-path-profile',action: 'profile',       angle: 240, label: 'Profile',       accent: '#2563eb', glow: 'rgba(37, 99, 235, 0.5)', category: 'identity' },
    { id: 'holo-node-watch',  pathId: 'holo-path-watch',  action: 'watch',         angle: 280, label: 'Watch',         accent: '#f97316', glow: 'rgba(249, 115, 22, 0.5)', category: 'media' },
    { id: 'holo-node-reels',  pathId: 'holo-path-reels',  action: 'reels',         angle: 320, label: 'Reels',         accent: '#c084fc', glow: 'rgba(192, 132, 252, 0.5)', category: 'media' },
  ];

  public constructor(options?: SovraCoreControllerOptions) {
    this.options = {
      overlayId: 'holographicNavOverlay',
      triggerBtnId: 'sovraCoreBtn',
      centerBtnId: 'holoCenterCoreBtn',
      nodesLayerId: 'holoNodesLayer',
      energySvgId: 'holoEnergySvg',
      ...options,
    };
  }

  public static getInstance(): SovraCoreController {
    if (!SovraCoreController.instance) {
      SovraCoreController.instance = new SovraCoreController();
    }
    return SovraCoreController.instance;
  }

  public getStateMachine(): SovraCoreStateMachine {
    return this.stateMachine;
  }

  public getState(): SovraCoreState {
    return this.stateMachine.getState();
  }

  public calculateGeometry(viewportWidth: number): { radius: number; halfSpan: number } {
    if (viewportWidth <= 390) {
      return { radius: 118, halfSpan: 175 };
    }
    if (viewportWidth <= 480) {
      return { radius: 136, halfSpan: 195 };
    }
    if (viewportWidth <= 1024) {
      return { radius: 172, halfSpan: 240 };
    }
    return { radius: 212, halfSpan: 280 };
  }

  public calculateNodeCoordinates(viewportWidth: number): Record<string, { x: number; y: number }> {
    const { radius } = this.calculateGeometry(viewportWidth);
    const coords: Record<string, { x: number; y: number }> = {};

    SovraCoreController.DEFAULT_NODES.forEach((node) => {
      const rad = (node.angle * Math.PI) / 180;
      coords[node.id] = {
        x: Math.round(radius * Math.sin(rad)),
        y: Math.round(-radius * Math.cos(rad)),
      };
    });

    return coords;
  }

  public open(triggerEl?: HTMLElement | null): boolean {
    if (!this.stateMachine.canTransition('opening') && !this.stateMachine.canTransition('open')) {
      return false;
    }

    this.stateMachine.transition('opening');

    if (typeof document !== 'undefined') {
      const overlay = document.getElementById(this.options.overlayId || 'holographicNavOverlay');
      const triggerBtn = triggerEl || document.getElementById(this.options.triggerBtnId || 'sovraCoreBtn');

      if (triggerBtn && overlay && typeof triggerBtn.getBoundingClientRect === 'function') {
        const rect = triggerBtn.getBoundingClientRect();
        overlay.style.setProperty('--origin-x', `${rect.left + rect.width / 2}px`);
        overlay.style.setProperty('--origin-y', `${rect.top + rect.height / 2}px`);
        triggerBtn.setAttribute('aria-expanded', 'true');
      }

      if (overlay) {
        overlay.classList.remove('is-surface-active');
        overlay.classList.add('is-active');

        const commitOpen = () => {
          overlay.classList.add('is-open');
          this.stateMachine.transition('open');
        };

        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => {
            requestAnimationFrame(commitOpen);
          });
        } else {
          setTimeout(commitOpen, 0);
        }
      } else {
        this.stateMachine.transition('open');
      }
    } else {
      this.stateMachine.transition('open');
    }

    return true;
  }

  public close(): boolean {
    if (this.stateMachine.isClosed()) {
      return true;
    }

    if (typeof document !== 'undefined') {
      const overlay = document.getElementById(this.options.overlayId || 'holographicNavOverlay');
      const triggerBtn = document.getElementById(this.options.triggerBtnId || 'sovraCoreBtn');

      if (triggerBtn) {
        triggerBtn.setAttribute('aria-expanded', 'false');
      }

      if (overlay) {
        overlay.classList.remove('is-open');
        overlay.classList.remove('is-surface-active');
        setTimeout(() => {
          overlay.classList.remove('is-active');
          this.stateMachine.reset();
        }, 220);
      } else {
        this.stateMachine.reset();
      }
    } else {
      this.stateMachine.reset();
    }

    return true;
  }

  public transitionToSurface(): boolean {
    if (!this.stateMachine.canTransition('transitioning')) {
      return false;
    }

    this.stateMachine.transition('transitioning');

    if (typeof document !== 'undefined') {
      const overlay = document.getElementById(this.options.overlayId || 'holographicNavOverlay');
      if (overlay) {
        overlay.classList.add('is-surface-active');
      }
    }

    this.stateMachine.transition('surface-active');
    return true;
  }

  public returnFromSurface(): boolean {
    if (!this.stateMachine.isSurfaceActive()) {
      return false;
    }

    if (typeof document !== 'undefined') {
      const overlay = document.getElementById(this.options.overlayId || 'holographicNavOverlay');
      if (overlay) {
        overlay.classList.remove('is-surface-active');
      }
    }

    return this.stateMachine.transition('open');
  }

  public toggle(triggerEl?: HTMLElement | null): boolean {
    if (this.stateMachine.isOpen() || this.stateMachine.getState() === 'opening') {
      return this.close();
    }
    return this.open(triggerEl);
  }
}
