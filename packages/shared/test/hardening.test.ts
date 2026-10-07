import { describe, it, expect } from 'vitest';
import {
  TokenBucketRateLimiter,
  resolveAllowedOrigin,
} from '../src/hardening.js';

describe('API Hardening Suite (@sovra/shared)', () => {
  it('enforces token-bucket rate limiting', () => {
    const limiter = new TokenBucketRateLimiter(5, 1); // 5 capacity, 1 token/sec

    // Consume 5 allowed
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume('user_ip_1')).toBe(true);
    }

    // 6th request rejected
    expect(limiter.consume('user_ip_1')).toBe(false);

    // Other IP unaffected
    expect(limiter.consume('user_ip_2')).toBe(true);
  });

  it('validates CORS origins in development vs production', () => {
    // Development policy allows origin or wildcard
    const devOrigin = resolveAllowedOrigin('http://localhost:3000', {
      maxJsonBytes: 1024,
      maxUploadBytes: 1024,
      trustedOrigins: ['http://localhost:3001'],
      isProduction: false,
    });
    expect(devOrigin).toBe('http://localhost:3000');

    // Production policy restricts to trusted origins
    const prodAllowed = resolveAllowedOrigin('http://trusted.sovra.net', {
      maxJsonBytes: 1024,
      maxUploadBytes: 1024,
      trustedOrigins: ['http://trusted.sovra.net'],
      isProduction: true,
    });
    expect(prodAllowed).toBe('http://trusted.sovra.net');

    const prodRejected = resolveAllowedOrigin('http://evil-attacker.com', {
      maxJsonBytes: 1024,
      maxUploadBytes: 1024,
      trustedOrigins: ['http://trusted.sovra.net'],
      isProduction: true,
    });
    expect(prodRejected).toBeNull();
  });
});
