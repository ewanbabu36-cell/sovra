import { describe, it, expect } from 'vitest';
import { constantTimeEquals } from '@sovra/crypto';
import {
  UnixFSBuilder,
  UnixFSReader,
  CID,
  IntegrityVerificationError,
  ContentNotFoundError,
  DEFAULT_CHUNK_SIZE,
} from '../src/index.js';

describe('UnixFS Chunker & Merkle DAG Builder Suite (@sovra/storage)', () => {
  it('builds and reconstructs a single-chunk file (<256 KB)', async () => {
    const content = new TextEncoder().encode('Hello Sovra Decentralized Media Storage');
    const dag = UnixFSBuilder.buildFileDag(content);

    expect(dag.totalSize).toBe(content.length);
    expect(dag.chunkCount).toBe(1);
    expect(dag.rootCid.codec).toBe('dag-pb');
    expect(dag.blocks.size).toBe(2); // 1 leaf raw block + 1 root dag-pb block

    // Reconstruct file
    const reconstructed = await UnixFSReader.reconstructFile(dag.rootCid, async c => {
      return dag.blocks.get(c.toString());
    });

    expect(reconstructed).toEqual(content);
  });

  it('chunks a multi-megabyte video payload (1 MB) into exact 256KB chunks and reconstructs', async () => {
    // 1 MB test payload (4 exact 256 KB chunks)
    const size = 1024 * 1024;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = i % 251; // Non-trivial byte pattern
    }

    const dag = UnixFSBuilder.buildFileDag(data, { chunkSize: DEFAULT_CHUNK_SIZE });

    expect(dag.totalSize).toBe(size);
    expect(dag.chunkCount).toBe(4);
    expect(dag.blocks.size).toBe(5); // 4 leaf raw blocks + 1 root dag-pb block

    // Verify each leaf chunk is 256 KB
    let leafCount = 0;
    for (const [cidStr, block] of dag.blocks.entries()) {
      const parsed = CID.parse(cidStr);
      if (parsed.codec === 'raw') {
        expect(block.length).toBe(DEFAULT_CHUNK_SIZE);
        leafCount++;
      }
    }
    expect(leafCount).toBe(4);

    // Reconstruct file bit-by-bit
    const reconstructed = await UnixFSReader.reconstructFile(dag.rootCid, async c => {
      return dag.blocks.get(c.toString());
    });

    expect(reconstructed.length).toBe(size);
    expect(constantTimeEquals(reconstructed, data)).toBe(true);
  });

  it('builds a hierarchical balanced Merkle tree when chunks exceed fanout', async () => {
    // 10 chunks with small fanout of 3 -> requires 2 tree levels
    const chunkSize = 1000;
    const totalSize = 10000;
    const data = new Uint8Array(totalSize);
    for (let i = 0; i < totalSize; i++) data[i] = (i * 7) % 256;

    const dag = UnixFSBuilder.buildFileDag(data, {
      chunkSize,
      fanout: 3,
    });

    expect(dag.chunkCount).toBe(10);
    // Tree has 10 leaves + 4 intermediate nodes (ceil(10/3)=4) + 2 higher nodes (ceil(4/3)=2) + 1 root (ceil(2/3)=1)
    expect(dag.blocks.size).toBeGreaterThan(10);

    const reconstructed = await UnixFSReader.reconstructFile(dag.rootCid, async c => {
      return dag.blocks.get(c.toString());
    });

    expect(reconstructed.length).toBe(totalSize);
    expect(constantTimeEquals(reconstructed, data)).toBe(true);
  });

  it('streams file chunks sequentially for video playback', async () => {
    const size = 600 * 1024; // ~600 KB -> 3 chunks (256KB, 256KB, 88KB)
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = i % 255;

    const dag = UnixFSBuilder.buildFileDag(data);
    expect(dag.chunkCount).toBe(3);

    const streamChunks: Uint8Array[] = [];
    for await (const chunk of UnixFSReader.streamFile(dag.rootCid, async c => dag.blocks.get(c.toString()))) {
      streamChunks.push(chunk);
    }

    expect(streamChunks.length).toBe(3);
    expect(streamChunks[0]!.length).toBe(DEFAULT_CHUNK_SIZE);
    expect(streamChunks[1]!.length).toBe(DEFAULT_CHUNK_SIZE);
    expect(streamChunks[2]!.length).toBe(size - 2 * DEFAULT_CHUNK_SIZE);

    const concatenated = new Uint8Array(size);
    let offset = 0;
    for (const sc of streamChunks) {
      concatenated.set(sc, offset);
      offset += sc.length;
    }
    expect(concatenated.length).toBe(size);
    expect(constantTimeEquals(concatenated, data)).toBe(true);
  });

  it('detects corrupted/tampered blocks and throws IntegrityVerificationError', async () => {
    const data = new Uint8Array(500 * 1024); // 2 chunks
    const dag = UnixFSBuilder.buildFileDag(data);

    // Pick one leaf raw block and tamper with its byte content
    let tamperedCid: CID | undefined;
    for (const cidStr of dag.blocks.keys()) {
      const parsed = CID.parse(cidStr);
      if (parsed.codec === 'raw') {
        tamperedCid = parsed;
        const corruptData = new Uint8Array(dag.blocks.get(cidStr)!);
        corruptData[0] = (corruptData[0]! ^ 0xff); // Flip bits
        dag.blocks.set(cidStr, corruptData);
        break;
      }
    }
    expect(tamperedCid).toBeDefined();

    // Reconstructing with corrupted block must fail
    await expect(
      UnixFSReader.reconstructFile(dag.rootCid, async c => dag.blocks.get(c.toString())),
    ).rejects.toThrow(IntegrityVerificationError);
  });

  it('throws ContentNotFoundError if a required DAG link is missing', async () => {
    const data = new Uint8Array(300 * 1024);
    const dag = UnixFSBuilder.buildFileDag(data);

    // Remove one leaf block from the store
    for (const cidStr of dag.blocks.keys()) {
      const parsed = CID.parse(cidStr);
      if (parsed.codec === 'raw') {
        dag.blocks.delete(cidStr);
        break;
      }
    }

    await expect(
      UnixFSReader.reconstructFile(dag.rootCid, async c => dag.blocks.get(c.toString())),
    ).rejects.toThrow(ContentNotFoundError);
  });
});
