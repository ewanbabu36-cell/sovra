import { describe, it, expect } from 'vitest';
import { FollowPayload, BlockPayload, ReactionPayload } from '../src/index.js';

describe('@sovra/social', () => {
  it('structures follow payload correctly', () => {
    const follow: FollowPayload = {
      targetPubkey: 'ed25519_target_pubkey',
      isUnfollow: false,
      relayHints: ['wss://relay.example.com'],
    };
    expect(follow.targetPubkey).toBe('ed25519_target_pubkey');
    expect(follow.isUnfollow).toBe(false);
  });

  it('structures block and reaction payloads correctly', () => {
    const block: BlockPayload = {
      targetPubkey: 'spammer_pubkey',
      reason: 'Spamming feed',
      isUnblock: false,
    };
    expect(block.reason).toBe('Spamming feed');

    const reaction: ReactionPayload = {
      targetEventId: 'event_42',
      emoji: '🔥',
      isRetraction: false,
    };
    expect(reaction.emoji).toBe('🔥');
  });
});
