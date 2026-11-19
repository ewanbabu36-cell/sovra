import { describe, it, expect } from 'vitest';
import {
  WebRtcDataChannelBitSwapAdapter,
  MinimalDataChannel,
  SOVRA_WIRE_MAGIC,
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

describe('WebRTC DataChannel BitSwap Swarm Transport & Tit-for-Tat Engine', () => {
  it('exchanges BitSwap wantlists and enforces Tit-for-Tat choking/unchoking for data blocks', async () => {
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

    // Bob recognizes Alice is interested
    const aliceStateOnBob = bobAdapter.getPeerState('peer_alice');
    expect(aliceStateOnBob).toBeDefined();
    expect(aliceStateOnBob?.isInterested).toBe(true);

    // 2. Choking verification: Block transmission fails while Alice is choked
    const blockData = new Uint8Array(256 * 1024).fill(0x42);
    const blockMsg: BitSwapMessage = {
      blocks: [
        {
          cid: 'bafybeicg2u7nv4z66pksu777',
          data: blockData,
        },
      ],
    };

    await expect(bobAdapter.sendMessage('peer_alice', blockMsg)).rejects.toThrow(
      /CHOKED/
    );

    // 3. Bob unchokes Alice via Tit-for-Tat recalculation
    const tftResult = bobAdapter.recalculateTitForTat(4);
    expect(tftResult.unchoked).toContain('peer_alice');
    expect(bobAdapter.getPeerState('peer_alice')?.isChoked).toBe(false);

    // 4. Now block transmission succeeds seamlessly!
    let aliceReceivedMessage: BitSwapMessage | null = null;
    aliceAdapter.onMessage((fromPeer, message) => {
      expect(fromPeer).toBe('peer_bob');
      aliceReceivedMessage = message;
    });

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

  it('demonstrates BitTorrent-style choking of free-riders and optimistic unchoking', () => {
    const node = new WebRtcDataChannelBitSwapAdapter();

    // Attach 6 peers
    const peers = ['p1_fast', 'p2_fast', 'p3_fast', 'p4_med', 'p5_slow', 'p6_freerider'];
    for (const p of peers) {
      node.attachDataChannel(p, new MockDataChannel());
      const state = node.getPeerState(p)!;
      state.isInterested = true;
    }

    // Assign download rates (bandwidth received from each peer)
    node.getPeerState('p1_fast')!.downloadRate = 500000;
    node.getPeerState('p2_fast')!.downloadRate = 400000;
    node.getPeerState('p3_fast')!.downloadRate = 300000;
    node.getPeerState('p4_med')!.downloadRate = 200000;
    node.getPeerState('p5_slow')!.downloadRate = 100000;
    node.getPeerState('p6_freerider')!.downloadRate = 0; // Uploaded nothing!

    // Run Tit-for-Tat with maxUnchoked = 4
    const res = node.recalculateTitForTat(4);

    // Top 4 peers must be unchoked
    expect(res.unchoked).toEqual(['p1_fast', 'p2_fast', 'p3_fast', 'p4_med']);
    expect(node.getPeerState('p1_fast')!.isChoked).toBe(false);
    expect(node.getPeerState('p4_med')!.isChoked).toBe(false);

    // Exactly one of the remaining peers (p5_slow or p6_freerider) gets optimistic unchoke
    expect(res.optimistic).toBeDefined();
    expect(['p5_slow', 'p6_freerider']).toContain(res.optimistic);

    // The other one MUST be choked!
    expect(res.choked.length).toBe(1);
  });

  it('transmits and unwraps SIP-001 canonical wire frames across DataChannels', async () => {
    const signer = (commitBytes: Uint8Array) => new Uint8Array(64).fill(0x77);
    const aliceAdapter = new WebRtcDataChannelBitSwapAdapter({ signerFn: signer });
    const bobAdapter = new WebRtcDataChannelBitSwapAdapter();

    const aliceCh = new MockDataChannel();
    const bobCh = new MockDataChannel();
    aliceCh.peerChannel = bobCh;
    bobCh.peerChannel = aliceCh;

    aliceAdapter.attachDataChannel('bob', aliceCh);
    bobAdapter.attachDataChannel('alice', bobCh);

    let receivedOnBob: BitSwapMessage | null = null;
    bobAdapter.onMessage((from, msg) => {
      receivedOnBob = msg;
    });

    const wantMsg: BitSwapMessage = {
      wantlist: [{ cid: 'bafy_test_cid_123', priority: 1, cancel: false }],
    };

    await aliceAdapter.sendMessage('bob', wantMsg);

    expect(receivedOnBob).not.toBeNull();
    expect((receivedOnBob as any).wantlist?.[0]?.cid).toBe('bafy_test_cid_123');
  });
});
