/**
 * @file packages/protocol/src/errors.ts
 * Standardized Protocol Error Model & Classification.
 */

import { SovraError } from '@sovra/shared';

export type ProtocolErrorCode =
  | 'MALFORMED'
  | 'INVALID_SIGNATURE'
  | 'UNKNOWN_IDENTITY'
  | 'UNAUTHORIZED'
  | 'REPLAY'
  | 'EXPIRED'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_STATE'
  | 'POLICY_DENIED'
  | 'STORAGE_FAILURE'
  | 'TRANSPORT_FAILURE'
  | 'SYNC_FAILURE';

export class ProtocolError extends SovraError {
  public readonly protocolCode: ProtocolErrorCode;

  constructor(
    message: string,
    protocolCode: ProtocolErrorCode = 'MALFORMED',
    legacyCode = 'ERR_PROTOCOL_VIOLATION',
    context?: Record<string, unknown>,
  ) {
    super(message, legacyCode, { ...context, protocolCode });
    this.name = 'ProtocolError';
    this.protocolCode = protocolCode;
  }
}

export class InvalidEventError extends ProtocolError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'MALFORMED', 'ERR_PROTOCOL_INVALID_EVENT', context);
    this.name = 'InvalidEventError';
  }
}

export class SignatureVerificationFailedError extends ProtocolError {
  constructor(
    message = 'Event signature does not match author public key',
    context?: Record<string, unknown>,
  ) {
    super(message, 'INVALID_SIGNATURE', 'ERR_PROTOCOL_SIGNATURE_INVALID', context);
    this.name = 'SignatureVerificationFailedError';
  }
}

export class TimestampOutOfRangeError extends ProtocolError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'EXPIRED', 'ERR_PROTOCOL_TIMESTAMP_DRIFT', context);
    this.name = 'TimestampOutOfRangeError';
  }
}

export class UnknownEventKindError extends ProtocolError {
  constructor(kind: number | string, context?: Record<string, unknown>) {
    super(`Unknown or unsupported event kind: ${kind}`, 'UNSUPPORTED_VERSION', 'ERR_PROTOCOL_UNKNOWN_KIND', {
      ...context,
      kind,
    });
    this.name = 'UnknownEventKindError';
  }
}

export class ReplayViolationError extends ProtocolError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'REPLAY', 'ERR_PROTOCOL_REPLAY', context);
    this.name = 'ReplayViolationError';
  }
}

export class UnauthorizedOperationError extends ProtocolError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'UNAUTHORIZED', 'ERR_PROTOCOL_UNAUTHORIZED', context);
    this.name = 'UnauthorizedOperationError';
  }
}

export class StorageFailureError extends ProtocolError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'STORAGE_FAILURE', 'ERR_PROTOCOL_STORAGE_FAILURE', context);
    this.name = 'StorageFailureError';
  }
}
