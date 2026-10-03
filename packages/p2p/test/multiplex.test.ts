import { describe, it, expect } from 'vitest';
import { constantTimeEquals } from '@sovra/crypto';
import { StreamMultiplexer } from '../src/multiplex.js';
import { MuxedStream } from '../src/types.js';

describe('P2P Stream Multiplexing Suite (Yamux model)', () => {
  it('opens and routes concurrent logical streams over a multiplexed connection', async () => {
    let aliceWireBuffer: Uint8Array[] = [];
    let bobWireBuffer: Uint8Array[] = [];

    // Alice and Bob multiplexers connected via mock pipe
    const aliceMux = new StreamMultiplexer(true, async frame => {
      aliceWireBuffer.push(frame);
    });

    const bobMux = new StreamMultiplexer(false, async frame => {
      bobWireBuffer.push(frame);
    });

    const bobReceivedStreams: MuxedStream[] = [];
    bobMux.registerProtocolHandler('/sovra/reqresp/1.0.0', stream => {
      bobReceivedStreams.push(stream);
    });
    bobMux.registerProtocolHandler('/sovra/gossipsub/1.2.0', stream => {
      bobReceivedStreams.push(stream);
    });

    // Alice opens stream 1 for request/response
    const aliceStream1 = await aliceMux.openStream('/sovra/reqresp/1.0.0');
    // Deliver SYN frame to Bob
    while (aliceWireBuffer.length > 0) {
      await bobMux.receiveRawBytes(aliceWireBuffer.shift()!);
    }

    // Alice opens stream 2 for gossipsub
    const aliceStream2 = await aliceMux.openStream('/sovra/gossipsub/1.2.0');
    while (aliceWireBuffer.length > 0) {
      await bobMux.receiveRawBytes(aliceWireBuffer.shift()!);
    }

    expect(bobReceivedStreams.length).toBe(2);
    expect(bobReceivedStreams[0]?.protocolId).toBe('/sovra/reqresp/1.0.0');
    expect(bobReceivedStreams[1]?.protocolId).toBe('/sovra/gossipsub/1.2.0');

    // Transmit data on Stream 1
    const s1DataReceived: Uint8Array[] = [];
    bobReceivedStreams[0]?.onData(d => s1DataReceived.push(d));

    const s1Payload = new TextEncoder().encode('Payload on stream 1');
    await aliceStream1.send(s1Payload);
    while (aliceWireBuffer.length > 0) {
      await bobMux.receiveRawBytes(aliceWireBuffer.shift()!);
    }

    expect(s1DataReceived.length).toBe(1);
    expect(constantTimeEquals(s1DataReceived[0]!, s1Payload)).toBe(true);

    // Transmit data on Stream 2
    const s2DataReceived: Uint8Array[] = [];
    bobReceivedStreams[1]?.onData(d => s2DataReceived.push(d));

    const s2Payload = new TextEncoder().encode('Payload on stream 2');
    await aliceStream2.send(s2Payload);
    while (aliceWireBuffer.length > 0) {
      await bobMux.receiveRawBytes(aliceWireBuffer.shift()!);
    }

    expect(s2DataReceived.length).toBe(1);
    expect(constantTimeEquals(s2DataReceived[0]!, s2Payload)).toBe(true);
  });

  it('guarantees stream isolation: resetting one stream does not terminate other streams', async () => {
    let wireBuffer: Uint8Array[] = [];
    const aliceMux = new StreamMultiplexer(true, async f => {
      wireBuffer.push(f);
    });
    const bobMux = new StreamMultiplexer(false, async () => {});

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

    while (wireBuffer.length > 0) {
      await bobMux.receiveRawBytes(wireBuffer.shift()!);
    }

    expect(bobStream1?.isOpen).toBe(true);
    expect(bobStream2?.isOpen).toBe(true);

    // Reset Stream 1 from Alice
    aliceS1.reset('Intentional Stream 1 abort');
    while (wireBuffer.length > 0) {
      await bobMux.receiveRawBytes(wireBuffer.shift()!);
    }

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
    while (wireBuffer.length > 0) {
      await bobMux.receiveRawBytes(wireBuffer.shift()!);
    }

    expect(s2Data.length).toBe(1);
    expect(constantTimeEquals(s2Data[0]!, s2Msg)).toBe(true);
  });

  it('enforces maximum concurrent streams limit', async () => {
    const mux = new StreamMultiplexer(true, async () => {}, 3); // Max 3 streams

    await mux.openStream('/p1');
    await mux.openStream('/p2');
    await mux.openStream('/p3');

    // 4th stream should fail
    await expect(mux.openStream('/p4')).rejects.toThrowError(/Maximum concurrent streams/);
  });
});
