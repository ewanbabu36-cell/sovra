import { describe, it, expect } from 'vitest';
import { PeerConnectionError, RelayUnavailableError } from '../src/index.js';

describe('@sovra/p2p', () => {
  it('instantiates p2p network errors correctly', () => {
    const error = new PeerConnectionError('Timeout dialing peer', { peerId: '12D3KooWTest' });
    expect(error.code).toBe('ERR_P2P_CONNECTION_FAILED');
    expect(error.context).toEqual({ peerId: '12D3KooWTest' });
  });

  it('instantiates relay unavailable error with fallback semantics', () => {
    const relayError = new RelayUnavailableError();
    expect(relayError.code).toBe('ERR_P2P_RELAY_UNAVAILABLE');
    expect(relayError.message).toContain('circuit relays');
  });
});
