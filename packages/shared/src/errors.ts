/**
 * Sovra Base Error Classes
 */

export class SovraError extends Error {
  public readonly code: string;
  public readonly timestamp: number;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code = 'ERR_SOVRA_UNKNOWN', context?: Record<string, unknown>) {
    super(message);
    this.name = 'SovraError';
    this.code = code;
    this.timestamp = Date.now();
    if (context !== undefined) {
      this.context = context;
    }
  }
}

export class ValidationError extends SovraError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_VALIDATION_FAILED', context);
    this.name = 'ValidationError';
  }
}

export class NetworkError extends SovraError {
  constructor(message: string, code = 'ERR_NETWORK_FAILURE', context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'NetworkError';
  }
}

export class SecurityError extends SovraError {
  constructor(message: string, code = 'ERR_SECURITY_VIOLATION', context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'SecurityError';
  }
}

export class NotFoundError extends SovraError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_NOT_FOUND', context);
    this.name = 'NotFoundError';
  }
}
