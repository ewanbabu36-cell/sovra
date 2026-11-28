import { afterEach, describe, expect, it } from 'vitest';
import * as dgram from 'node:dgram';
import * as http from 'node:http';
import * as net from 'node:net';
import {
  AutoPortMapper,
  KademliaDHT,
  MAX_ONION_PEERS_TOTAL,
  MAX_PEERS_PER_SUBNET,
  SovraP2PNode,
  createPeerIdentityBinding,
  createSignedBootstrapBundle,
  parseOnionMultiaddr,
  parseSignedBootstrapRegistryJson,
  parseSocks5ProxyUrl,
  signBootstrapPeerEntry,
} from '../src/index.js';
import { SovraDeviceKey, SovraIdentityKey, createDeviceDelegation } from '@sovra/identity';
import { bytesToHex, generateEd25519KeyPair, sha256 } from '@sovra/crypto';

async function createNode(listenAddresses: string[], extra: Record<string, any> = {}): Promise<SovraP2PNode> {
  const idKp = generateEd25519KeyPair();
  const devKp = generateEd25519KeyPair();
  const idKey = new SovraIdentityKey(idKp.privateKey);
  const validUntil = Math.floor(Date.now() / 1000) + 3600;
  const devKey = new SovraDeviceKey('dev-1', 'Test Device', idKey.did, devKp.privateKey, validUntil);
  const delegation = createDeviceDelegation(idKey, devKey, validUntil);
  const binding = createPeerIdentityBinding(devKey, idKey.did, delegation);
  const node = new SovraP2PNode({
    deviceKey: devKey,
    binding,
    listenAddresses,
    strictTransport: true,
    ...extra,
  });
  const res = await node.start();
  if (!res.ok) throw res.error;
  return node;
}

describe('Zero-Domain Home Router Auto-Port-Mapping (UPnP / NAT-PMP) & Tor .onion SOCKS5 Transport', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it('parses v3 .onion multiaddrs and SOCKS5 proxy URIs strictly', () => {
    const sampleV3 = 'a'.repeat(56);
    const parsed = parseOnionMultiaddr(`/onion3/${sampleV3}:4001/p2p/12D3KooWTestPeer`);
    expect(parsed).toEqual({
      host: `${sampleV3}.onion`,
      port: 4001,
      peerId: '12D3KooWTestPeer',
      version: 3,
    });
    expect(parseOnionMultiaddr('/onion3/invalidshort:4001/p2p/12D3KooW')).toBeNull();
    expect(parseSocks5ProxyUrl('socks5h://127.0.0.1:9050')).toEqual({
      host: '127.0.0.1',
      port: 9050,
      resolveRemoteHostnames: true,
    });
  });

  it('fails closed when dialing .onion without a configured Tor SOCKS5 proxy (never leaks to clearnet DNS)', async () => {
    const clientNode = await createNode(['/ip4/127.0.0.1/tcp/0']);
    cleanups.push(() => clientNode.stop());

    const onionAddr = `/onion3/${'a'.repeat(56)}:4001/p2p/12D3KooWFakePeerId00000000000000000000000000000000`;
    const res = await clientNode.dial(onionAddr);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toMatch(/SOCKS5|Tor/i);
    }
  });

  it('completes real Noise_XX + Yamux handshake over SOCKS5 ATYP=DOMAINNAME for /onion3/ peers', async () => {
    const hiddenServerNode = await createNode(['/ip4/127.0.0.1/tcp/0']);
    cleanups.push(() => hiddenServerNode.stop());
    const hiddenPort = hiddenServerNode.getBoundPort()!;
    const expectedOnion = `${'b'.repeat(56)}.onion`;

    // Real RFC 1928 SOCKS5 server forwarding .onion host connect -> hidden local TCP P2P port
    let observedTargetHost = '';
    let observedAtyp = 0;
    const proxySockets = new Set<net.Socket>();
    const socksServer = net.createServer(clientSock => {
      proxySockets.add(clientSock);
      clientSock.on('close', () => proxySockets.delete(clientSock));
      let stage = 0;
      let buf = Buffer.alloc(0);
      clientSock.on('data', chunk => {
        if (stage === 2) return;
        buf = Buffer.concat([buf, chunk]);
        if (stage === 0 && buf.length >= 3) {
          // Reply NO AUTH (0x00)
          buf = buf.subarray(2 + buf[1]!);
          stage = 1;
          clientSock.write(Buffer.from([0x05, 0x00]));
        }
        if (stage === 1 && buf.length >= 5) {
          observedAtyp = buf[3]!;
          const hostLen = buf[4]!;
          if (buf.length < 5 + hostLen + 2) return;
          observedTargetHost = buf.subarray(5, 5 + hostLen).toString('utf8');
          const leftover = buf.subarray(5 + hostLen + 2);
          stage = 2;
          const upstream = net.createConnection({ host: '127.0.0.1', port: hiddenPort }, () => {
            clientSock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
            if (leftover.length > 0) upstream.write(leftover);
            clientSock.pipe(upstream);
            upstream.pipe(clientSock);
          });
          proxySockets.add(upstream);
          upstream.on('error', () => clientSock.destroy());
        }
      });
    });
    await new Promise<void>(r => socksServer.listen(0, '127.0.0.1', r));
    const proxyPort = (socksServer.address() as net.AddressInfo).port;
    cleanups.push(async () => {
      for (const s of proxySockets) s.destroy();
      await new Promise<void>(r => socksServer.close(() => r()));
    });

    const torClientNode = await createNode(['/ip4/127.0.0.1/tcp/0'], {
      socks5ProxyUrl: `socks5h://127.0.0.1:${proxyPort}`,
    });
    cleanups.push(() => torClientNode.stop());

    const onionMultiaddr = `/onion3/${'b'.repeat(56)}:4001/p2p/${hiddenServerNode.identity.peerId}`;
    const dialRes = await torClientNode.dial(onionMultiaddr);
    expect(dialRes.ok).toBe(true);
    expect(observedAtyp).toBe(0x03); // Domain resolution delegated strictly to SOCKS5 proxy
    expect(observedTargetHost).toBe(expectedOnion);
    if (dialRes.ok) {
      expect(dialRes.value.id.peerId).toBe(hiddenServerNode.identity.peerId);
      expect(dialRes.value.connectionType).toBe('tor-onion');
    }

    // Bidirectional onion-to-onion ReqResp traffic routed inside encrypted Noise_XX over SOCKS5
    hiddenServerNode.reqResp.registerHandler('/sovra/onion/echo/1.0.0', async (_peer, data) => {
      return new TextEncoder().encode(`ONION_ACK:${new TextDecoder().decode(data)}`);
    });
    const echoRes = await torClientNode.reqResp.sendRequest(
      hiddenServerNode.identity.peerId,
      '/sovra/onion/echo/1.0.0',
      new TextEncoder().encode('zero-clearnet'),
    );
    expect(echoRes.ok).toBe(true);
    if (echoRes.ok) {
      expect(new TextDecoder().decode(echoRes.value)).toBe('ONION_ACK:zero-clearnet');
    }
  });

  it('performs real RFC 6887 PCP (v2 MAP) port mapping and lifetime=0 unmap fallback on stop()', async () => {
    const udpRouter = dgram.createSocket('udp4');
    let pcpAllocLifetime = -1;
    let pcpUnmapLifetime = -1;
    let allocatedNonce: Buffer | null = null;
    let unmapNonceMatched = false;

    udpRouter.on('message', (msg, rinfo) => {
      // Simulate router that ignores NAT-PMP v0 and answers only RFC 6887 PCP v2 MAP (version=2, opcode=1)
      if (msg.length >= 60 && msg[0] === 0x02 && msg[1] === 0x01) {
        const lifetime = msg.readUInt32BE(4);
        const nonce = msg.subarray(24, 36);
        const internalPort = msg.readUInt16BE(40);
        const extPort = msg.readUInt16BE(42) || internalPort;
        if (lifetime > 0) {
          pcpAllocLifetime = lifetime;
          allocatedNonce = Buffer.from(nonce);
        } else {
          pcpUnmapLifetime = lifetime;
          unmapNonceMatched = Boolean(allocatedNonce && nonce.equals(allocatedNonce));
        }

        const resp = Buffer.alloc(60);
        resp[0] = 0x02; // Version 2
        resp[1] = 0x81; // R=1, MAP=1
        resp[2] = 0;
        resp[3] = 0; // SUCCESS
        resp.writeUInt32BE(lifetime, 4);
        resp.writeUInt32BE(42, 8); // Epoch time
        nonce.copy(resp, 24);
        resp[36] = msg[36]!; // Protocol
        resp.writeUInt16BE(internalPort, 40);
        resp.writeUInt16BE(extPort, 42);
        // External IP 198.51.100.88 mapped as ::ffff:198.51.100.88
        resp[54] = 0xff;
        resp[55] = 0xff;
        resp[56] = 198;
        resp[57] = 51;
        resp[58] = 100;
        resp[59] = 88;
        udpRouter.send(resp, rinfo.port, rinfo.address);
      }
    });

    await new Promise<void>(r => udpRouter.bind(0, '127.0.0.1', r));
    const pcpRouterPort = (udpRouter.address() as net.AddressInfo).port;
    cleanups.push(() => new Promise<void>(r => udpRouter.close(() => r())));

    const node = await createNode(['/ip4/127.0.0.1/tcp/0'], {
      enableUpnp: true,
      upnpOptions: {
        pcpGateway: '127.0.0.1',
        pcpPort: pcpRouterPort,
        natPmpGateway: '127.0.0.1',
        natPmpPort: pcpRouterPort,
        clientIp: '10.0.0.42',
        timeoutMs: 250,
      },
    });

    const mappedPort = node.getBoundPort()!;
    expect(pcpAllocLifetime).toBe(3600);
    expect(node.getAdvertisedAddresses()).toContain(`/ip4/198.51.100.88/tcp/${mappedPort}/p2p/${node.identity.peerId}`);

    await node.stop();
    expect(pcpUnmapLifetime).toBe(0);
    expect(unmapNonceMatched).toBe(true);
  });

  it('performs real NAT-PMP (RFC 6886) mapping and teardown on stop()', async () => {
    const udpRouter = dgram.createSocket('udp4');
    let lastUnmapLifetime = -1;
    udpRouter.on('message', (msg, rinfo) => {
      const op = msg[1]!;
      if (op === 0) {
        const resp = Buffer.from([0x00, 128, 0, 0, 0, 0, 0, 10, 203, 0, 113, 77]);
        udpRouter.send(resp, rinfo.port, rinfo.address);
      } else if (op === 2) {
        const internalPort = msg.readUInt16BE(4);
        const externalPort = msg.readUInt16BE(6);
        const lifetime = msg.readUInt32BE(8);
        if (lifetime === 0) lastUnmapLifetime = 0;
        const resp = Buffer.alloc(16);
        resp[0] = 0x00;
        resp[1] = 130;
        resp.writeUInt16BE(0, 2);
        resp.writeUInt32BE(10, 4);
        resp.writeUInt16BE(internalPort, 8);
        resp.writeUInt16BE(externalPort || internalPort, 10);
        resp.writeUInt32BE(lifetime, 12);
        udpRouter.send(resp, rinfo.port, rinfo.address);
      }
    });
    await new Promise<void>(r => udpRouter.bind(0, '127.0.0.1', r));
    const routerPort = (udpRouter.address() as net.AddressInfo).port;
    cleanups.push(() => new Promise<void>(r => udpRouter.close(() => r())));

    const node = await createNode(['/ip4/127.0.0.1/tcp/0'], {
      enableUpnp: true,
      upnpOptions: { natPmpGateway: '127.0.0.1', natPmpPort: routerPort, timeoutMs: 500 },
    });

    const addrs = node.getAdvertisedAddresses();
    const mappedPort = node.getBoundPort()!;
    expect(addrs).toContain(`/ip4/203.0.113.77/tcp/${mappedPort}/p2p/${node.identity.peerId}`);

    await node.stop();
    expect(lastUnmapLifetime).toBe(0);
  });

  it('performs real UPnP IGD SOAP AddPortMapping, GetExternalIPAddress, and DeletePortMapping cleanup', async () => {
    let addedPort = 0;
    let deletedPort = 0;
    const upnpServer = http.createServer((req, res) => {
      if (req.url === '/rootDesc.xml') {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(`<root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>`);
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const action = String(req.headers['soapaction'] || '');
        if (action.includes('AddPortMapping')) {
          const m = body.match(/<NewExternalPort>(\d+)<\/NewExternalPort>/);
          if (m?.[1]) addedPort = parseInt(m[1], 10);
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end('<s:Envelope><s:Body><u:AddPortMappingResponse/></s:Body></s:Envelope>');
          return;
        }
        if (action.includes('GetExternalIPAddress')) {
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end('<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>198.51.100.42</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>');
          return;
        }
        if (action.includes('DeletePortMapping')) {
          const m = body.match(/<NewExternalPort>(\d+)<\/NewExternalPort>/);
          if (m?.[1]) deletedPort = parseInt(m[1], 10);
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end('<s:Envelope><s:Body><u:DeletePortMappingResponse/></s:Body></s:Envelope>');
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>(r => upnpServer.listen(0, '127.0.0.1', r));
    const upnpPort = (upnpServer.address() as net.AddressInfo).port;
    cleanups.push(() => new Promise<void>(r => upnpServer.close(() => r())));

    const mapper = new AutoPortMapper();
    const lease = await mapper.mapPort({
      internalPort: 4512,
      upnpLocationUrl: `http://127.0.0.1:${upnpPort}/rootDesc.xml`,
      timeoutMs: 500,
    });
    expect(lease.ok).toBe(true);
    if (lease.ok) {
      expect(lease.method).toBe('upnp-igd');
      expect(lease.externalIp).toBe('198.51.100.42');
      expect(addedPort).toBe(4512);
    }
    await mapper.unmapAll();
    expect(deletedPort).toBe(4512);
  });

  it('enforces global cross-bucket /24 IPv4 and .onion caps against DHT eclipse flooding', () => {
    const localId = bytesToHex(sha256(new TextEncoder().encode('local-dht-root')));
    const dht = new KademliaDHT(localId);

    // Insert peers that fall into DIFFERENT Kademlia buckets but share the same /24 subnet
    let acceptedIp4 = 0;
    for (let i = 0; i < 6; i++) {
      const peerId = bytesToHex(sha256(new TextEncoder().encode(`sybil-ip4-peer-${i}`)));
      const ok = dht.addPeer({
        id: { peerId, publicKey: new Uint8Array(32) },
        addresses: [`/ip4/203.0.113.${10 + i}/tcp/4001/p2p/${peerId}`],
        lastSeen: Date.now(),
        protocols: ['/sovra/dht/1.0.0'],
      });
      if (ok) acceptedIp4++;
    }
    expect(acceptedIp4).toBe(MAX_PEERS_PER_SUBNET);

    // Insert .onion peers globally bounded to MAX_ONION_PEERS_TOTAL (8) across all buckets
    let acceptedOnion = 0;
    for (let i = 0; i < MAX_ONION_PEERS_TOTAL + 4; i++) {
      const peerId = bytesToHex(sha256(new TextEncoder().encode(`sybil-onion-peer-${i}`)));
      const onionHost = String.fromCharCode(97 + (i % 26)).repeat(56);
      const ok = dht.addPeer({
        id: { peerId, publicKey: new Uint8Array(32) },
        addresses: [`/onion3/${onionHost}:4001/p2p/${peerId}`],
        lastSeen: Date.now(),
        protocols: ['/sovra/dht/1.0.0'],
      });
      if (ok) acceptedOnion++;
    }
    expect(acceptedOnion).toBe(MAX_ONION_PEERS_TOTAL);
  });

  it('rejects spoofed PUT_VALUE / ADD_PROVIDER authors, stale sequences, and excessive TTLs', () => {
    const dht = new KademliaDHT('dht-auth-validator-node');
    const authPeer = 'peer-alice-authenticated';

    const spoofPut = dht.handleRpcMessage(
      {
        type: 'PUT_VALUE',
        targetKey: 'profile:bob',
        senderPeerId: authPeer,
        record: {
          key: 'profile:bob',
          value: new Uint8Array([1, 2, 3]),
          authorPeerId: 'peer-bob-victim',
          sequenceNumber: 1,
          timestamp: Math.floor(Date.now() / 1000),
        },
      },
      authPeer,
    );
    expect(spoofPut.success).toBe(false);

    const validPut = dht.handleRpcMessage(
      {
        type: 'PUT_VALUE',
        targetKey: 'profile:alice',
        senderPeerId: authPeer,
        record: {
          key: 'profile:alice',
          value: new Uint8Array([7, 8]),
          authorPeerId: authPeer,
          sequenceNumber: 5,
          timestamp: Math.floor(Date.now() / 1000),
        },
      },
      authPeer,
    );
    expect(validPut.success).toBe(true);

    const stalePut = dht.handleRpcMessage(
      {
        type: 'PUT_VALUE',
        targetKey: 'profile:alice',
        senderPeerId: authPeer,
        record: {
          key: 'profile:alice',
          value: new Uint8Array([9]),
          authorPeerId: authPeer,
          sequenceNumber: 4,
          timestamp: Math.floor(Date.now() / 1000),
        },
      },
      authPeer,
    );
    expect(stalePut.success).toBe(false);

    const spoofProv = dht.handleRpcMessage(
      {
        type: 'ADD_PROVIDER',
        targetKey: 'cid-xyz',
        senderPeerId: authPeer,
        provider: {
          peerId: 'peer-evil-impersonated',
          addresses: ['/ip4/198.51.100.5/tcp/4001'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      authPeer,
    );
    expect(spoofProv.success).toBe(false);

    const nowSec = Math.floor(Date.now() / 1000);
    const boundedProv = dht.handleRpcMessage(
      {
        type: 'ADD_PROVIDER',
        targetKey: 'cid-xyz',
        senderPeerId: authPeer,
        provider: {
          peerId: authPeer,
          addresses: ['/ip4/198.51.100.6/tcp/4001'],
          expiresAt: nowSec + 99_999_999,
        },
      },
      authPeer,
    );
    expect(boundedProv.success).toBe(true);
    const getProv = dht.handleRpcMessage({ type: 'GET_PROVIDERS', targetKey: 'cid-xyz' });
    expect(getProv.success).toBe(true);
    expect(getProv.providers?.[0]?.expiresAt).toBeLessThanOrEqual(nowSec + 86400 + 5);
  });

  it('verifies signed community seed registries with httpUrl/spkiSha256 and rejects tampered JSON', () => {
    const opA = generateEd25519KeyPair();
    const opB = generateEd25519KeyPair();

    const p1 = signBootstrapPeerEntry(
      {
        peerId: '12D3KooWCommunityPeerA',
        operatorId: 'volunteer-eu-1',
        networkSubnetOrAsn: '203.0.113.0/24',
        multiaddrs: ['/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWCommunityPeerA'],
        httpUrl: 'https://203.0.113.10:3443',
        spkiSha256: 'ab'.repeat(32),
        capabilities: ['relay', 'bootstrap'],
        protocolVersions: ['/sovra/1.0.0'],
        publicKeyHex: bytesToHex(opA.publicKey),
      },
      opA.privateKey,
    );
    const p2 = signBootstrapPeerEntry(
      {
        peerId: '12D3KooWCommunityPeerB',
        operatorId: 'volunteer-jp-2',
        networkSubnetOrAsn: '198.51.100.0/24',
        multiaddrs: ['/ip4/198.51.100.20/tcp/4001/p2p/12D3KooWCommunityPeerB'],
        httpUrl: 'http://198.51.100.20:3001',
        capabilities: ['bootstrap'],
        protocolVersions: ['/sovra/1.0.0'],
        publicKeyHex: bytesToHex(opB.publicKey),
      },
      opB.privateKey,
    );

    const bundle = createSignedBootstrapBundle({
      network_id: 'sovra-mainnet-zero-domain',
      peers: [p1, p2],
      signers: [
        { operatorId: 'volunteer-eu-1', publicKeyHex: bytesToHex(opA.publicKey), privateKey: opA.privateKey },
        { operatorId: 'volunteer-jp-2', publicKeyHex: bytesToHex(opB.publicKey), privateKey: opB.privateKey },
      ],
    });

    const parsed = parseSignedBootstrapRegistryJson(JSON.stringify(bundle), {
      expectedNetworkId: 'sovra-mainnet-zero-domain',
      minIndependentOperators: 2,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.verifiedOperators.length).toBe(2);
      expect(parsed.value.bundle.peers[0]?.spkiSha256).toBe('ab'.repeat(32));
    }

    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.peers[0].httpUrl = 'https://evil.example:3443';
    const failRes = parseSignedBootstrapRegistryJson(JSON.stringify(tampered), { minIndependentOperators: 2 });
    expect(failRes.ok).toBe(false);
  });
});
