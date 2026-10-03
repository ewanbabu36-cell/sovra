import { describe, it, expect } from 'vitest';
import { DefaultEventValidator, EventKind, SovraEvent } from '@sovra/protocol';
import { MonotonicClock } from '@sovra/shared';

describe('Cross-Package Protocol Integration Verification', () => {
  it('validates signed events across protocol and shared clock packages', () => {
    const clock = new MonotonicClock();
    const validator = new DefaultEventValidator();

    const signedEvent: SovraEvent = {
      id: 'event-integration-test-id',
      pubkey: 'ed25519_author_pubkey',
      createdAt: clock.nowSeconds(),
      kind: EventKind.ShortPost,
      tags: [['t', 'integration']],
      content: 'Testing cross-package contracts',
      sig: 'test_signature_hex',
    };

    const result = validator.validateEventStructure(signedEvent);
    expect(result.ok).toBe(true);
    expect(validator.isTimestampAcceptable(signedEvent.createdAt)).toBe(true);
  });
});
