/**
 * SOVRA Spatial Surface Transition & Energy Pulse Physics
 * File: apps/sovra-app/src/ui/sovra-surface/SovraSurfaceTransition.ts
 */

import { SurfaceOrigin } from './types.js';

export class SovraSurfaceTransition {
  public static isReducedMotion(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  public static getOriginCoordinates(origin?: SurfaceOrigin): { x: number; y: number } | null {
    if (!origin) return null;
    if (typeof origin === 'object' && 'x' in origin && 'y' in origin) {
      return { x: origin.x, y: origin.y };
    }
    if (origin instanceof HTMLElement) {
      const rect = origin.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
    return null;
  }

  public static getOriginCoords(origin?: SurfaceOrigin): { x: number; y: number } | null {
    return SovraSurfaceTransition.getOriginCoordinates(origin);
  }

  public static triggerEnergyPulse(coords: { x: number; y: number } | null): void {
    if (!coords || typeof document === 'undefined' || this.isReducedMotion()) return;

    const pulseEl = document.createElement('div');
    pulseEl.className = 'sovra-spatial-pulse';
    pulseEl.style.setProperty('--pulse-x', `${coords.x}px`);
    pulseEl.style.setProperty('--pulse-y', `${coords.y}px`);
    document.body.appendChild(pulseEl);

    setTimeout(() => {
      if (pulseEl.parentNode) {
        pulseEl.parentNode.removeChild(pulseEl);
      }
    }, 280);
  }

  public static applyOriginToCard(cardEl: HTMLElement, coords: { x: number; y: number } | null): void {
    if (!coords) {
      cardEl.style.setProperty('--origin-x', '50%');
      cardEl.style.setProperty('--origin-y', '50%');
      return;
    }
    cardEl.style.setProperty('--origin-x', `${coords.x}px`);
    cardEl.style.setProperty('--origin-y', `${coords.y}px`);
  }
}
