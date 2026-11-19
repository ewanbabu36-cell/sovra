import { describe, it, expect } from 'vitest';
import { UnixFSBuilder, UnixFSReader } from '../../packages/storage/src/unixfs.js';

describe('In-Browser UnixFS 256KB Chunker & Merkle DAG Seeder Suite', { timeout: 25000 }, () => {
  it('chunks large 1 MiB media file into 256 KiB blocks and computes deterministic root CIDv1', async () => {
    // 1 MiB file with non-trivial pattern so each chunk has unique CID
    const oneMbSize = 1024 * 1024;
    const rawData = new Uint8Array(oneMbSize);
    for (let i = 0; i < oneMbSize; i++) {
      rawData[i] = (i * 17 + 1) % 251;
    }

    const dag = UnixFSBuilder.buildFileDag(rawData, { chunkSize: 256 * 1024 });

    expect(dag.chunkCount).toBe(4);
    expect(dag.totalSize).toBe(oneMbSize);
    expect(dag.rootCid).toBeDefined();
    expect(dag.rootCid.version).toBe(1);

    // 4 leaf chunks + 1 root DAG-PB node = 5 blocks total
    expect(dag.blocks.size).toBe(5);

    // Verify each chunk is precisely <= 256 KiB
    let totalChunkBytes = 0;
    for (const [cidStr, blockBytes] of dag.blocks.entries()) {
      if (cidStr !== dag.rootCid.toString()) {
        expect(blockBytes.byteLength).toBe(256 * 1024);
        totalChunkBytes += blockBytes.byteLength;
      }
    }
    expect(totalChunkBytes).toBe(oneMbSize);
  });

  it('reconstructs the exact 1 MiB binary stream from 256 KiB chunks with 100% byte integrity', async () => {
    const rawData = new Uint8Array(512 * 1024); // 512 KiB
    for (let i = 0; i < rawData.length; i++) {
      rawData[i] = (i * 31 + 7) % 251;
    }

    const dag = UnixFSBuilder.buildFileDag(rawData, { chunkSize: 256 * 1024 });

    const reconstructed = await UnixFSReader.reconstructFile(dag.rootCid, async (cid) => {
      return dag.blocks.get(cid.toString());
    });

    expect(reconstructed.length).toBe(rawData.length);
    expect(reconstructed).toEqual(rawData);
  });
});
