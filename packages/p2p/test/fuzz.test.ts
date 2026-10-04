import { describe, it, expect } from 'vitest';
import { secureRandomBytes } from '@sovra/crypto';
import { EventValidationPipeline } from '../src/validation.js';
import { decodeYamuxHeader, StreamMultiplexer } from '../src/multiplex.js';
import { KademliaDHT } from '../src/dht.js';
import { GossipSubRouter } from '../src/gossipsub.js';
import { PeerScoringEngine } from '../src/scoring.js';
import { RequestResponseManager } from '../src/reqresp.js';
import { LengthPrefixedFrameCodec } from '../src/transport.js';

describe('P2P Protocol Robustness & Fuzz Testing Suite', () => {
  it('fuzzes EventValidationPipeline with 1,000 random/malformed inputs without crash or hang', () => {
    for (let i = 0; i < 1000; i++) {
      const length = Math.floor(Math.random() * 2048) + 1;
      const randomInput = secureRandomBytes(length);

      // Mutate some with prefix JSON
      if (i % 3 === 0) {
        randomInput[0] = 0x7b; // '{'
        randomInput[randomInput.length - 1] = 0x7d; // '}'
      }

      const result = EventValidationPipeline.validate(randomInput);
      expect(result).toBeDefined();
      expect(result.isValid).toBe(false);
      expect(typeof result.errorCode).toBe('string');
    }
  });

  it('fuzzes Yamux frame header decoder with malformed buffer lengths and invalid fields', () => {
    // 0 to 11 bytes buffers (less than 12-byte header)
    for (let len = 0; len < 12; len++) {
      const shortBuf = new Uint8Array(len);
      expect(() => decodeYamuxHeader(shortBuf)).toThrow();
    }

    // 12 bytes buffers with random bit patterns
    for (let i = 0; i < 500; i++) {
      const headerBuf = secureRandomBytes(12);
      const header = decodeYamuxHeader(headerBuf);
      expect(header).toBeDefined();
      expect(header.version).toBe(headerBuf[0]);
    }
  });

  it('fuzzes StreamMultiplexer.receiveRawBytes with arbitrary binary streams without uncaught throws', async () => {
    const mux = new StreamMultiplexer(false, async () => {});

    for (let i = 0; i < 500; i++) {
      const rawBytes = secureRandomBytes(Math.floor(Math.random() * 512) + 1);
      try {
        await mux.receiveRawBytes(rawBytes);
      } catch (err) {
        // Expected StreamMultiplexerError on malformed frames
        expect(err).toBeDefined();
      }
    }
  });

  it('fuzzes LengthPrefixedFrameCodec with fragmented, truncated, and oversized chunks', () => {
    const codec = new LengthPrefixedFrameCodec();

    for (let i = 0; i < 500; i++) {
      const chunk = secureRandomBytes(Math.floor(Math.random() * 256) + 1);
      codec.appendData(chunk);
      const frames = codec.drainFrames();
      expect(Array.isArray(frames)).toBe(true);
    }
  });

  it('fuzzes Kademlia DHT RPC message handler with corrupt messages', () => {
    const dht = new KademliaDHT('12D3KooWFuzzTarget');

    const corruptMessages = [
      { type: 'UNKNOWN_OP', senderPeerId: 'p1', targetKey: 'k1' } as any,
      { type: 'PUT_VALUE', senderPeerId: 'p1', targetKey: 'k1' }, // Missing record
      { type: 'ADD_PROVIDER', senderPeerId: 'p1', targetKey: 'k1' }, // Missing provider
      { type: null, senderPeerId: null, targetKey: null } as any,
      {} as any,
    ];

    for (const msg of corruptMessages) {
      const res = dht.handleRpcMessage(msg);
      expect(res).toBeDefined();
      if (!res.success) {
        expect(typeof res.error).toBe('string');
      }
    }
  });

  it('fuzzes GossipSub handleInboundPacket with corrupt and adversarial control packets', async () => {
    const scoring = new PeerScoringEngine();
    const router = new GossipSubRouter('12D3KooWRouter', scoring);

    const corruptPackets = [
      {},
      { graft: [{ topic: '' }] },
      { prune: [{ topic: '/test', backoffSeconds: -100 }] },
      { ihave: [{ topic: '/test', messageIds: [] }] },
      { iwant: [{ messageIds: [''] }] },
      { publish: { topic: '', fromPeerId: '', data: new Uint8Array(0), sequenceNumber: 0n, receivedAt: 0 } },
    ];

    for (const packet of corruptPackets) {
      const handled = await router.handleInboundPacket('12D3KooWAttacker', packet as any);
      expect(typeof handled).toBe('boolean');
    }
  });

  it('fuzzes RequestResponseManager handleInboundMessage with arbitrary JSON and binary', async () => {
    const reqResp = new RequestResponseManager();

    for (let i = 0; i < 500; i++) {
      const arbitraryBytes = secureRandomBytes(Math.floor(Math.random() * 256) + 1);
      const response = await reqResp.handleInboundMessage('12D3KooWRemote', arbitraryBytes);
      // Malformed inputs are safely absorbed or return undefined
      expect(response === undefined || response instanceof Uint8Array).toBe(true);
    }
  });
});
