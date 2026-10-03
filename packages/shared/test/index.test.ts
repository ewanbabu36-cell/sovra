import { describe, it, expect } from 'vitest';
import {
  SovraError,
  ValidationError,
  sanitizeContext,
  MonotonicClock,
  ok,
  err,
} from '../src/index.js';

describe('@sovra/shared', () => {
  it('correctly constructs errors with timestamps and codes', () => {
    const error = new ValidationError('Invalid input data', { field: 'username' });
    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('ERR_VALIDATION_FAILED');
    expect(error.context).toEqual({ field: 'username' });
    expect(error.timestamp).toBeGreaterThan(0);
  });

  it('sanitizes sensitive keys in logger context', () => {
    const rawContext = {
      user: 'alice',
      privateKey: 'super_secret_ed25519_key',
      seedPhrase: 'twelve words mnemonic secret',
      safeMetric: 42,
    };

    const sanitized = sanitizeContext(rawContext);
    expect(sanitized).toBeDefined();
    expect(sanitized?.['user']).toBe('alice');
    expect(sanitized?.['privateKey']).toBe('[REDACTED]');
    expect(sanitized?.['seedPhrase']).toBe('[REDACTED]');
    expect(sanitized?.['safeMetric']).toBe(42);
  });

  it('monotonic clock produces forward-progressing timestamps', async () => {
    const clock = new MonotonicClock();
    const t1 = clock.nowMillis();
    await new Promise(resolve => setTimeout(resolve, 10));
    const t2 = clock.nowMillis();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it('result types function correctly', () => {
    const success = ok(100);
    const failure = err(new Error('fail'));

    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.value).toBe(100);
    }

    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.message).toBe('fail');
    }
  });
});
