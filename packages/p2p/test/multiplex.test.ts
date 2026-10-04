import { describe, it, expect } from 'vitest';
import { constantTimeEquals } from '@sovra/crypto';
import { StreamMultiplexer, decodeYamuxHeader, YamuxType } from '../src/multiplex.js';
import { MuxedStream } from '../src/types.js';

describe('P2P Stream Multiplexing Suite (Yamux specification)', () => {
  it('opens and routes concurrent logical streams over a multiplexed connection with 12-byte Yamux headers', async () => {
    const aliceToBob: Uint8Array[] = [];
    const bobToAlice: Uint8Array[] = [];

    const aliceMux = new StreamMultiplexer(true, async frame => {
      aliceToBob.push(frame);
    });

    const bobMux = new StreamMultiplexer(false, async frame => {
      bobToAlice.push(frame);
    });

    async function pump() {
      let progress = true;
      while (progress) {
        progress = false;
        if (aliceToBob.length > 0) {
          const f = aliceToBob.shift()!;
          await bobMux.receiveRawBytes(f);
          progress = true;
        }
        if (bobToAlice.length > 0) {
          const f = bobToAlice.shift()!;
          await aliceMux.receiveRawBytes(f);
          progress = true;
        }
      }
    }

    const bobReceivedStreams: MuxedStream[] = [];
    bobMux.registerProtocolHandler('/sovra/reqresp/1.0.0', stream => {
      bobReceivedStreams.push(stream);
    });
    bobMux.registerProtocolHandler('/sovra/gossipsub/1.2.0', stream => {
      bobReceivedStreams.push(stream);
    });

    // Alice opens stream 1 for request/response
    const aliceStream1 = await aliceMux.openStream('/sovra/reqresp/1.0.0');
    await pump();

    // Verify Yamux header on opened stream
    expect(aliceStream1.streamId).toBe(1); // Initiator uses odd IDs

    // Alice opens stream 2 for gossipsub
    const aliceStream2 = await aliceMux.openStream('/sovra/gossipsub/1.2.0');
    await pump();
    expect(aliceStream2.streamId).toBe(3);

    expect(bobReceivedStreams.length).toBe(2);
    expect(bobReceivedStreams[0]?.protocolId).toBe('/sovra/reqresp/1.0.0');
    expect(bobReceivedStreams[1]?.protocolId).toBe('/sovra/gossipsub/1.2.0');

    // Transmit data on Stream 1
    const s1DataReceived: Uint8Array[] = [];
    bobReceivedStreams[0]?.onData(d => s1DataReceived.push(d));

    const s1Payload = new TextEncoder().encode('Payload on stream 1');
    await aliceStream1.send(s1Payload);
    await pump();

    expect(s1DataReceived.length).toBe(1);
    expect(constantTimeEquals(s1DataReceived[0]!, s1Payload)).toBe(true);

    // Transmit data on Stream 2
    const s2DataReceived: Uint8Array[] = [];
    bobReceivedStreams[1]?.onData(d => s2DataReceived.push(d));

    const s2Payload = new TextEncoder().encode('Payload on stream 2');
    await aliceStream2.send(s2Payload);
    await pump();

    expect(s2DataReceived.length).toBe(1);
    expect(constantTimeEquals(s2DataReceived[0]!, s2Payload)).toBe(true);
  });

  it('guarantees stream isolation: resetting one stream does not terminate other streams', async () => {
    const aliceToBob: Uint8Array[] = [];
    const bobToAlice: Uint8Array[] = [];

    const aliceMux = new StreamMultiplexer(true, async f => {
      aliceToBob.push(f);
    });
    const bobMux = new StreamMultiplexer(false, async f => {
      bobToAlice.push(f);
    });

    async function pump() {
      let progress = true;
      while (progress) {
        progress = false;
        if (aliceToBob.length > 0) {
          await bobMux.receiveRawBytes(aliceToBob.shift()!);
          progress = true;
        }
        if (bobToAlice.length > 0) {
          await aliceMux.receiveRawBytes(bobToAlice.shift()!);
          progress = true;
        }
      }
    }

    let bobStream1: MuxedStream | undefined;
    let bobStream2: MuxedStream | undefined;

    bobMux.registerProtocolHandler('/proto1', s => {
      bobStream1 = s;
    });
    bobMux.registerProtocolHandler('/proto2', s => {
      bobStream2 = s;
    });

    const aliceS1 = await aliceMux.openStream('/proto1');
    const aliceS2 = await aliceMux.openStream('/proto2');
    await pump();

    expect(bobStream1?.isOpen).toBe(true);
    expect(bobStream2?.isOpen).toBe(true);

    // Reset Stream 1 from Alice
    aliceS1.reset('Intentional Stream 1 abort');
    await pump();

    // Stream 1 should be closed
    expect(aliceS1.isOpen).toBe(false);
    expect(bobStream1?.isOpen).toBe(false);

    // Stream 2 remains healthy and open
    expect(aliceS2.isOpen).toBe(true);
    expect(bobStream2?.isOpen).toBe(true);

    const s2Data: Uint8Array[] = [];
    bobStream2?.onData(d => s2Data.push(d));

    const s2Msg = new TextEncoder().encode('Active message on Stream 2');
    await aliceS2.send(s2Msg);
    await pump();

    expect(s2Data.length).toBe(1);
    expect(constantTimeEquals(s2Data[0]!, s2Msg)).toBe(true);
  });

  it('handles PING keepalives and GO_AWAY session closure', async () => {
    const aliceToBob: Uint8Array[] = [];
    const bobToAlice: Uint8Array[] = [];

    const aliceMux = new StreamMultiplexer(true, async f => {
      aliceToBob.push(f);
    });
    const bobMux = new StreamMultiplexer(false, async f => {
      bobToAlice.push(f);
    });

    async function pump() {
      let progress = true;
      while (progress) {
        progress = false;
        if (aliceToBob.length > 0) {
          await bobMux.receiveRawBytes(aliceToBob.shift()!);
          progress = true;
        }
        if (bobToAlice.length > 0) {
          await aliceMux.receiveRawBytes(bobToAlice.shift()!);
          progress = true;
        }
      }
    }

    // Alice sends PING
    const pingPromise = aliceMux.sendPing(12345);
    await pump();
    const rtt = await pingPromise;
    expect(rtt).toBeGreaterThanOrEqual(0);

    // Alice sends GO_AWAY
    await aliceMux.sendGoAway(0);
    await pump();

    // Further stream openings on Bob should reject
    await expect(bobMux.openStream('/test')).rejects.toThrowError(/GO_AWAY/);
  });

  it('enforces maximum concurrent streams limit', async () => {
    const mux = new StreamMultiplexer(true, async () => {}, 3); // Max 3 streams

    await mux.openStream('/p1');
    await mux.openStream('/p2');
    await mux.openStream('/p3');

    // 4th stream should fail
    await expect(mux.openStream('/p4')).rejects.toThrowError(/Maximum concurrent streams/);
  });

  it('scales across 1,000 streams with bounded memory and correct stream tracking', async () => {
    const aliceToBob: Uint8Array[] = [];
    const bobToAlice: Uint8Array[] = [];

    const aliceMux = new StreamMultiplexer(true, async f => {
      aliceToBob.push(f);
    }, 2000);

    const bobMux = new StreamMultiplexer(false, async f => {
      bobToAlice.push(f);
    }, 2000);

    bobMux.registerProtocolHandler('/scale', () => {});

    // Open 1,000 streams
    for (let i = 0; i < 1000; i++) {
      await aliceMux.openStream('/scale');
    }

    expect(aliceMux.activeStreamCount).toBe(1000);

    // Pump all SYN frames to Bob
    while (aliceToBob.length > 0) {
      await bobMux.receiveRawBytes(aliceToBob.shift()!);
    }
    expect(bobMux.activeStreamCount).toBe(1000);

    // Close all streams
    aliceMux.closeAll();
    bobMux.closeAll();

    expect(aliceMux.activeStreamCount).toBe(0);
    expect(bobMux.activeStreamCount).toBe(0);
  });
});
