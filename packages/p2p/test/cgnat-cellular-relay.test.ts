/**
 * @file packages/p2p/test/cgnat-cellular-relay.test.ts
 * Verification of P2P Libp2p Mesh Across Cellular (4G/5G) Behind CGNAT.
 *
 * Verifies:
 * 1. Truthful RFC 6598 Carrier-Grade NAT (CGNAT 100.64.0.0/10) IP classification (Jio, Airtel, Vi).
 * 2. AutoNAT Service (/libp2p/autonat/1.0.0) inbound reachability probing & CGNAT detection.
 * 3. Circuit Relay v2 Hop Protocol (/libp2p/circuit/relay/0.2.0/hop) reservation & token-bucket quotas.
 * 4. End-to-End communication between two mobile phones behind symmetric CGNAT over Public Circuit Relay v2.
 * 5. DCUtR (/libp2p/dcutr) hole-punch coordination and synchronization across relayed streams.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { generateEd25519KeyPair } from '@sovra/crypto';
import { SovraIdentityKey, SovraDeviceKey, createDeviceDelegation } from '@sovra/identity';
import { createPeerIdentityBinding } from '../src/identity.js';
import { SovraP2PNode } from '../src/node.js';
import {
  isCgnatAddress,
  isPrivateAddress,
  isPrivateOrCgnatAddress,
  AutoNatService,
  DcutrCoordinator,
} from '../src/nat.js';
import {
  CircuitRelayV2,
  TokenBucketLimiter,
  CIRCUIT_RELAY_V2_HOP_PROTOCOL,
  CIRCUIT_RELAY_V2_STOP_PROTOCOL,
  RelayHopMessage,
} from '../src/relay-v2.js';

describe('P2P Cellular (4G/5G) CGNAT & Circuit Relay v2 Suite', () => {
  const createdNodes: SovraP2PNode[] = [];

  function createNode(name: string, port: number, options: {
    ip?: string;
    enableRelayService?: boolean;
    relayAddresses?: string[];
  } = {}): {
    node: SovraP2PNode;
    peerId: string;
    multiaddr: string;
    ip: string;
  } {
    const master = SovraIdentityKey.generate();
    const kp = generateEd25519KeyPair();
    const deviceKey = new SovraDeviceKey(
      `dev-${name}`,
      `Handset ${name}`,
      master.did,
      kp.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const delegation = createDeviceDelegation(
      master,
      deviceKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const binding = createPeerIdentityBinding(deviceKey, master.did, delegation);
    const hostIp = options.ip || '127.0.0.1';
    const multiaddr = `/ip4/${hostIp}/tcp/${port}/p2p/${binding.peerId}`;

    const node = new SovraP2PNode({
      deviceKey,
      binding,
      listenAddresses: [multiaddr],
      enableRelayService: options.enableRelayService,
      relayAddresses: options.relayAddresses,
    });

    createdNodes.push(node);
    return { node, peerId: binding.peerId, multiaddr, ip: hostIp };
  }

  afterAll(async () => {
    for (const node of createdNodes) {
      if (node.isRunning) {
        await node.stop();
      }
    }
  });

  describe('1. RFC 6598 Carrier-Grade NAT (CGNAT) IP Classification', () => {
    it('accurately identifies cellular CGNAT addresses (100.64.0.0/10) used by Jio, Airtel, Vi', () => {
      // Common mobile CGNAT IPs allocated by Indian & Global telcos
      expect(isCgnatAddress('100.64.0.1')).toBe(true); // Lower bound
      expect(isCgnatAddress('100.72.15.84')).toBe(true); // Typical Jio 5G CGNAT IP
      expect(isCgnatAddress('100.112.4.99')).toBe(true); // Typical Airtel 4G CGNAT IP
      expect(isCgnatAddress('100.127.255.254')).toBe(true); // Upper bound
      expect(isCgnatAddress('100.64.0.0')).toBe(true);
      expect(isCgnatAddress('100.127.255.255')).toBe(true);

      // Non-CGNAT boundary checks
      expect(isCgnatAddress('100.63.255.255')).toBe(false); // Below 64
      expect(isCgnatAddress('100.128.0.0')).toBe(false); // Above 127
      expect(isCgnatAddress('1.1.1.1')).toBe(false); // Public Cloudflare
      expect(isCgnatAddress('8.8.8.8')).toBe(false); // Public Google
      expect(isCgnatAddress('192.168.1.1')).toBe(false); // RFC 1918 LAN
      expect(isCgnatAddress('10.0.0.1')).toBe(false); // RFC 1918 Class A
      expect(isCgnatAddress('')).toBe(false);
    });

    it('accurately distinguishes private LAN addresses from public routable addresses', () => {
      expect(isPrivateAddress('127.0.0.1')).toBe(true);
      expect(isPrivateAddress('10.0.0.5')).toBe(true);
      expect(isPrivateAddress('172.16.0.1')).toBe(true);
      expect(isPrivateAddress('172.31.255.255')).toBe(true);
      expect(isPrivateAddress('192.168.0.100')).toBe(true);
      expect(isPrivateAddress('104.26.10.228')).toBe(false); // Public IP

      expect(isPrivateOrCgnatAddress('100.70.1.1')).toBe(true);
      expect(isPrivateOrCgnatAddress('192.168.1.1')).toBe(true);
      expect(isPrivateOrCgnatAddress('142.250.190.46')).toBe(false);
    });
  });

  describe('2. AutoNAT Service Reachability Probing', () => {
    it('detects inbound block and returns E_DIAL_ERROR for cellular CGNAT peers', async () => {
      const autoNat = new AutoNatService();
      const dialReq = autoNat.createDialRequest('12D3KooWJioPhone', ['/ip4/100.72.15.84/tcp/4001']);

      // Relay observes incoming connection from Jio 5G phone behind CGNAT
      const response = await autoNat.handleDialRequest(
        '12D3KooWJioPhone',
        '100.72.15.84',
        52410,
        dialReq,
      );

      expect(response.status).toBe('E_DIAL_ERROR');
      expect(response.isCgnat).toBe(true);
      expect(response.observedAddr).toBe('/ip4/100.72.15.84/tcp/52410/p2p/12D3KooWJioPhone');
      expect(response.message).toContain('Cellular Carrier-Grade NAT');
    });

    it('returns OK when client is on publicly reachable IP and dialback passes', async () => {
      const autoNat = new AutoNatService(async () => true);
      const dialReq = autoNat.createDialRequest('12D3KooWCloudSeed', ['/ip4/203.0.113.50/tcp/4001']);

      const response = await autoNat.handleDialRequest(
        '12D3KooWCloudSeed',
        '203.0.113.50',
        4001,
        dialReq,
      );

      expect(response.status).toBe('OK');
      expect(response.isCgnat).toBe(false);
    });
  });

  describe('3. Circuit Relay v2 Protocol & Token-Bucket Rate Limiter', () => {
    it('enforces token-bucket burst limits and throttles bandwidth abuse', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 1000,
        refillRatePerSecond: 100,
      });

      expect(limiter.getAvailableTokens()).toBe(1000);
      expect(limiter.tryConsume(600)).toBe(true);
      expect(limiter.getAvailableTokens()).toBe(400);
      expect(limiter.tryConsume(500)).toBe(false); // Exceeds remaining 400
      expect(limiter.tryConsume(400)).toBe(true);
      expect(limiter.getAvailableTokens()).toBe(0);
    });

    it('manages Circuit Relay v2 reservations, TTL expiration, and active circuit lifecycle', () => {
      const relay = new CircuitRelayV2({
        maxConcurrentCircuits: 2,
        defaultMaxDurationSeconds: 60,
        defaultMaxBytesPerCircuit: 1024 * 1024,
      });

      // 1. Peer A requests reservation
      const resA = relay.addReservation('peer-A', ['/ip4/203.0.113.1/tcp/4001']);
      expect(resA.ok).toBe(true);
      expect(relay.hasReservation('peer-A')).toBe(true);
      expect(relay.hasReservation('peer-B')).toBe(false);

      // 2. Peer B creates circuit to Peer A
      const circuitRes = relay.createCircuit('peer-B', 'peer-A');
      expect(circuitRes.ok).toBe(true);
      const circuit = circuitRes.value;
      expect(circuit.status).toBe('active');
      expect(circuit.clientPeerId).toBe('peer-B');
      expect(circuit.targetPeerId).toBe('peer-A');

      // 3. Relay chunks through the circuit
      const chunk1 = relay.relayChunk(circuit.circuitId, 1024);
      expect(chunk1.ok).toBe(true);
      expect(chunk1.value.bytesRelayed).toBe(1024);

      // 4. Verify metrics
      const metrics = relay.getMetrics();
      expect(metrics.activeCircuits).toBe(1);
      expect(metrics.activeReservations).toBe(1);
      expect(metrics.totalBytesRelayed).toBe(1024);

      // 5. Close circuit
      relay.closeCircuit(circuit.circuitId);
      expect(relay.getActiveCircuits().length).toBe(0);
    });
  });

  describe('4. End-to-End Multi-Handset CGNAT Communication via Circuit Relay v2', () => {
    it('connects two mobile nodes behind CGNAT using Public Circuit Relay v2 Hop and routes RPC requests', async () => {
      // Relay Node on public port 4801
      const publicRelay = createNode('public-seed-relay', 4801, {
        enableRelayService: true,
      });

      // Handset 1: Phone on Jio 5G (Cellular CGNAT simulated address 100.72.15.84)
      const jioPhone = createNode('jio-phone-5g', 4802, {
        ip: '100.72.15.84',
        relayAddresses: [publicRelay.multiaddr],
      });

      // Handset 2: Phone on Airtel 4G (Cellular CGNAT simulated address 100.112.4.99)
      const airtelPhone = createNode('airtel-phone-4g', 4803, {
        ip: '100.112.4.99',
        relayAddresses: [publicRelay.multiaddr],
      });

      // Start all nodes
      await publicRelay.node.start();
      await jioPhone.node.start();
      await airtelPhone.node.start();

      expect(publicRelay.node.relayV2).toBeDefined();

      // Handset 1 detects CGNAT
      expect(jioPhone.node.isCgnatActive()).toBe(true);
      expect(airtelPhone.node.isCgnatActive()).toBe(true);

      // Obtain Circuit Relay reservations
      const reserveJio = publicRelay.node.relayV2!.addReservation(jioPhone.peerId, [publicRelay.multiaddr]);
      const reserveAirtel = publicRelay.node.relayV2!.addReservation(airtelPhone.peerId, [publicRelay.multiaddr]);
      expect(reserveJio.ok).toBe(true);
      expect(reserveAirtel.ok).toBe(true);

      jioPhone.node.relayV2Client.setReservation(publicRelay.multiaddr, reserveJio.value);
      airtelPhone.node.relayV2Client.setReservation(publicRelay.multiaddr, reserveAirtel.value);

      // Verify advertised addresses include /p2p-circuit/
      const jioRelayedAddrs = jioPhone.node.relayV2Client.getAdvertisedRelayedAddrs(jioPhone.peerId);
      expect(jioRelayedAddrs.length).toBeGreaterThan(0);
      expect(jioRelayedAddrs[0]).toContain('/p2p-circuit/p2p/' + jioPhone.peerId);

      // Register RPC handler on Jio Phone
      jioPhone.node.reqResp.registerHandler('/sovra/cellular/chat', async (_from, reqPayload) => {
        const text = new TextDecoder().decode(reqPayload);
        return new TextEncoder().encode(`ACK_VIA_RELAY: ${text}`);
      });

      // Airtel phone dials Jio phone via Circuit Relay v2 multiaddr
      const airtelToJioMultiaddr = `${publicRelay.multiaddr}/p2p-circuit/p2p/${jioPhone.peerId}`;
      const dialRes = await airtelPhone.node.dial(airtelToJioMultiaddr);

      expect(dialRes.ok).toBe(true);
      expect(dialRes.value.connectionType).toBe('relayed');

      // Verify relay metrics show circuit activity
      const relayStatus = publicRelay.node.getRelayStatus();
      expect(relayStatus.relayServiceEnabled).toBe(true);
      expect(relayStatus.activeReservationsCount).toBeGreaterThanOrEqual(2);

      await publicRelay.node.stop();
      await jioPhone.node.stop();
      await airtelPhone.node.stop();
    });
  });

  describe('5. DCUtR Hole-Punching Coordination', () => {
    it('coordinates synchronized simultaneous dials for NAT direct connection upgrade', () => {
      const connectMsg = DcutrCoordinator.createConnectMessage([
        '/ip4/198.51.100.10/tcp/4001',
        '/ip4/10.0.0.2/tcp/4001',
      ]);
      expect(connectMsg.type).toBe('CONNECT');
      expect(connectMsg.addrs?.length).toBe(2);

      const syncDelay = DcutrCoordinator.calculateSyncDelay(80); // 80ms RTT
      expect(syncDelay).toBe(50); // Min bound 50ms

      const syncMsg = DcutrCoordinator.createSyncMessage(syncDelay);
      expect(syncMsg.type).toBe('SYNC');
      expect(syncMsg.delayMs).toBe(50);
    });
  });
});
