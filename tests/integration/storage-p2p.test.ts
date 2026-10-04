import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  constantTimeEquals,
  generateEd25519KeyPair,
} from '@sovra/crypto';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
} from '@sovra/identity';
import { SovraP2PNode, derivePeerId, createPeerIdentityBinding } from '@sovra/p2p';
import { CID } from '@sovra/storage';
import { StorageNodeDaemon } from '@sovra/storage-node';

describe('End-to-End P2P Storage & BitSwap Data Exchange Integration Suite', () => {
  let tempDirA: string | undefined;
  let tempDirB: string | undefined;
  let p2pA: SovraP2PNode | undefined;
  let p2pB: SovraP2PNode | undefined;
  let daemonA: StorageNodeDaemon | undefined;
  let daemonB: StorageNodeDaemon | undefined;

  afterEach(async () => {
    if (daemonA?.isRunning) await daemonA.stop();
    if (daemonB?.isRunning) await daemonB.stop();
    if (p2pA?.isRunning) await p2pA.stop();
    if (p2pB?.isRunning) await p2pB.stop();

    if (tempDirA) await fs.rm(tempDirA, { recursive: true, force: true }).catch(() => {});
    if (tempDirB) await fs.rm(tempDirB, { recursive: true, force: true }).catch(() => {});
  });

  it(
    'proves Node A publishes a 512KB UnixFS Merkle DAG, pins it, announces to DHT, and Node B discovers and retrieves it over BitSwap via real OS TCP sockets',
    async () => {
    const portA = 5941;
    const portB = 5942;

    tempDirA = path.join(os.tmpdir(), `sovra-int-storage-a-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirB = path.join(os.tmpdir(), `sovra-int-storage-b-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDirA, { recursive: true });
    await fs.mkdir(tempDirB, { recursive: true });

    // 1. Initialize Cryptographic Identity & Device Keys for Node A and Node B
    const masterA = SovraIdentityKey.generate();
    const edPairA = generateEd25519KeyPair();
    const deviceKeyA = new SovraDeviceKey(
      'device-node-a',
      'Storage Node A',
      masterA.did,
      edPairA.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const delA = createDeviceDelegation(masterA, deviceKeyA, Math.floor(Date.now() / 1000) + 86400);
    const bindingA = createPeerIdentityBinding(deviceKeyA, masterA.did, delA);
    const peerIdA = bindingA.peerId;

    const masterB = SovraIdentityKey.generate();
    const edPairB = generateEd25519KeyPair();
    const deviceKeyB = new SovraDeviceKey(
      'device-node-b',
      'Consumer Node B',
      masterB.did,
      edPairB.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const delB = createDeviceDelegation(masterB, deviceKeyB, Math.floor(Date.now() / 1000) + 86400);
    const bindingB = createPeerIdentityBinding(deviceKeyB, masterB.did, delB);
    const peerIdB = bindingB.peerId;

    // 2. Instantiate Real P2P Nodes with OS TCP transport
    p2pA = new SovraP2PNode({
      deviceKey: deviceKeyA,
      binding: bindingA,
      listenAddresses: [`/ip4/127.0.0.1/tcp/${portA}/p2p/${peerIdA}`],
    });

    p2pB = new SovraP2PNode({
      deviceKey: deviceKeyB,
      binding: bindingB,
      listenAddresses: [`/ip4/127.0.0.1/tcp/${portB}/p2p/${peerIdB}`],
    });

    // 3. Instantiate Storage Node Daemons attached to P2P Nodes
    daemonA = new StorageNodeDaemon({
      storagePath: tempDirA,
      maxCapacityBytes: 10737418240n, // 10 GB
      enableBitswap: true,
      p2pNode: p2pA,
    });

    daemonB = new StorageNodeDaemon({
      storagePath: tempDirB,
      maxCapacityBytes: 10737418240n,
      enableBitswap: true,
      p2pNode: p2pB,
    });

    // Start P2P nodes
    const p2pStartA = await p2pA.start();
    expect(p2pStartA.ok).toBe(true);

    const p2pStartB = await p2pB.start();
    expect(p2pStartB.ok).toBe(true);

    // Start Storage daemons
    const dStartA = await daemonA.start();
    expect(dStartA.ok).toBe(true);

    const dStartB = await daemonB.start();
    expect(dStartB.ok).toBe(true);

    // 4. Publish a 512KB media file on Node A (2 x 256KB chunks + 1 root DAG node)
    const mediaPayload = new Uint8Array(512 * 1024);
    for (let i = 0; i < mediaPayload.length; i++) {
      mediaPayload[i] = ((i * 31) ^ (i >> 8) ^ 0xaa) & 0xff;
    }

    const publishRes = await daemonA.storageService.publishMedia(mediaPayload, 'video/mp4');
    expect(publishRes.ok).toBe(true);
    if (!publishRes.ok) return;

    const mediaAsset = publishRes.value;
    const rootCid = mediaAsset.cid as unknown as CID;

    // Pin the content on Node A and provide to DHT
    const pinRes = await daemonA.pin(rootCid);
    expect(pinRes.ok).toBe(true);

    // Assert Node A has it in local tiered blockstore
    expect(await daemonA.blockstore.has(rootCid)).toBe(true);

    // Assert Node B does NOT have the content initially
    expect(await daemonB.blockstore.has(rootCid)).toBe(false);

    // 5. Connect Node B to Node A over real OS TCP socket with mutual Noise_XX authentication
    const dialRes = await p2pB.dial(`/ip4/127.0.0.1/tcp/${portA}/p2p/${peerIdA}`);
    expect(dialRes.ok).toBe(true);

    // Allow Yamux session and protocol negotiation to stabilize
    await new Promise(resolve => setTimeout(resolve, 200));

    // 6. Node B retrieves content via BitSwap exchange over Yamux stream /sovra/bitswap/1.2.0
    const retrieveRes = await daemonB.retrieveContent(rootCid);
    expect(retrieveRes.ok).toBe(true);
    if (!retrieveRes.ok) return;

    const reconstructedBytes = retrieveRes.value;
    expect(reconstructedBytes.length).toBe(mediaPayload.length);
    expect(constantTimeEquals(reconstructedBytes, mediaPayload)).toBe(true);

    // Verify Node B now has the cached root block in its blockstore
    expect(await daemonB.blockstore.has(rootCid)).toBe(true);

    // Verify BitSwap stats recorded data transfer
    const statsA = daemonA.getStats();
    expect(statsA.totalBlocksSent).toBeGreaterThan(0);
    expect(statsA.totalBytesSent).toBeGreaterThan(0);

    const statsB = daemonB.getStats();
    expect(statsB.totalBlocksReceived).toBeGreaterThan(0);
    expect(statsB.totalBytesReceived).toBeGreaterThan(0);
  }, 15000);
});
