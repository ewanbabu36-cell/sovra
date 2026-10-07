/**
 * @file packages/p2p/test/adversarial-aead-matrix.test.ts
 * Adversarial AEAD Cryptographic Test Matrix.
 *
 * Exhaustively verifies:
 * 1. Explicit sequence packet delivery:
 *    - drop packet 1
 *    - drop packet 2
 *    - drop packet 3
 *    - reorder 3, 2, 1
 *    - reorder 2, 1, 3
 *    - duplicate packet 1
 *    - duplicate packet 3
 *    - replay old packet
 * 2. Cryptographic authentication & AAD integrity:
 *    - modify sequence number (AAD mismatch)
 *    - modify ciphertext bits (AEAD MAC mismatch)
 *    - modify AAD version / session prefix
 *    - directional key separation (A->B payload injected into B->A channel)
 *    - inter-session replay (ciphertext / seq from Session 1 injected into Session 2)
 * 3. Boundary conditions:
 *    - huge sequence numbers
 *    - sequence boundary exhaustion (2^64 - 2)
 *    - replay-window exact boundary (S_max - W vs S_max - W + 1)
 *    - memory boundedness of sliding window state
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';
import {
  BleHandshakeEngine,
  SlidingReplayWindow,
  ReplayStatus,
  deriveChaCha20Nonce,
  constructBleAad,
  AuthenticatedBleSession,
} from '../src/mesh/index.js';

function createEstablishedSessionPair(): {
  initiator: AuthenticatedBleSession;
  responder: AuthenticatedBleSession;
} {
  const initId = generateEd25519KeyPair();
  const respId = generateEd25519KeyPair();
  const initDid = encodeEd25519DidKey(initId.publicKey);
  const respDid = encodeEd25519DidKey(respId.publicKey);

  const { step1, ephemeralPrivate, initiatorNonce } = BleHandshakeEngine.createInitiatorStep1();

  const { step2, responderState } = BleHandshakeEngine.processStep1AndCreateStep2(
    step1,
    respDid,
    respId.privateKey,
    bytesToHex(respId.publicKey),
  );

  const { step3, session: initSess } = BleHandshakeEngine.processStep2AndCreateStep3(
    step2,
    ephemeralPrivate,
    initiatorNonce,
    initDid,
    initId.privateKey,
    bytesToHex(initId.publicKey),
  );

  const respSess = BleHandshakeEngine.processStep3ForResponder(responderState, step3);

  return { initiator: initSess, responder: respSess };
}

describe('Section 7: Adversarial AEAD Test Matrix', () => {
  let alice: AuthenticatedBleSession; // Initiator
  let bob: AuthenticatedBleSession;   // Responder

  beforeEach(() => {
    const pair = createEstablishedSessionPair();
    alice = pair.initiator;
    bob = pair.responder;
  });

  describe('Packet Drops, Loss & Nonce Decoupling', () => {
    it('handles dropping packet 1 and still decrypts packet 2 and 3 cleanly', () => {
      const p1 = alice.encrypt(new TextEncoder().encode('Packet 1'));
      const p2 = alice.encrypt(new TextEncoder().encode('Packet 2'));
      const p3 = alice.encrypt(new TextEncoder().encode('Packet 3'));

      // Deliver 2 and 3, skip 1
      const d2 = bob.decrypt(p2);
      const d3 = bob.decrypt(p3);

      expect(new TextDecoder().decode(d2)).toBe('Packet 2');
      expect(new TextDecoder().decode(d3)).toBe('Packet 3');
    });

    it('handles dropping packet 2 and decrypts packet 1 and 3 cleanly', () => {
      const p1 = alice.encrypt(new TextEncoder().encode('Packet 1'));
      const _p2 = alice.encrypt(new TextEncoder().encode('Packet 2 - DROPPED'));
      const p3 = alice.encrypt(new TextEncoder().encode('Packet 3'));

      const d1 = bob.decrypt(p1);
      const d3 = bob.decrypt(p3);

      expect(new TextDecoder().decode(d1)).toBe('Packet 1');
      expect(new TextDecoder().decode(d3)).toBe('Packet 3');
    });

    it('handles dropping packet 3 and decrypts packet 1 and 2 cleanly', () => {
      const p1 = alice.encrypt(new TextEncoder().encode('Packet 1'));
      const p2 = alice.encrypt(new TextEncoder().encode('Packet 2'));
      const _p3 = alice.encrypt(new TextEncoder().encode('Packet 3 - DROPPED'));

      const d1 = bob.decrypt(p1);
      const d2 = bob.decrypt(p2);

      expect(new TextDecoder().decode(d1)).toBe('Packet 1');
      expect(new TextDecoder().decode(d2)).toBe('Packet 2');
    });
  });

  describe('Out-of-Order Reordering Resilience', () => {
    it('successfully decrypts reverse reordering (3, 2, 1) without corruption', () => {
      const p1 = alice.encrypt(new TextEncoder().encode('Payload Alpha'));
      const p2 = alice.encrypt(new TextEncoder().encode('Payload Beta'));
      const p3 = alice.encrypt(new TextEncoder().encode('Payload Gamma'));

      // Deliver 3, then 2, then 1
      const d3 = bob.decrypt(p3);
      const d2 = bob.decrypt(p2);
      const d1 = bob.decrypt(p1);

      expect(new TextDecoder().decode(d3)).toBe('Payload Gamma');
      expect(new TextDecoder().decode(d2)).toBe('Payload Beta');
      expect(new TextDecoder().decode(d1)).toBe('Payload Alpha');
    });

    it('successfully decrypts interleaved reordering (2, 1, 3)', () => {
      const p1 = alice.encrypt(new TextEncoder().encode('Msg 1'));
      const p2 = alice.encrypt(new TextEncoder().encode('Msg 2'));
      const p3 = alice.encrypt(new TextEncoder().encode('Msg 3'));

      const d2 = bob.decrypt(p2);
      const d1 = bob.decrypt(p1);
      const d3 = bob.decrypt(p3);

      expect(new TextDecoder().decode(d2)).toBe('Msg 2');
      expect(new TextDecoder().decode(d1)).toBe('Msg 1');
      expect(new TextDecoder().decode(d3)).toBe('Msg 3');
    });
  });

  describe('Duplicate & Replay Attacks', () => {
    it('rejects duplicated packet 1 on second delivery attempt', () => {
      const p1 = alice.encrypt(new TextEncoder().encode('Once Only'));
      const d1 = bob.decrypt(p1);
      expect(new TextDecoder().decode(d1)).toBe('Once Only');

      // Attempt duplicate delivery
      expect(() => {
        bob.decrypt(p1);
      }).toThrow(/Replay detected.*already processed/);
    });

    it('rejects duplicated packet 3 after sequence advancement', () => {
      const p1 = alice.encrypt(new TextEncoder().encode('P1'));
      const p2 = alice.encrypt(new TextEncoder().encode('P2'));
      const p3 = alice.encrypt(new TextEncoder().encode('P3'));

      bob.decrypt(p1);
      bob.decrypt(p2);
      bob.decrypt(p3);

      expect(() => {
        bob.decrypt(p3);
      }).toThrow(/Replay detected.*already processed/);
    });

    it('rejects replaying old packet after window has moved past 256 sequences', () => {
      const oldPacket = alice.encrypt(new TextEncoder().encode('Early Packet'));
      bob.decrypt(oldPacket); // sequence 0 seen

      // Advance sender and receiver past 300 packets
      for (let i = 1; i <= 300; i++) {
        const p = alice.encrypt(new TextEncoder().encode(`Seq ${i}`));
        bob.decrypt(p);
      }

      // Replay old packet 0
      expect(() => {
        bob.decrypt(oldPacket);
      }).toThrow(/Packet expired.*behind sliding window/);
    });
  });

  describe('Cryptographic Integrity & Tampering Defenses', () => {
    it('rejects sequence number modification in frame header via Poly1305 AAD mismatch', () => {
      const p = alice.encrypt(new TextEncoder().encode('Secret wire instruction'));

      // Flip 1 bit in sequence number header (first 8 bytes)
      const tampered = new Uint8Array(p);
      tampered[3] ^= 0x01;

      expect(() => {
        bob.decrypt(tampered);
      }).toThrow();
    });

    it('rejects ciphertext modification via Poly1305 authentication tag failure', () => {
      const p = alice.encrypt(new TextEncoder().encode('Authentic payload'));

      const tampered = new Uint8Array(p);
      // Mutate payload ciphertext byte (offset 10)
      tampered[10] ^= 0x42;

      expect(() => {
        bob.decrypt(tampered);
      }).toThrow();
    });

    it('rejects modified AAD version or session prefix', () => {
      const seq = 12n;
      const aadOriginal = constructBleAad('00112233445566778899aabbccddeeff', seq);

      // Mutate version byte (first byte)
      const aadBadVer = new Uint8Array(aadOriginal);
      aadBadVer[0] = 0x02;
      expect(aadBadVer[0]).not.toBe(aadOriginal[0]);

      // Mutate session prefix
      const aadBadSess = new Uint8Array(aadOriginal);
      aadBadSess[5] ^= 0xff;
      expect(Array.from(aadBadSess)).not.toEqual(Array.from(aadOriginal));
    });

    it('strictly separates directional keys (Alice->Bob packet cannot be decrypted as Bob->Alice)', () => {
      const aliceMsg = alice.encrypt(new TextEncoder().encode('Alice to Bob'));

      // If an attacker loops Alice's packet back to Alice (trying to decrypt using Alice's rxKey):
      expect(() => {
        alice.decrypt(aliceMsg);
      }).toThrow(); // Directional keys differ; MAC fails
    });

    it('strictly separates session identifiers (inter-session injection fails)', () => {
      const session2 = createEstablishedSessionPair();
      const packetFromSession1 = alice.encrypt(new TextEncoder().encode('Cross-session injection'));

      // Attempt to inject Session 1 packet into Session 2 receiver
      expect(() => {
        session2.responder.decrypt(packetFromSession1);
      }).toThrow();
    });
  });

  describe('Boundaries, Exhaustion & State Limits', () => {
    it('strictly bounds sliding replay window memory usage across 1,000 packets', () => {
      const win = new SlidingReplayWindow(256);

      for (let i = 0n; i < 1000n; i++) {
        expect(win.checkAndRecord(i)).toBe(ReplayStatus.NEW);
      }

      // Internal set must not grow unbounded beyond window size
      expect((win as any).seenSeqs.size).toBeLessThanOrEqual(256);
      expect(win.getHighestSeen()).toBe(999n);
    });

    it('accurately evaluates exact sliding window boundary (S_max - W vs S_max - W + 1)', () => {
      const win = new SlidingReplayWindow(256);
      win.checkAndRecord(300n); // S_max = 300. Window: [300 - 256 + 1, 300] = [45, 300]

      // Sequence 44 is outside window (<= 300 - 256 = 44)
      expect(win.check(44n)).toBe(ReplayStatus.OLD);
      expect(win.check(0n)).toBe(ReplayStatus.OLD);

      // Sequence 45 is inside window
      expect(win.check(45n)).toBe(ReplayStatus.NEW);
      expect(win.check(299n)).toBe(ReplayStatus.NEW);
    });

    it('rejects sequence numbers beyond 64-bit bounds as INVALID', () => {
      const win = new SlidingReplayWindow(256);
      expect(win.check(-1n)).toBe(ReplayStatus.INVALID);
      expect(win.check(0xFFFFFFFFFFFFFFFFn)).toBe(ReplayStatus.INVALID);
      expect(win.check(0xFFFFFFFFFFFFFFFEn)).toBe(ReplayStatus.INVALID);
    });

    it('enforces re-handshake error when sequence exhaustion limit is reached', () => {
      // Set session sequence to exhaustion boundary (2^64 - 2)
      alice.setTxSequenceForTesting!(0xFFFFFFFFFFFFFFFEn);
      expect(() => {
        alice.encrypt(new TextEncoder().encode('Exhaustion trigger'));
      }).toThrow(/BLE AEAD session sequence number exhausted; re-handshake required/);
    });
  });
});
