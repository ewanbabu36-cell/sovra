import { describe, it, expect } from 'vitest';
import {
  WebRtcDataChannelBitSwapAdapter,
  MinimalDataChannel,
} from '../src/webrtc-bitswap.js';
import { BitSwapMessage } from '../src/bitswap.js';

class MockDataChannel implements MinimalDataChannel {
  public readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'open';
  public onmessage: ((ev: { data: any }) => void) | null = null;
  public onclose: ((ev: any) => void) | null = null;
  public peerChannel: MockDataChannel | null = null;

  public send(data: string | ArrayBuffer | Uint8Array): void {
    if (this.peerChannel && this.peerChannel.onmessage) {
      const copy = data instanceof Uint8Array ? new Uint8Array(data) : data;
      this.peerChannel.onmessage({ data: copy });
    }
  }

  public close(): void {
    this.readyState = 'closed';
    if (this.onclose) this.onclose({});
    if (this.peerChannel && this.peerChannel.onclose) {
      this.peerChannel.readyState = 'closed';
      this.peerChannel.onclose({});
    }
  }
}

describe('WebRTC DataChannel BitSwap Swarm Transport', () => {
  it('exchanges BitSwap wantlists and data blocks directly over WebRTC DataChannel', async () => {
    const aliceAdapter = new WebRtcDataChannelBitSwapAdapter();
    const bobAdapter = new WebRtcDataChannelBitSwapAdapter();

    const aliceCh = new MockDataChannel();
    const bobCh = new MockDataChannel();
    aliceCh.peerChannel = bobCh;
    bobCh.peerChannel = aliceCh;

    aliceAdapter.attachDataChannel('peer_bob', aliceCh);
    bobAdapter.attachDataChannel('peer_alice', bobCh);

    expect(aliceAdapter.getConnectedPeers()).toEqual(['peer_bob']);
    expect(bobAdapter.getConnectedPeers()).toEqual(['peer_alice']);

    // Setup listener on Bob
    let bobReceivedMessage: BitSwapMessage | null = null;
    bobAdapter.onMessage((fromPeer, message) => {
      expect(fromPeer).toBe('peer_alice');
      bobReceivedMessage = message;
    });

    // 1. Alice sends WantList for a 4K video CID
    const wantMsg: BitSwapMessage = {
      wantlist: [
        {
          cid: 'bafybeicg2u7nv4z66pksu777',
          priority: 1,
          cancel: false,
          wantType: 'WANT_BLOCK',
          sendDontHave: true,
        },
      ],
    };

    await aliceAdapter.sendMessage('peer_bob', wantMsg);

    expect(bobReceivedMessage).not.toBeNull();
    expect((bobReceivedMessage as any).wantlist?.[0]?.cid).toBe('bafybeicg2u7nv4z66pksu777');

    // 2. Bob replies with 256 KiB data chunk
    const blockData = new Uint8Array(256 * 1024).fill(0x42);
    let aliceReceivedMessage: BitSwapMessage | null = null;
    aliceAdapter.onMessage((fromPeer, message) => {
      expect(fromPeer).toBe('peer_bob');
      aliceReceivedMessage = message;
    });

    const blockMsg: BitSwapMessage = {
      blocks: [
        {
          cid: 'bafybeicg2u7nv4z66pksu777',
          data: blockData,
        },
      ],
    };

    await bobAdapter.sendMessage('peer_alice', blockMsg);

    expect(aliceReceivedMessage).not.toBeNull();
    const receivedBlock = (aliceReceivedMessage as any).blocks?.[0];
    expect(receivedBlock?.cid).toBe('bafybeicg2u7nv4z66pksu777');
    expect(receivedBlock?.data?.length).toBe(256 * 1024);
    expect(receivedBlock?.data?.[0]).toBe(0x42);

    // Alice now knows Bob is a provider for this CID
    const providers = await aliceAdapter.findProviders('bafybeicg2u7nv4z66pksu777');
    expect(providers).toContain('peer_bob');
  });
});
