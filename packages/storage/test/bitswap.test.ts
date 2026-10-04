import { describe, it, expect } from 'vitest';
import { constantTimeEquals } from '@sovra/crypto';
import {
  CID,
  MemoryBlockstore,
  BitSwapEngine,
  BitSwapNetworkAdapter,
  BitSwapMessage,
  encodeBitSwapMessage,
  decodeBitSwapMessage,
  UnixFSBuilder,
  UnixFSReader,
  IntegrityVerificationError,
  BitSwapTimeoutError,
} from '../src/index.js';

describe('BitSwap Data Exchange Protocol Suite', () => {
  it('encodes and decodes BitSwap 1.2.0 wire messages with binary payload fidelity', () => {
    const originalBlockData = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const cid = CID.create('raw', originalBlockData);

    const message: BitSwapMessage = {
      wantlist: [
        {
          cid: cid.toString(),
          priority: 5,
          cancel: false,
          wantType: 'WANT_BLOCK',
          sendDontHave: true,
        },
      ],
      blocks: [
        {
          cid: cid.toString(),
          data: originalBlockData,
        },
      ],
      blockPresences: [
        {
          cid: cid.toString(),
          type: 'HAVE',
        },
      ],
      fullWantlist: false,
    };

    const encoded = encodeBitSwapMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeBitSwapMessage(encoded);
    expect(decoded.wantlist).toHaveLength(1);
    expect(decoded.wantlist![0]!.cid).toBe(cid.toString());
    expect(decoded.wantlist![0]!.priority).toBe(5);

    expect(decoded.blocks).toHaveLength(1);
    expect(decoded.blocks![0]!.cid).toBe(cid.toString());
    expect(constantTimeEquals(decoded.blocks![0]!.data, originalBlockData)).toBe(true);

    expect(decoded.blockPresences).toHaveLength(1);
    expect(decoded.blockPresences![0]!.type).toBe('HAVE');
  });

  it('tracks peer tit-for-tat ledger accounting and debt ratios', () => {
    const store = new MemoryBlockstore();
    const engine = new BitSwapEngine(store);

    const peerId = 'peer-sovra-test-123';
    const ledger = engine.getLedger(peerId);

    expect(ledger.bytesSent).toBe(0);
    expect(ledger.bytesReceived).toBe(0);
    expect(ledger.debtRatio()).toBe(1); // (0+1024)/(0+1024)

    // Simulate sending 2048 bytes
    const dummyCid = CID.create('raw', new Uint8Array([1, 2, 3]));
    engine['ledger'].recordSent(peerId, 2048);
    expect(ledger.bytesSent).toBe(2048);
    expect(ledger.blocksSent).toBe(1);
    expect(ledger.debtRatio()).toBeCloseTo((2048 + 1024) / 1024, 2);

    // Simulate receiving 4096 bytes
    engine['ledger'].recordReceived(peerId, 4096);
    expect(ledger.bytesReceived).toBe(4096);
    expect(ledger.blocksReceived).toBe(1);
  });

  it('transfers blocks between two BitSwap engines with automatic cryptographic integrity validation', async () => {
    const storeA = new MemoryBlockstore();
    const storeB = new MemoryBlockstore();

    const engineA = new BitSwapEngine(storeA);
    const engineB = new BitSwapEngine(storeB);

    // Create virtual network connecting Engine A <--> Engine B
    const networkA: BitSwapNetworkAdapter = {
      sendMessage: async (targetPeerId, msg) => {
        if (targetPeerId === 'node-b') {
          await engineB.handleInboundMessage('node-a', msg);
        }
      },
      getConnectedPeers: () => ['node-b'],
    };

    const networkB: BitSwapNetworkAdapter = {
      sendMessage: async (targetPeerId, msg) => {
        if (targetPeerId === 'node-a') {
          await engineA.handleInboundMessage('node-b', msg);
        }
      },
      getConnectedPeers: () => ['node-a'],
    };

    engineA.setNetwork(networkA);
    engineB.setNetwork(networkB);

    // Node A stores a test block
    const blockContent = new TextEncoder().encode('Hello decentralized Sovra network over BitSwap!');
    const cid = CID.create('raw', blockContent);
    await storeA.put(cid, blockContent);

    // Assert Node B does not have it initially
    expect(await storeB.has(cid)).toBe(false);

    // Node B requests the block from Node A
    const retrieved = await engineB.requestBlock(cid, ['node-a'], { timeoutMs: 2000 });

    expect(constantTimeEquals(retrieved, blockContent)).toBe(true);
    // Node B blockstore should now have cached the verified block
    expect(await storeB.has(cid)).toBe(true);
    const storedInB = await storeB.get(cid);
    expect(storedInB).toBeDefined();
    expect(constantTimeEquals(storedInB!, blockContent)).toBe(true);

    // Check stats
    const statsA = engineA.getStats();
    expect(statsA.totalBlocksSent).toBe(1);
    expect(statsA.totalBytesSent).toBe(blockContent.length);

    const statsB = engineB.getStats();
    expect(statsB.totalBlocksReceived).toBe(1);
    expect(statsB.totalBytesReceived).toBe(blockContent.length);
  });

  it('rejects tampered blocks and does not store corrupted data into blockstore', async () => {
    const store = new MemoryBlockstore();
    const engine = new BitSwapEngine(store);

    const legitimateContent = new Uint8Array([10, 20, 30, 40]);
    const legitimateCid = CID.create('raw', legitimateContent);

    const corruptedContent = new Uint8Array([10, 20, 30, 99]); // Altered last byte

    const tamperedMessage: BitSwapMessage = {
      blocks: [
        {
          cid: legitimateCid.toString(),
          data: corruptedContent,
        },
      ],
    };

    await expect(
      engine.handleInboundMessage('malicious-peer', tamperedMessage),
    ).rejects.toThrow(IntegrityVerificationError);

    // Blockstore must not contain the corrupted block
    expect(await store.has(legitimateCid)).toBe(false);
  });

  it('times out and sends cancel when block cannot be retrieved within timeoutMs', async () => {
    const store = new MemoryBlockstore();
    const engine = new BitSwapEngine(store);

    let cancelSent = false;
    const network: BitSwapNetworkAdapter = {
      sendMessage: async (_peer, msg) => {
        if (msg.wantlist && msg.wantlist[0]?.cancel === true) {
          cancelSent = true;
        }
      },
      getConnectedPeers: () => ['unresponsive-node'],
    };
    engine.setNetwork(network);

    const nonExistentCid = CID.create('raw', new Uint8Array([11, 22, 33]));

    await expect(
      engine.requestBlock(nonExistentCid, ['unresponsive-node'], { timeoutMs: 80 }),
    ).rejects.toThrow(BitSwapTimeoutError);

    expect(cancelSent).toBe(true);
    expect(engine.getStats().activeWantsCount).toBe(0);
  });

  it('fetches and reconstructs a complete multi-chunk Merkle DAG over BitSwap', async () => {
    const storeA = new MemoryBlockstore();
    const storeB = new MemoryBlockstore();

    const engineA = new BitSwapEngine(storeA);
    const engineB = new BitSwapEngine(storeB);

    const networkA: BitSwapNetworkAdapter = {
      sendMessage: async (targetPeer, msg) => {
        if (targetPeer === 'peer-b') {
          await engineB.handleInboundMessage('peer-a', msg);
        }
      },
    };

    const networkB: BitSwapNetworkAdapter = {
      sendMessage: async (targetPeer, msg) => {
        if (targetPeer === 'peer-a') {
          await engineA.handleInboundMessage('peer-b', msg);
        }
      },
    };

    engineA.setNetwork(networkA);
    engineB.setNetwork(networkB);

    // Generate 600 KB file (>2 chunks at 256KB chunk size)
    const originalFile = new Uint8Array(600 * 1024);
    for (let i = 0; i < originalFile.length; i++) {
      originalFile[i] = ((i * 17) ^ (i >> 8) ^ (i >> 16)) & 0xff;
    }

    // Build Merkle DAG on Node A and store all blocks
    const dagResult = UnixFSBuilder.buildFileDag(originalFile, { chunkSize: 256 * 1024 });
    for (const [cidStr, data] of dagResult.blocks.entries()) {
      await storeA.put(CID.parse(cidStr), data);
    }

    expect(dagResult.blocks.size).toBe(4); // 3 leaf raw chunks + 1 root dag-pb node
    expect(await storeB.has(dagResult.rootCid)).toBe(false);

    // Node B fetches entire DAG via BitSwap from Node A
    const { root, allBlocks } = await engineB.fetchDag(dagResult.rootCid, ['peer-a']);

    expect(root).toBeDefined();
    expect(allBlocks.size).toBe(4);

    // Verify all blocks were stored in Node B blockstore
    for (const cidStr of dagResult.blocks.keys()) {
      expect(await storeB.has(CID.parse(cidStr))).toBe(true);
    }

    // Reconstruct file on Node B from blockstore
    const reconstructed = await UnixFSReader.reconstructFile(
      dagResult.rootCid,
      cid => storeB.get(cid),
    );
    expect(reconstructed.length).toBe(originalFile.length);
    expect(constantTimeEquals(reconstructed, originalFile)).toBe(true);
  });

  it('fetches multi-chunk Merkle DAGs concurrently across a multi-peer swarm with pipelining', async () => {
    const storeA = new MemoryBlockstore();
    const storeB = new MemoryBlockstore();
    const storeC = new MemoryBlockstore();
    const storeClient = new MemoryBlockstore();

    const engineA = new BitSwapEngine(storeA);
    const engineB = new BitSwapEngine(storeB);
    const engineC = new BitSwapEngine(storeC);
    const engineClient = new BitSwapEngine(storeClient);

    // Multi-peer network router
    const engines: Record<string, BitSwapEngine> = {
      'peer-a': engineA,
      'peer-b': engineB,
      'peer-c': engineC,
      'client': engineClient,
    };

    const makeAdapter = (myId: string): BitSwapNetworkAdapter => ({
      sendMessage: async (targetPeer, msg) => {
        const dest = engines[targetPeer];
        if (dest) {
          setTimeout(async () => {
            const resp = await dest.handleInboundMessage(myId, msg);
            if (resp) {
              const src = engines[myId];
              if (src) await src.handleInboundMessage(targetPeer, resp);
            }
          }, 5);
        }
      },
    });

    engineA.setNetwork(makeAdapter('peer-a'));
    engineB.setNetwork(makeAdapter('peer-b'));
    engineC.setNetwork(makeAdapter('peer-c'));
    engineClient.setNetwork(makeAdapter('client'));

    // Build a 750KB file with non-repeating pattern across chunks
    const testFile = new Uint8Array(750 * 1024);
    for (let i = 0; i < testFile.length; i++) {
      testFile[i] = ((i * 31) ^ (i >> 16) ^ (i >> 8)) & 0xff;
    }
    const dagResult = UnixFSBuilder.buildFileDag(testFile, { chunkSize: 256 * 1024 });

    // Distribute blocks across the swarm:
    // Root on all peers
    await storeA.put(dagResult.rootCid, dagResult.blocks.get(dagResult.rootCid.toString())!);
    await storeB.put(dagResult.rootCid, dagResult.blocks.get(dagResult.rootCid.toString())!);
    await storeC.put(dagResult.rootCid, dagResult.blocks.get(dagResult.rootCid.toString())!);

    // Distribute chunks across peers A, B, C
    const chunkKeys = Array.from(dagResult.blocks.keys()).filter(k => k !== dagResult.rootCid.toString());
    expect(chunkKeys.length).toBe(3);

    await storeA.put(CID.parse(chunkKeys[0]!), dagResult.blocks.get(chunkKeys[0]!)!);
    await storeB.put(CID.parse(chunkKeys[1]!), dagResult.blocks.get(chunkKeys[1]!)!);
    await storeC.put(CID.parse(chunkKeys[2]!), dagResult.blocks.get(chunkKeys[2]!)!);

    // Client fetches DAG via swarm pipelining across ['peer-a', 'peer-b', 'peer-c']
    const { root, allBlocks } = await engineClient.fetchDag(
      dagResult.rootCid,
      ['peer-a', 'peer-b', 'peer-c'],
      { concurrency: 4, timeoutMs: 3000 },
    );

    expect(root).toBeDefined();
    expect(allBlocks.size).toBe(4);

    // Verify all chunks retrieved into client store
    for (const key of dagResult.blocks.keys()) {
      expect(await storeClient.has(CID.parse(key))).toBe(true);
    }

    const reconstructed = await UnixFSReader.reconstructFile(
      dagResult.rootCid,
      cid => storeClient.get(cid),
    );
    expect(reconstructed.length).toBe(testFile.length);
    expect(constantTimeEquals(reconstructed, testFile)).toBe(true);
  });
});
