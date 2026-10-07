/**
 * @file packages/protocol/src/pipeline.ts
 * Unified 11-Stage Protocol Event Validation Pipeline.
 *
 * Enforces identical validation rules whether events originate from:
 * - Local UI / Local API
 * - Bluetooth Low Energy (BLE) Mesh
 * - Wi-Fi / TCP Sockets
 * - WebRTC DataChannels
 * - Imported Backups / GossipSync
 */

import {
  SovraProtocolEvent,
  isProtocolVersionSupported,
} from './protocol-event.js';
import {
  ProtocolAuthorizationEngine,
  AuthorizationDecision,
  AuthorizationEvaluationResult,
} from './authorization.js';

export interface ValidationPipelineResult {
  readonly isValid: boolean;
  readonly decision: AuthorizationDecision;
  readonly event?: SovraProtocolEvent | undefined;
  readonly error?: string | undefined;
}

export class EventValidationPipeline {
  private readonly authEngine: ProtocolAuthorizationEngine;

  constructor(authEngine?: ProtocolAuthorizationEngine) {
    this.authEngine = authEngine ?? new ProtocolAuthorizationEngine();
  }

  /**
   * Evaluates an arbitrary event payload through the unified 11-stage pipeline.
   */
  public async validate(
    candidate: unknown,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<ValidationPipelineResult> {
    // Stage 1: Basic Structural Shape Check
    if (!candidate || typeof candidate !== 'object') {
      return {
        isValid: false,
        decision: 'INVALID_STATE',
        error: 'Event must be a non-null object',
      };
    }

    const raw = candidate as Record<string, unknown>;

    // Stage 2: Required Fields Check
    if (
      typeof raw['eventId'] !== 'string' ||
      typeof raw['eventType'] !== 'string' ||
      typeof raw['createdAt'] !== 'number' ||
      typeof raw['nonce'] !== 'string' ||
      typeof raw['signature'] !== 'string' ||
      !raw['protocolVersion'] ||
      !raw['author'] ||
      !raw['logicalClock']
    ) {
      return {
        isValid: false,
        decision: 'INVALID_STATE',
        error: 'Malformed event: missing required protocol envelope fields',
      };
    }

    const event = candidate as SovraProtocolEvent;

    // Stage 3: Protocol Version Compatibility
    if (!isProtocolVersionSupported(event.protocolVersion)) {
      return {
        isValid: false,
        decision: 'POLICY_DENIED',
        error: `Unsupported protocol version ${event.protocolVersion.major}.${event.protocolVersion.minor}`,
      };
    }

    // Stages 4-11: Cryptographic Integrity, Replay, Timestamp, Identity, Capability, Ownership, State
    const authResult: AuthorizationEvaluationResult = await this.authEngine.authorizeEvent(event, nowSeconds);

    if (!authResult.isAuthorized) {
      return {
        isValid: false,
        decision: authResult.decision,
        error: authResult.reason ?? `Validation failed with decision: ${authResult.decision}`,
      };
    }

    return {
      isValid: true,
      decision: 'AUTHORIZED',
      event,
    };
  }
}
