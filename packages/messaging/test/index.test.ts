import { describe, it, expect } from 'vitest';
import { DecryptionError, SessionEstablishmentError, MessageDeliveryState } from '../src/index.js';

describe('@sovra/messaging', () => {
  it('instantiates session establishment error with context', () => {
    const error = new SessionEstablishmentError('Failed X3DH key agreement', {
      peerDid: 'did:key:z6MkuBob',
    });
    expect(error.code).toBe('ERR_MESSAGING_SESSION_ESTABLISHMENT_FAILED');
    expect(error.context).toEqual({ peerDid: 'did:key:z6MkuBob' });
  });

  it('instantiates decryption error', () => {
    const error = new DecryptionError();
    expect(error.code).toBe('ERR_MESSAGING_DECRYPTION_FAILED');
    expect(error.message).toContain('could not be decrypted');
  });

  it('defines valid delivery states', () => {
    const states: MessageDeliveryState[] = ['sending', 'sent', 'delivered', 'read', 'failed'];
    expect(states).toContain('delivered');
  });
});
