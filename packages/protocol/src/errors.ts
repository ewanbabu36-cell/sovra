import { SovraError } from '@sovra/shared';

export class ProtocolError extends SovraError {
  constructor(message: string, code = 'ERR_PROTOCOL_VIOLATION', context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'ProtocolError';
  }
}

export class InvalidEventError extends ProtocolError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_PROTOCOL_INVALID_EVENT', context);
    this.name = 'InvalidEventError';
  }
}

export class SignatureVerificationFailedError extends ProtocolError {
  constructor(
    message = 'Event signature does not match author public key',
    context?: Record<string, unknown>,
  ) {
    super(message, 'ERR_PROTOCOL_SIGNATURE_INVALID', context);
    this.name = 'SignatureVerificationFailedError';
  }
}

export class TimestampOutOfRangeError extends ProtocolError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_PROTOCOL_TIMESTAMP_DRIFT', context);
    this.name = 'TimestampOutOfRangeError';
  }
}

export class UnknownEventKindError extends ProtocolError {
  constructor(kind: number, context?: Record<string, unknown>) {
    super(`Unknown or unsupported event kind: ${kind}`, 'ERR_PROTOCOL_UNKNOWN_KIND', {
      ...context,
      kind,
    });
    this.name = 'UnknownEventKindError';
  }
}
