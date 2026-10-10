/**
 * SOVRA Core State Machine
 * File: apps/sovra-app/src/ui/sovra-core/SovraCoreStateMachine.ts
 *
 * Implements a strict finite state machine for the SOVRA Command Core:
 * closed -> opening -> open -> transitioning -> surface-active -> closed
 */

import { SovraCoreState, CoreStateChangeListener } from './types.js';

export class SovraCoreStateMachine {
  private currentState: SovraCoreState = 'closed';
  private listeners: Set<CoreStateChangeListener> = new Set();

  private static readonly VALID_TRANSITIONS: Record<SovraCoreState, readonly SovraCoreState[]> = {
    closed: ['opening', 'open'],
    opening: ['open', 'closed'],
    open: ['transitioning', 'closed', 'surface-active'],
    transitioning: ['surface-active', 'open', 'closed'],
    'surface-active': ['open', 'closed', 'transitioning'],
  };

  public getState(): SovraCoreState {
    return this.currentState;
  }

  public isClosed(): boolean {
    return this.currentState === 'closed';
  }

  public isOpen(): boolean {
    return this.currentState === 'open';
  }

  public isSurfaceActive(): boolean {
    return this.currentState === 'surface-active';
  }

  public canTransition(targetState: SovraCoreState): boolean {
    const allowed = SovraCoreStateMachine.VALID_TRANSITIONS[this.currentState];
    return Array.isArray(allowed) && allowed.includes(targetState);
  }

  public transition(targetState: SovraCoreState): boolean {
    if (this.currentState === targetState) {
      return true;
    }

    if (!this.canTransition(targetState)) {
      console.warn(
        `[SovraCoreStateMachine] Invalid transition requested: '${this.currentState}' -> '${targetState}'`
      );
      return false;
    }

    const prevState = this.currentState;
    this.currentState = targetState;
    this.notify(targetState, prevState);
    return true;
  }

  public subscribe(listener: CoreStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reset(): void {
    const prevState = this.currentState;
    this.currentState = 'closed';
    if (prevState !== 'closed') {
      this.notify('closed', prevState);
    }
  }

  private notify(newState: SovraCoreState, prevState: SovraCoreState): void {
    this.listeners.forEach((fn) => {
      try {
        fn(newState, prevState);
      } catch (err) {
        console.error('[SovraCoreStateMachine] Error in state listener:', err);
      }
    });
  }
}
