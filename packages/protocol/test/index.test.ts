import { describe, it, expect } from 'vitest';
import {
  canonicalizeJson,
  DefaultEventValidator,
  EventKind,
  SovraEvent,
  InvalidEventError,
} from '../src/index.js';

describe('@sovra/protocol', () => {
  it('canonicalizes JSON deterministically regardless of key order', () => {
    const objA = { z: 1, a: 'hello', m: [3, 2, 1] };
    const objB = { a: 'hello', m: [3, 2, 1], z: 1 };

    const canonicalA = canonicalizeJson(objA);
    const canonicalB = canonicalizeJson(objB);

    expect(canonicalA).toBe(canonicalB);
    expect(canonicalA).toBe('{"a":"hello","m":[3,2,1],"z":1}');
  });

  it('validates compliant signed event structure', () => {
    const validator = new DefaultEventValidator();
    const validEvent: SovraEvent = {
      id: 'hash123',
      pubkey: 'pubkey123',
      createdAt: Math.floor(Date.now() / 1000),
      kind: EventKind.ShortPost,
      tags: [['t', 'sovra']],
      content: 'Hello decentralized world',
      sig: 'sig123',
    };

    const result = validator.validateEventStructure(validEvent);
    expect(result.ok).toBe(true);
  });

  it('rejects events missing mandatory fields', () => {
    const validator = new DefaultEventValidator();
    const invalidEvent = {
      pubkey: 'pubkey123',
      // missing id, sig, createdAt
    };

    const result = validator.validateEventStructure(invalidEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidEventError);
    }
  });

  it('verifies timestamp acceptability within drift window', () => {
    const validator = new DefaultEventValidator();
    const now = Math.floor(Date.now() / 1000);
    expect(validator.isTimestampAcceptable(now)).toBe(true);
    expect(validator.isTimestampAcceptable(now - 100)).toBe(true);
    expect(validator.isTimestampAcceptable(now - 10000)).toBe(false);
  });
});
