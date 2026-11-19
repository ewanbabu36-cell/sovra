import { describe, it, expect } from 'vitest';
import {
  WebRtcDataChannelBitSwapAdapter,
  MinimalDataChannel,
  BitSwapWireMsgType,
  SOVRA_WIRE_MAGIC,
} from '../../packages/storage/src/webrtc-bitswap.js';
import { BitSwapMessage } from '../../packages/storage/src/bitswap.js';

class MockChannel implements MinimalDataChannel {
  public readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'open';
  public onmessage: ((ev: { data: any }) => void) | null = null;
  public onclose: ((ev: any) => void) | null = null;
  public peerChannel: MockChannel | null = null;

  public send(data: string | ArrayBuffer | Uint8Array): void {
    if (this.peerChannel && this.peerChannel.onmessage) {
      const copy = data instanceof Uint8Array ? new Uint8Array(data) : data;
      this.peerChannel.onmessage({ data: copy });
    }
  }

  public close(): void {
    this.readyState = 'closed';
  }
}

describe('BitTorrent-Class Tit-for-Tat Choking & Swarm Economics Suite', () => {
  it('enforces choke restrictions and blocks piece delivery to un-reciprocating peers', async () => {
    const adapter = new WebRtcDataChannelBitSwapAdapter();
    const ch = new MockChannel();
    adapter.attachDataChannel('freeloader_peer', ch);

    // Initial state: choked by default
    const state = adapter.getPeerState('freeloader_peer');
    expect(state).toBeDefined();
    expect(state?.isChoked).toBe(true);

    const blockMsg: BitSwapMessage = {
      blocks: [
        {
          cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          data: new Uint8Array(256 * 1024).fill(0xee),
        },
      ],
    };

    // Attempting to send blocks to a choked peer MUST throw an error
    await expect(adapter.sendMessage('freeloader_peer', blockMsg)).rejects.toThrow(
      /CHOKED/
    );

    // Explicit unchoke
    adapter.unchoke('freeloader_peer');
    expect(adapter.getPeerState('freeloader_peer')?.isChoked).toBe(false);

    // Now message succeeds
    await expect(adapter.sendMessage('freeloader_peer', blockMsg)).resolves.not.toThrow();
    expect(adapter.getPeerState('freeloader_peer')?.bytesUploaded).toBeGreaterThan(0);
  });

  it('runs Tit-for-Tat ranking: unchokes top uploaders, choked free-riders, and selects optimistic peer', () => {
    const adapter = new WebRtcDataChannelBitSwapAdapter();

    const peerIds = ['peer_A', 'peer_B', 'peer_C', 'peer_D', 'peer_E', 'peer_F'];
    for (const id of peerIds) {
      adapter.attachDataChannel(id, new MockChannel());
      const st = adapter.getPeerState(id)!;
      st.isInterested = true;
    }

    // Set download speeds (bytes received from each peer)
    adapter.getPeerState('peer_A')!.downloadRate = 1_000_000;
    adapter.getPeerState('peer_B')!.downloadRate = 800_000;
    adapter.getPeerState('peer_C')!.downloadRate = 600_000;
    adapter.getPeerState('peer_D')!.downloadRate = 400_000;
    adapter.getPeerState('peer_E')!.downloadRate = 100_000;
    adapter.getPeerState('peer_F')!.downloadRate = 0; // Free-rider

    // Run Tit-for-Tat with 4 regular unchoked slots
    const result = adapter.recalculateTitForTat(4);

    expect(result.unchoked).toEqual(['peer_A', 'peer_B', 'peer_C', 'peer_D']);
    expect(adapter.getPeerState('peer_A')!.isChoked).toBe(false);
    expect(adapter.getPeerState('peer_D')!.isChoked).toBe(false);

    // One of E or F must be chosen as the optimistic unchoke
    expect(result.optimistic).toBeDefined();
    expect(['peer_E', 'peer_F']).toContain(result.optimistic);
    expect(adapter.getPeerState(result.optimistic!)!.isChoked).toBe(false);

    // The other must be choked
    expect(result.choked.length).toBe(1);
    expect(adapter.getPeerState(result.choked[0]!)!.isChoked).toBe(true);
  });
});
