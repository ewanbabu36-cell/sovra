/**
 * @file packages/protocol/src/transition.ts
 * Deterministic Protocol State Transition Engine.
 *
 * Implements:
 * Current State + Valid Event -> Pure State Transition -> New State
 * Guarantees zero invalid mutations and deterministic state projection.
 */

import { Result, ok, err } from '@sovra/shared';
import { SovraProtocolEvent } from './protocol-event.js';
import { EventValidationPipeline } from './pipeline.js';
import { ProtocolError, InvalidEventError } from './errors.js';

export interface StateTransitionResult<TState, TPatch = unknown> {
  readonly previousState: TState;
  readonly nextState: TState;
  readonly patch?: TPatch | undefined;
  readonly appliedEventId: string;
}

export type StateReducer<TState> = (
  currentState: TState,
  event: SovraProtocolEvent,
) => Result<{ nextState: TState; patch?: unknown }, ProtocolError>;

export class StateTransitionEngine<TState> {
  private currentState: TState;
  private readonly reducer: StateReducer<TState>;
  private readonly pipeline: EventValidationPipeline;
  private readonly appliedEventIds = new Set<string>();

  constructor(
    initialState: TState,
    reducer: StateReducer<TState>,
    pipeline?: EventValidationPipeline,
  ) {
    this.currentState = initialState;
    this.reducer = reducer;
    this.pipeline = pipeline ?? new EventValidationPipeline();
  }

  public getState(): TState {
    return this.currentState;
  }

  /**
   * Applies an incoming event through validation and state transition.
   * If validation fails or reducer rejects, current state remains untouched.
   */
  public async apply(
    eventCandidate: unknown,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<Result<StateTransitionResult<TState>, ProtocolError>> {
    // 1. Validate through unified pipeline
    const validation = await this.pipeline.validate(eventCandidate, nowSeconds);
    if (!validation.isValid || !validation.event) {
      return err(
        new InvalidEventError(
          `Event validation failed (${validation.decision}): ${validation.error}`,
          { decision: validation.decision },
        ),
      );
    }

    const event = validation.event;

    // 2. Check duplicate application
    if (this.appliedEventIds.has(event.eventId)) {
      return ok({
        previousState: this.currentState,
        nextState: this.currentState,
        appliedEventId: event.eventId,
      });
    }

    // 3. Apply reducer pure transition
    const previousState = this.currentState;
    const transitionRes = this.reducer(previousState, event);
    if (!transitionRes.ok) {
      return transitionRes;
    }

    this.currentState = transitionRes.value.nextState;
    this.appliedEventIds.add(event.eventId);

    return ok({
      previousState,
      nextState: this.currentState,
      patch: transitionRes.value.patch,
      appliedEventId: event.eventId,
    });
  }
}
