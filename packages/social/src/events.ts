import {
  SovraEvent,
  EventKind,
  EventTag,
  ContentReference,
  createSignedSovraEvent,
} from '@sovra/protocol';
import {
  FollowPayload,
  BlockPayload,
  MutePayload,
  ReactionPayload,
} from './types.js';

export function createSignedFollowEvent(
  authorPubkey: string,
  authorPrivateKey: Uint8Array,
  targetPubkey: string,
  isUnfollow = false,
  relayHints?: readonly string[],
  createdAt = Math.floor(Date.now() / 1000),
): SovraEvent {
  const payload: FollowPayload = {
    targetPubkey,
    isUnfollow,
    relayHints,
  };

  const tags: EventTag[] = [
    ['p', targetPubkey],
    ['action', isUnfollow ? 'unfollow' : 'follow'],
  ];

  if (relayHints && relayHints.length > 0) {
    for (const hint of relayHints) {
      tags.push(['relay', hint]);
    }
  }

  return createSignedSovraEvent(
    {
      pubkey: authorPubkey,
      createdAt,
      kind: EventKind.Follow,
      tags,
      content: JSON.stringify(payload),
    },
    authorPrivateKey,
  );
}

export function createSignedBlockEvent(
  authorPubkey: string,
  authorPrivateKey: Uint8Array,
  targetPubkey: string,
  isUnblock = false,
  reason?: string,
  createdAt = Math.floor(Date.now() / 1000),
): SovraEvent {
  const payload: BlockPayload = {
    targetPubkey,
    isUnblock,
    reason,
  };

  const tags: EventTag[] = [
    ['p', targetPubkey],
    ['action', isUnblock ? 'unblock' : 'block'],
  ];

  return createSignedSovraEvent(
    {
      pubkey: authorPubkey,
      createdAt,
      kind: EventKind.Block,
      tags,
      content: JSON.stringify(payload),
    },
    authorPrivateKey,
  );
}

export function createSignedMuteEvent(
  authorPubkey: string,
  authorPrivateKey: Uint8Array,
  targetPubkey: string,
  isUnmute = false,
  durationSeconds?: number,
  createdAt = Math.floor(Date.now() / 1000),
): SovraEvent {
  const payload: MutePayload = {
    targetPubkey,
    isUnmute,
    durationSeconds,
  };

  const tags: EventTag[] = [
    ['p', targetPubkey],
    ['action', isUnmute ? 'unmute' : 'mute'],
  ];

  return createSignedSovraEvent(
    {
      pubkey: authorPubkey,
      createdAt,
      kind: EventKind.Mute,
      tags,
      content: JSON.stringify(payload),
    },
    authorPrivateKey,
  );
}

export function createSignedReactionEvent(
  authorPubkey: string,
  authorPrivateKey: Uint8Array,
  targetEventId: string,
  emoji: string,
  isRetraction = false,
  createdAt = Math.floor(Date.now() / 1000),
): SovraEvent {
  const payload: ReactionPayload = {
    targetEventId,
    emoji,
    isRetraction,
  };

  const tags: EventTag[] = [
    ['e', targetEventId],
    ['emoji', emoji],
    ['action', isRetraction ? 'retract' : 'react'],
  ];

  return createSignedSovraEvent(
    {
      pubkey: authorPubkey,
      createdAt,
      kind: EventKind.Reaction,
      tags,
      content: JSON.stringify(payload),
    },
    authorPrivateKey,
  );
}

export function createSignedShortPost(
  authorPubkey: string,
  authorPrivateKey: Uint8Array,
  content: string,
  media?: readonly ContentReference[],
  tags: readonly EventTag[] = [],
  createdAt = Math.floor(Date.now() / 1000),
): SovraEvent {
  return createSignedSovraEvent(
    {
      pubkey: authorPubkey,
      createdAt,
      kind: EventKind.ShortPost,
      tags,
      content,
      media,
    },
    authorPrivateKey,
  );
}
