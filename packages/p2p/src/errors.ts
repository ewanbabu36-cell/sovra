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
