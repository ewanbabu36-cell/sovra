import {
  sha256,
  blake3Hash,
  constantTimeEquals,
} from '@sovra/crypto';
import { CID, MultihashType, encodeVarint, decodeVarint } from './cid.js';
import {
  IntegrityVerificationError,
  DagTraversalError,
  ContentNotFoundError,
} from './errors.js';

export const DEFAULT_CHUNK_SIZE = 256 * 1024; // 256 KB
export const DEFAULT_FANOUT = 174; // Standard IPFS balanced tree fanout

export interface DAGLink {
  readonly name: string;
  readonly cid: CID;
  readonly size: number;
}

export interface UnixFSMetadata {
  readonly type: 'file' | 'raw';
  readonly fileSize: number;
  readonly blockSizes: readonly number[];
}

// ============================================================================
// PROTOBUF SERIALIZATION FOR UNIXFS & DAG-PB
// ============================================================================

/**
 * Encodes UnixFS Data header into protobuf binary format:
 * message Data {
 *   enum DataType { Raw = 0; Directory = 1; File = 2; Metadata = 3; Symlink = 4; }
 *   required DataType Type = 1;
 *   optional bytes Data = 2;
 *   optional uint64 filesize = 3;
 *   repeated uint64 blocksizes = 4;
 * }
 */
export function encodeUnixFSData(fileSize: number, blockSizes: readonly number[]): Uint8Array {
  const parts: Uint8Array[] = [];

  // Field 1: Type = File (enum 2) -> (1 << 3) | 0 = 0x08
  parts.push(new Uint8Array([0x08, 0x02]));

  // Field 3: filesize -> (3 << 3) | 0 = 0x18
  parts.push(new Uint8Array([0x18]));
  parts.push(encodeVarint(fileSize));

  // Field 4: blocksizes (repeated) -> (4 << 3) | 0 = 0x20
  for (const size of blockSizes) {
    parts.push(new Uint8Array([0x20]));
    parts.push(encodeVarint(size));
  }

  // Concatenate all parts
  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function decodeUnixFSData(bytes: Uint8Array): UnixFSMetadata {
  let offset = 0;
  let fileSize = 0;
  const blockSizes: number[] = [];

  while (offset < bytes.length) {
    const tag = decodeVarint(bytes, offset);
    offset += tag.bytesRead;

    const fieldNum = tag.value >>> 3;
    const wireType = tag.value & 0x07;

    if (fieldNum === 1 && wireType === 0) {
      // Type
      const typeVal = decodeVarint(bytes, offset);
      offset += typeVal.bytesRead;
    } else if (fieldNum === 3 && wireType === 0) {
      // filesize
      const fs = decodeVarint(bytes, offset);
      offset += fs.bytesRead;
      fileSize = fs.value;
    } else if (fieldNum === 4 && wireType === 0) {
      // blocksizes
      const bs = decodeVarint(bytes, offset);
      offset += bs.bytesRead;
      blockSizes.push(bs.value);
    } else if (wireType === 2) {
      // Length-delimited skip
      const len = decodeVarint(bytes, offset);
      offset += len.bytesRead + len.value;
    } else if (wireType === 0) {
      const v = decodeVarint(bytes, offset);
      offset += v.bytesRead;
    } else {
      break;
    }
  }

  return {
    type: 'file',
    fileSize,
    blockSizes,
  };
}

/**
 * Encodes a DAG-PB node into standard protobuf format:
 * message PBNode {
 *   repeated PBLink Links = 2; // (2 << 3) | 2 = 0x12
 *   optional bytes Data = 1;   // (1 << 3) | 2 = 0x0a
 * }
 */
export function encodeDAGPBNode(data: Uint8Array, links: readonly DAGLink[]): Uint8Array {
  const parts: Uint8Array[] = [];

  // Field 1: Data -> (1 << 3) | 2 = 0x0a
  if (data.length > 0) {
    parts.push(new Uint8Array([0x0a]));
    parts.push(encodeVarint(data.length));
    parts.push(data);
  }

  // Field 2: Links (repeated PBLink) -> (2 << 3) | 2 = 0x12
  for (const link of links) {
    const linkParts: Uint8Array[] = [];

    // Link.Hash: field 1 -> (1 << 3) | 2 = 0x0a
    const hashBytes = link.cid.bytes;
    linkParts.push(new Uint8Array([0x0a]));
    linkParts.push(encodeVarint(hashBytes.length));
    linkParts.push(hashBytes);

    // Link.Name: field 2 -> (2 << 3) | 2 = 0x12
    if (link.name) {
      const nameBytes = new TextEncoder().encode(link.name);
      linkParts.push(new Uint8Array([0x12]));
      linkParts.push(encodeVarint(nameBytes.length));
      linkParts.push(nameBytes);
    }

    // Link.Tsize: field 3 -> (3 << 3) | 0 = 0x18
    linkParts.push(new Uint8Array([0x18]));
    linkParts.push(encodeVarint(link.size));

    const linkTotalLen = linkParts.reduce((acc, p) => acc + p.length, 0);
    const linkBuf = new Uint8Array(linkTotalLen);
    let lOffset = 0;
    for (const lp of linkParts) {
      linkBuf.set(lp, lOffset);
      lOffset += lp.length;
    }

    parts.push(new Uint8Array([0x12]));
    parts.push(encodeVarint(linkBuf.length));
    parts.push(linkBuf);
  }

  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function decodeDAGPBNode(bytes: Uint8Array): { data: Uint8Array; links: DAGLink[] } {
  let offset = 0;
  let data = new Uint8Array(0);
  const links: DAGLink[] = [];

  while (offset < bytes.length) {
    const tag = decodeVarint(bytes, offset);
    offset += tag.bytesRead;

    const fieldNum = tag.value >>> 3;
    const wireType = tag.value & 0x07;

    if (fieldNum === 1 && wireType === 2) {
      // Data
      const len = decodeVarint(bytes, offset);
      offset += len.bytesRead;
      data = new Uint8Array(bytes.subarray(offset, offset + len.value));
      offset += len.value;
    } else if (fieldNum === 2 && wireType === 2) {
      // Link
      const len = decodeVarint(bytes, offset);
      offset += len.bytesRead;
      const linkEnd = offset + len.value;

      let linkCid: CID | undefined;
      let linkName = '';
      let linkSize = 0;

      while (offset < linkEnd) {
        const lTag = decodeVarint(bytes, offset);
        offset += lTag.bytesRead;
        const lField = lTag.value >>> 3;
        const lWire = lTag.value & 0x07;

        if (lField === 1 && lWire === 2) {
          // Link.Hash
          const hLen = decodeVarint(bytes, offset);
          offset += hLen.bytesRead;
          const cidBytes = bytes.subarray(offset, offset + hLen.value);
          linkCid = CID.fromBytes(cidBytes);
          offset += hLen.value;
        } else if (lField === 2 && lWire === 2) {
          // Link.Name
          const nLen = decodeVarint(bytes, offset);
          offset += nLen.bytesRead;
          linkName = new TextDecoder().decode(bytes.subarray(offset, offset + nLen.value));
          offset += nLen.value;
        } else if (lField === 3 && lWire === 0) {
          // Link.Tsize
          const sVal = decodeVarint(bytes, offset);
          offset += sVal.bytesRead;
          linkSize = sVal.value;
        } else if (lWire === 2) {
          const skipLen = decodeVarint(bytes, offset);
          offset += skipLen.bytesRead + skipLen.value;
        } else if (lWire === 0) {
          const skipVal = decodeVarint(bytes, offset);
          offset += skipVal.bytesRead;
        }
      }

      if (linkCid) {
        links.push({ name: linkName, cid: linkCid, size: linkSize });
      }
    } else if (wireType === 2) {
      const skipLen = decodeVarint(bytes, offset);
      offset += skipLen.bytesRead + skipLen.value;
    } else if (wireType === 0) {
      const skipVal = decodeVarint(bytes, offset);
      offset += skipVal.bytesRead;
    }
  }

  return { data, links };
}

// ============================================================================
// MERKLE DAG NODE & BUILDER
// ============================================================================

export interface FileDagResult {
  readonly rootCid: CID;
  readonly blocks: Map<string, Uint8Array>; // CID string -> block bytes
  readonly totalSize: number;
  readonly chunkCount: number;
}

export class UnixFSBuilder {
  /**
   * Splits binary data into 256KB chunks and constructs a balanced Merkle DAG
   */
  public static buildFileDag(
    data: Uint8Array,
    options?: {
      chunkSize?: number;
      hashType?: MultihashType;
      fanout?: number;
      rawLeaves?: boolean;
    },
  ): FileDagResult {
    const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const hashType = options?.hashType ?? 'sha2-256';
    const fanout = options?.fanout ?? DEFAULT_FANOUT;
    const rawLeaves = options?.rawLeaves ?? true;

    const blocks = new Map<string, Uint8Array>();

    // Single chunk optimization for files <= chunkSize
    if (data.length <= chunkSize && rawLeaves) {
      const leafCid = CID.create('raw', data, false, hashType);
      blocks.set(leafCid.toString(), data);

      // Wrap in standard DAG-PB root node with 1 link
      const unixFsData = encodeUnixFSData(data.length, [data.length]);
      const link: DAGLink = { name: '0', cid: leafCid, size: data.length };
      const rootBytes = encodeDAGPBNode(unixFsData, [link]);
      const rootCid = CID.create('dag-pb', rootBytes, false, hashType);
      blocks.set(rootCid.toString(), rootBytes);

      return {
        rootCid,
        blocks,
        totalSize: data.length,
        chunkCount: 1,
      };
    }

    // Split file into chunks
    const chunkBlocks: Array<{ cid: CID; size: number }> = [];
    let offset = 0;
    let chunkIndex = 0;

    while (offset < data.length) {
      const end = Math.min(offset + chunkSize, data.length);
      const chunk = data.subarray(offset, end);
      const cid = CID.create('raw', chunk, false, hashType);

      blocks.set(cid.toString(), chunk);
      chunkBlocks.push({ cid, size: chunk.length });

      offset = end;
      chunkIndex++;
    }

    // Convert chunk blocks to initial DAG links
    let currentLinks: DAGLink[] = chunkBlocks.map((c, i) => ({
      name: String(i),
      cid: c.cid,
      size: c.size,
    }));

    // Build hierarchical balanced Merkle tree if fanout is exceeded
    while (currentLinks.length > fanout) {
      const nextLevelLinks: DAGLink[] = [];

      for (let i = 0; i < currentLinks.length; i += fanout) {
        const batch = currentLinks.slice(i, i + fanout);
        const subTotalSize = batch.reduce((acc, l) => acc + l.size, 0);
        const subBlockSizes = batch.map(l => l.size);

        const subData = encodeUnixFSData(subTotalSize, subBlockSizes);
        const subNodeBytes = encodeDAGPBNode(subData, batch);
        const subNodeCid = CID.create('dag-pb', subNodeBytes, false, hashType);

        blocks.set(subNodeCid.toString(), subNodeBytes);
        nextLevelLinks.push({
          name: String(Math.floor(i / fanout)),
          cid: subNodeCid,
          size: subTotalSize,
        });
      }

      currentLinks = nextLevelLinks;
    }

    // Final Root DAG-PB Node
    const totalSize = data.length;
    const blockSizes = chunkBlocks.map(c => c.size);
    const rootData = encodeUnixFSData(totalSize, blockSizes);
    const rootNodeBytes = encodeDAGPBNode(rootData, currentLinks);
    const rootCid = CID.create('dag-pb', rootNodeBytes, false, hashType);

    blocks.set(rootCid.toString(), rootNodeBytes);

    return {
      rootCid,
      blocks,
      totalSize,
      chunkCount: chunkBlocks.length,
    };
  }
}

// ============================================================================
// MERKLE DAG TRAVERSAL & RECONSTRUCTION
// ============================================================================

export class UnixFSReader {
  /**
   * Traverses Merkle DAG links starting from root CID and reassembles file bytes.
   * Cryptographically verifies integrity of every visited block against its CID.
   */
  public static async reconstructFile(
    rootCid: CID,
    getBlock: (cid: CID) => Promise<Uint8Array | undefined>,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];

    for await (const chunk of this.streamFile(rootCid, getBlock)) {
      chunks.push(chunk);
    }

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const assembled = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      assembled.set(chunk, offset);
      offset += chunk.length;
    }
    return assembled;
  }

  /**
   * Streams file chunks in sequential order from Merkle DAG.
   */
  public static async *streamFile(
    cid: CID,
    getBlock: (c: CID) => Promise<Uint8Array | undefined>,
  ): AsyncIterable<Uint8Array> {
    const rawBlock = await getBlock(cid);
    if (!rawBlock) {
      throw new ContentNotFoundError(cid.toString());
    }

    // Cryptographic integrity verification of fetched block
    const computedDigest =
      cid.multihashType === 'blake3' ? blake3Hash(rawBlock) : sha256(rawBlock);

    if (!constantTimeEquals(computedDigest, cid.digest)) {
      throw new IntegrityVerificationError(
        cid.toString(),
        cid.multihash,
        Buffer.from(computedDigest).toString('hex'),
      );
    }

    // If raw chunk leaf: yield data directly
    if (cid.codec === 'raw') {
      yield rawBlock;
      return;
    }

    // If DAG-PB node: parse links and recurse in order
    if (cid.codec === 'dag-pb') {
      const node = decodeDAGPBNode(rawBlock);
      if (node.links.length === 0) {
        // Leaf with inline data
        yield node.data;
        return;
      }

      for (const link of node.links) {
        yield* this.streamFile(link.cid, getBlock);
      }
      return;
    }

    throw new DagTraversalError(`Unsupported codec '${cid.codec}' encountered in DAG traversal`);
  }
}
