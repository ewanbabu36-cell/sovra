import { NetworkError } from '@sovra/shared';

export class P2PError extends NetworkError {
  constructor(message: string, code = 'ERR_P2P_GENERIC', context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'P2PError';
  }
}

export class PeerConnectionError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_CONNECTION_FAILED', context);
    this.name = 'PeerConnectionError';
  }
}

export class TransportError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_TRANSPORT', context);
    this.name = 'TransportError';
  }
}

export class RelayUnavailableError extends P2PError {
  constructor(message = 'No reachable circuit relays found', context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_RELAY_UNAVAILABLE', context);
    this.name = 'RelayUnavailableError';
  }
}

export class PubSubPublishError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_PUBSUB_PUBLISH', context);
    this.name = 'PubSubPublishError';
  }
}

export class PeerAuthenticationError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_PEER_AUTH_FAILED', context);
    this.name = 'PeerAuthenticationError';
  }
}

export class HandshakeError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_HANDSHAKE_FAILED', context);
    this.name = 'HandshakeError';
  }
}

export class StreamMultiplexError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_STREAM_MULTIPLEX', context);
    this.name = 'StreamMultiplexError';
  }
}

export class MessageValidationError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_MESSAGE_VALIDATION_FAILED', context);
    this.name = 'MessageValidationError';
  }
}

export class RequestTimeoutError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_REQUEST_TIMEOUT', context);
    this.name = 'RequestTimeoutError';
  }
}

export class PeerRateLimitError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_RATE_LIMIT_EXCEEDED', context);
    this.name = 'PeerRateLimitError';
  }
}

export class ResourceExceededError extends P2PError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_P2P_RESOURCE_EXCEEDED', context);
    this.name = 'ResourceExceededError';
  }
}
