import { describe, it, expect } from 'vitest';
import { APPROVED_CRYPTO_LIBRARIES, CryptoError, InvalidSignatureError } from '../src/index.js';

describe('@sovra/crypto', () => {
  it('registers vetted cryptographic dependencies with strict audit metadata', () => {
    expect(APPROVED_CRYPTO_LIBRARIES.length).toBeGreaterThan(0);
    const nobleCurves = APPROVED_CRYPTO_LIBRARIES.find(lib => lib.library === '@noble/curves');
    expect(nobleCurves).toBeDefined();
    expect(nobleCurves?.maintenanceStatus).toBe('audited');
    expect(nobleCurves?.specification).toContain('RFC 8032');
  });

  it('instantiates cryptographic error hierarchies properly', () => {
    const error = new InvalidSignatureError('Signature does not match payload', {
      algorithm: 'Ed25519',
    });
    expect(error).toBeInstanceOf(CryptoError);
    expect(error.code).toBe('ERR_CRYPTO_INVALID_SIGNATURE');
    expect(error.context).toEqual({ algorithm: 'Ed25519' });
  });
});
