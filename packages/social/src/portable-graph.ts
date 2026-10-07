/**
 * @file packages/social/src/portable-graph.ts
 * Portable Cryptographic Social Graph Export & Import Engine.
 *
 * Implements:
 * 1. User-owned verifiable export of follows, blocks, mutes, and friends.
 * 2. Deterministic RFC 8785 canonical JSON serialization with Ed25519 signature.
 * 3. Tamper-evident graph envelope that can be restored into any node or device.
 */

import { Result, ok, err } from '@sovra/shared';
import {
  sha256,
  bytesToHex,
  hexToBytes,
  signEd25519,
  verifyEd25519,
} from '@sovra/crypto';
import { decodeEd25519DidKey } from '@sovra/identity';
import { canonicalizeJson } from '@sovra/protocol';
import { SocialGraphEngine } from './types.js';

export interface ExportedSocialGraphData {
  readonly did: string;
  readonly exportedAt: number;
  readonly follows: ReadonlyArray<{ readonly targetPubkey: string; readonly createdAt: number }>;
  readonly blocks: ReadonlyArray<{ readonly targetPubkey: string; readonly createdAt: number; readonly reason?: string | undefined }>;
  readonly mutes: ReadonlyArray<{ readonly targetPubkey: string; readonly createdAt: number; readonly expiresAt?: number | undefined }>;
  readonly friends: ReadonlyArray<{ readonly targetPubkey: string; readonly createdAt: number }>;
}

export interface ExportedSocialGraphEnvelope {
  readonly data: ExportedSocialGraphData;
  readonly signatureHex: string;
}

export class PortableSocialGraphManager {
  /**
   * Exports user's social graph from engine into a signed, portable envelope.
   */
  public static exportGraph(
    engine: SocialGraphEngine,
    userDid: string,
    userPrivateKey: Uint8Array,
  ): ExportedSocialGraphEnvelope {
    const pubkeyHex = bytesToHex(decodeEd25519DidKey(userDid));

    const following = engine.getFollowing(pubkeyHex);
    const blocked = engine.getBlockedUsers(pubkeyHex);
    const muted = engine.getMutedUsers(pubkeyHex);
    const friends = engine.getFriends(pubkeyHex);

    const data: ExportedSocialGraphData = {
      did: userDid,
      exportedAt: Date.now(),
      follows: following.map((target: string) => ({ targetPubkey: target, createdAt: Date.now() })),
      blocks: blocked.map((target: string) => ({ targetPubkey: target, createdAt: Date.now() })),
      mutes: muted.map((target: string) => ({ targetPubkey: target, createdAt: Date.now() })),
      friends: friends.map((target: string) => ({ targetPubkey: target, createdAt: Date.now() })),
    };

    const canonical = canonicalizeJson(data);
    const hash = sha256(new TextEncoder().encode(canonical));
    const sig = signEd25519(userPrivateKey, hash);

    return {
      data,
      signatureHex: bytesToHex(sig),
    };
  }

  /**
   * Verifies and restores a portable social graph envelope into the target engine.
   */
  public static verifyAndImportGraph(
    envelope: ExportedSocialGraphEnvelope,
    engine: SocialGraphEngine,
  ): Result<{
    followsImported: number;
    blocksImported: number;
    mutesImported: number;
    friendsImported: number;
  }> {
    try {
      // 1. Decode public key from DID
      const pubkey = decodeEd25519DidKey(envelope.data.did);

      // 2. Verify Ed25519 signature over canonical representation
      const canonical = canonicalizeJson(envelope.data);
      const hash = sha256(new TextEncoder().encode(canonical));
      const sigBytes = hexToBytes(envelope.signatureHex);

      const isValid = verifyEd25519(pubkey, hash, sigBytes);
      if (!isValid) {
        return err(new Error('Social graph envelope signature verification failed: invalid signature'));
      }

      const userPubkeyHex = bytesToHex(pubkey);

      // 3. Apply edges into engine
      let followsImported = 0;
      let blocksImported = 0;
      let mutesImported = 0;
      let friendsImported = 0;

      for (const f of envelope.data.follows) {
        const fakeEvent: any = {
          id: bytesToHex(sha256(new TextEncoder().encode(`follow:${userPubkeyHex}:${f.targetPubkey}:${f.createdAt}`))),
          pubkey: userPubkeyHex,
          createdAt: f.createdAt,
          kind: 2, // Follow
          tags: [['p', f.targetPubkey]],
          content: JSON.stringify({ active: true }),
          sig: envelope.signatureHex,
        };
        engine.processEvent(fakeEvent);
        followsImported++;
      }

      for (const b of envelope.data.blocks) {
        const fakeEvent: any = {
          id: bytesToHex(sha256(new TextEncoder().encode(`block:${userPubkeyHex}:${b.targetPubkey}:${b.createdAt}`))),
          pubkey: userPubkeyHex,
          createdAt: b.createdAt,
          kind: 5, // Block
          tags: [['p', b.targetPubkey]],
          content: JSON.stringify({ active: true, reason: b.reason }),
          sig: envelope.signatureHex,
        };
        engine.processEvent(fakeEvent);
        blocksImported++;
      }

      for (const m of envelope.data.mutes) {
        const fakeEvent: any = {
          id: bytesToHex(sha256(new TextEncoder().encode(`mute:${userPubkeyHex}:${m.targetPubkey}:${m.createdAt}`))),
          pubkey: userPubkeyHex,
          createdAt: m.createdAt,
          kind: 6, // Mute
          tags: [['p', m.targetPubkey]],
          content: JSON.stringify({ active: true, expiresAt: m.expiresAt }),
          sig: envelope.signatureHex,
        };
        engine.processEvent(fakeEvent);
        mutesImported++;
      }

      for (const fr of envelope.data.friends) {
        const fakeEvent: any = {
          id: bytesToHex(sha256(new TextEncoder().encode(`friend:${userPubkeyHex}:${fr.targetPubkey}:${fr.createdAt}`))),
          pubkey: userPubkeyHex,
          createdAt: fr.createdAt,
          kind: 7, // FriendRequest
          tags: [['p', fr.targetPubkey]],
          content: JSON.stringify({ action: 'accept' }),
          sig: envelope.signatureHex,
        };
        engine.processEvent(fakeEvent);
        friendsImported++;
      }

      return ok({
        followsImported,
        blocksImported,
        mutesImported,
        friendsImported,
      });
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
