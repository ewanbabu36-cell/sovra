import { afterEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import { generateEd25519KeyPair } from '@sovra/crypto';
import { SovraIdentityKey, SovraDeviceKey, createDeviceDelegation } from '@sovra/identity';
import {
  SovraP2PNode,
  createPeerIdentityBinding,
  TransportChameleonEngine,
  calculateUdpPathHealth,
  filterDialableMultiaddrs,
} from '../src/index.js';

function createNodeIdentity(label: string) {
  const idKp = generateEd25519KeyPair();
  const devKp = generateEd25519KeyPair();
  const ik = new SovraIdentityKey(idKp.privateKey);
  const validUntil = Math.floor(Date.now() / 1000) + 86400;
  const dk = new SovraDeviceKey(`${label}-dev`, `${label} Node`, ik.did, devKp.privateKey, validUntil);
  const del = createDeviceDelegation(ik, dk, validUntil);
  const binding = createPeerIdentityBinding(dk, ik.did, del);
  return { ik, dk, binding };
}

describe('Stage 2 — P2P Transport Interoperability, Dual-Stack IPv4/IPv6, WebSocket Noise_XX & Fail-Closed QUIC', () => {
  const nodes: SovraP2PNode[] = [];
  const rawServers: net.Server[] = [];
  const rawSockets: net.Socket[] = [];

  afterEach(async () => {
    while (nodes.length > 0) await nodes.pop()!.stop().catch(() => {});
    while (rawSockets.length > 0) {
      rawSockets.pop()!.destroy();
    }
    while (rawServers.length > 0) {
      const s = rawServers.pop()!;
      if (typeof (s as any).closeAllConnections === 'function') (s as any).closeAllConnections();
      await new Promise<void>(res => s.close(() => res()));
    }
  });

  it('simultaneously binds IPv4 TCP, IPv6 loopback TCP, and RFC 6455 WebSocket listeners and authenticates over Noise_XX', async () => {
    const serverId = createNodeIdentity('dual-srv');
    const clientId = createNodeIdentity('dual-cli');

    const srv = new SovraP2PNode({
      deviceKey: serverId.dk,
      binding: serverId.binding,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0', '/ip6/::1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws'],
      strictTransport: true,
    });
    const cli = new SovraP2PNode({
      deviceKey: clientId.dk,
      binding: clientId.binding,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      strictTransport: true,
    });
    nodes.push(srv, cli);

    expect((await srv.start()).ok).toBe(true);
    expect((await cli.start()).ok).toBe(true);

    // Honest supported transport inventory (no unimplemented QUIC claimed)
    expect(srv.getSupportedTransports()).toContain('tcp+noise_xx+yamux');
    expect(srv.getSupportedTransports()).toContain('ws+noise_xx+yamux');
    expect(srv.getSupportedTransports()).not.toContain('quic');

    const bound = srv.getBoundAddresses();
    const ip4Tcp = bound.find(a => a.startsWith('/ip4/') && !a.includes('/ws'));
    const ip6Tcp = bound.find(a => a.startsWith('/ip6/') && !a.includes('/ws'));
    const wsAddr = bound.find(a => a.includes('/ws'));
    expect(ip4Tcp).toBeDefined();
    expect(ip6Tcp).toBeDefined();
    expect(wsAddr).toBeDefined();

    srv.reqResp.registerHandler('/sovra/interop/1.0.0', async (_peer, payload) => {
      return new TextEncoder().encode(`PONG:${new TextDecoder().decode(payload)}`);
    });

    // 1. Dial over WebSocket (/ws) + Noise_XX + Yamux
    const wsDial = await cli.dial(`${wsAddr}/p2p/${srv.identity.peerId}`);
    expect(wsDial.ok).toBe(true);
    const wsRes = await cli.reqResp.sendRequest(
      srv.identity.peerId,
      '/sovra/interop/1.0.0',
      new TextEncoder().encode('via-ws'),
    );
    expect(wsRes.ok).toBe(true);
    if (wsRes.ok) {
      expect(new TextDecoder().decode(wsRes.value)).toBe('PONG:via-ws');
    }

    // 2. Disconnect and dial over IPv6 loopback (/ip6/::1/tcp/...)
    await cli.disconnect(srv.identity.peerId);
    const v6Dial = await cli.dial(`${ip6Tcp}/p2p/${srv.identity.peerId}`);
    expect(v6Dial.ok).toBe(true);
    const v6Res = await cli.reqResp.sendRequest(
      srv.identity.peerId,
      '/sovra/interop/1.0.0',
      new TextEncoder().encode('via-ipv6'),
    );
    expect(v6Res.ok).toBe(true);
    if (v6Res.ok) {
      expect(new TextDecoder().decode(v6Res.value)).toBe('PONG:via-ipv6');
    }
  });

  it('explicitly rejects unimplemented QUIC multiaddrs and filters them from runnable paths instead of faking TCP as QUIC', async () => {
    const aId = createNodeIdentity('noquic-a');
    const bId = createNodeIdentity('noquic-b');
    const nodeA = new SovraP2PNode({
      deviceKey: aId.dk,
      binding: aId.binding,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      strictTransport: false,
    });
    nodes.push(nodeA);
    await nodeA.start();

    const quicDial = await nodeA.dial(`/ip4/127.0.0.1/udp/4001/quic/p2p/${bId.binding.peerId}`);
    expect(quicDial.ok).toBe(false);
    if (!quicDial.ok) {
      expect(quicDial.error.message).toMatch(/QUIC.*not implemented/i);
    }

    const filtered = filterDialableMultiaddrs([
      `/ip4/127.0.0.1/udp/4001/quic/p2p/${bId.binding.peerId}`,
      `/ip4/127.0.0.1/tcp/4002/ws/p2p/${bId.binding.peerId}`,
      `/ip4/127.0.0.1/tcp/4001/p2p/${bId.binding.peerId}`,
    ]);
    expect(filtered.some(a => a.includes('/quic'))).toBe(false);
    expect(filtered[0]).toContain('/tcp/4001/p2p/');

    const evalDegraded = calculateUdpPathHealth({ packetsSent: 100, packetsReceived: 50, rttMeanMs: 40, rttStdDevMs: 2 });
    expect(TransportChameleonEngine.selectOperationalTransport(evalDegraded, nodeA.getSupportedTransports())).toBe(
      'ws+noise_xx+yamux',
    );
  });

  it('enforces Noise_XX handshake timeout against stalled sockets and prunes idle connections', async () => {
    const silentPort = await new Promise<number>(resolve => {
      const s = net.createServer(sock => {
        rawSockets.push(sock);
        // Accept TCP connection and intentionally send zero bytes (slow-loris / stalled handshake)
      });
      rawServers.push(s);
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });

    const aId = createNodeIdentity('timeout-a');
    const bId = createNodeIdentity('timeout-b');
    const nodeA = new SovraP2PNode({
      deviceKey: aId.dk,
      binding: aId.binding,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      strictTransport: true,
      dialTimeoutMs: 200,
      handshakeTimeoutMs: 120,
    });
    const nodeB = new SovraP2PNode({
      deviceKey: bId.dk,
      binding: bId.binding,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      strictTransport: true,
    });
    nodes.push(nodeA, nodeB);
    await nodeA.start();
    await nodeB.start();

    const stalledRes = await nodeA.dial(`/ip4/127.0.0.1/tcp/${silentPort}/p2p/${bId.binding.peerId}`);
    expect(stalledRes.ok).toBe(false);
    if (!stalledRes.ok) {
      expect(stalledRes.error.message).toMatch(/timed out|failed/i);
    }

    // Idle connection pruning removes stale sessions
    const okDial = await nodeA.dial(`/ip4/127.0.0.1/tcp/${nodeB.getBoundPort()}/p2p/${nodeB.identity.peerId}`);
    expect(okDial.ok).toBe(true);
    const conn = nodeA.connManager.getConnection(nodeB.identity.peerId)!;
    conn.lastActive = Date.now() - 10_000;
    const pruned = nodeA.connManager.pruneIdleConnections(500);
    expect(pruned).toBe(1);
    expect(nodeA.getConnectedPeers()).toHaveLength(0);
  });

  it('recovers peer connectivity via dialWithRelayFallback when primary direct/relay paths fail', async () => {
    const rDeadId = createNodeIdentity('r-dead');
    const rLiveId = createNodeIdentity('r-live');
    const pAId = createNodeIdentity('p-a');
    const pBId = createNodeIdentity('p-b');

    const rDead = new SovraP2PNode({ deviceKey: rDeadId.dk, binding: rDeadId.binding, listenAddresses: ['/ip4/127.0.0.1/tcp/0'], enableRelayService: true, strictTransport: true });
    const rLive = new SovraP2PNode({ deviceKey: rLiveId.dk, binding: rLiveId.binding, listenAddresses: ['/ip4/127.0.0.1/tcp/0'], enableRelayService: true, strictTransport: true });
    const pA = new SovraP2PNode({ deviceKey: pAId.dk, binding: pAId.binding, listenAddresses: ['/ip4/100.64.20.1/tcp/0'], strictTransport: true });
    const pB = new SovraP2PNode({ deviceKey: pBId.dk, binding: pBId.binding, listenAddresses: ['/ip4/100.64.20.2/tcp/0'], strictTransport: true });
    nodes.push(rDead, rLive, pA, pB);

    await Promise.all([rDead.start(), rLive.start(), pA.start(), pB.start()]);
    const rDeadAddr = `/ip4/127.0.0.1/tcp/${rDead.getBoundPort()}/p2p/${rDead.identity.peerId}`;
    const rLiveAddr = `/ip4/127.0.0.1/tcp/${rLive.getBoundPort()}/p2p/${rLive.identity.peerId}`;

    // pB only reserves on live relay, while rDead goes offline before pA dials
    expect(await pB.requestRelayV2Reservation(rLiveAddr)).toBe(true);
    pB.reqResp.registerHandler('/sovra/recovery/1.0.0', async () => new TextEncoder().encode('RECOVERED_VIA_BACKUP'));
    await rDead.stop();

    const recoveryDial = await pA.dialWithRelayFallback(
      pB.identity.peerId,
      [`/ip4/127.0.0.1/udp/49999/quic/p2p/${pB.identity.peerId}`],
      [rDeadAddr, rLiveAddr],
    );
    expect(recoveryDial.ok).toBe(true);
    if (recoveryDial.ok) {
      expect(recoveryDial.value.connectionType).toBe('relayed');
    }
    const connectedSummary = pA.getConnectedPeers().find(p => p.id.peerId === pB.identity.peerId);
    expect(connectedSummary?.connectionType).toBe('relayed');
    expect(connectedSummary?.status).toBe('relayed');

    const res = await pA.reqResp.sendRequest(pB.identity.peerId, '/sovra/recovery/1.0.0', new Uint8Array(0));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(new TextDecoder().decode(res.value)).toBe('RECOVERED_VIA_BACKUP');
    }
  });
});
