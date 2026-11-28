import { afterEach, describe, expect, it } from 'vitest';
import { bytesToHex, generateEd25519KeyPair, sha256 } from '@sovra/crypto';
import { SovraDeviceKey, SovraIdentityKey, createDeviceDelegation } from '@sovra/identity';
import {
  CIRCUIT_RELAY_FORWARD_PROTOCOL,
  DCUTR_PROTOCOL,
  KademliaDHT,
  MAX_ONION_PEERS_TOTAL,
  MAX_PEERS_PER_SUBNET,
  SOVRA_PEX_PROTOCOL,
  SovraP2PNode,
  buildDhtRecordSignableBytes,
  buildProviderRecordSignableBytes,
  createPeerIdentityBinding,
  derivePeerId,
} from '../src/index.js';

async function startBoundNode(listenAddresses: string[] = ['/ip4/127.0.0.1/tcp/0']) {
  const idKp = generateEd25519KeyPair();
  const devKp = generateEd25519KeyPair();
  const idKey = new SovraIdentityKey(idKp.privateKey);
  const validUntil = Math.floor(Date.now() / 1000) + 3600;
  const devKey = new SovraDeviceKey('dev-sec', 'Sec Device', idKey.did, devKp.privateKey, validUntil);
  const delegation = createDeviceDelegation(idKey, devKey, validUntil);
  const binding = createPeerIdentityBinding(devKey, idKey.did, delegation);
  const node = new SovraP2PNode({
    deviceKey: devKey,
    binding,
    listenAddresses,
    strictTransport: true,
    enableRelayService: true,
    enableAutoPex: false,
  });
  const res = await node.start();
  if (!res.ok) throw res.error;
  return { node, devKey, peerId: node.identity.peerId };
}

describe('Phase 2 Adversarial DHT, PEX, Circuit Relay & DCUtR Security Suite', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it('blocks multi-address subnet & .onion quota evasion across all Kademlia buckets (IPv4 /24, IPv6 /48, .onion)', () => {
    const localId = bytesToHex(sha256(new TextEncoder().encode('local-sec-dht-node')));
    const dht = new KademliaDHT(localId);

    // Attacker places exempted loopback address first to try hiding second /24 IPv4 address
    let acceptedIp4 = 0;
    for (let i = 0; i < 6; i++) {
      const kp = generateEd25519KeyPair();
      const pid = derivePeerId(kp.publicKey);
      const ok = dht.addPeer({
        id: { peerId: pid, publicKeyHex: bytesToHex(kp.publicKey) },
        addresses: [
          `/ip4/127.0.0.1/tcp/${5000 + i}/p2p/${pid}`,
          `/ip4/198.51.100.${10 + i}/tcp/4001/p2p/${pid}`,
        ],
        status: 'connected',
        score: 0,
      });
      if (ok) acceptedIp4++;
    }
    expect(acceptedIp4).toBe(MAX_PEERS_PER_SUBNET);

    // Same evasion attempt with IPv6 /48 prefix across distinct XOR buckets
    let acceptedIp6 = 0;
    for (let i = 0; i < 6; i++) {
      const kp = generateEd25519KeyPair();
      const pid = derivePeerId(kp.publicKey);
      const ok = dht.addPeer({
        id: { peerId: pid, publicKeyHex: bytesToHex(kp.publicKey) },
        addresses: [
          `/ip4/127.0.0.1/tcp/${6000 + i}/p2p/${pid}`,
          `/ip6/2001:db8:abcd::${i + 1}/tcp/4001/p2p/${pid}`,
        ],
        status: 'connected',
        score: 0,
      });
      if (ok) acceptedIp6++;
    }
    expect(acceptedIp6).toBe(MAX_PEERS_PER_SUBNET);

    // Same multi-address evasion attempt for .onion quota
    let acceptedOnion = 0;
    for (let i = 0; i < MAX_ONION_PEERS_TOTAL + 5; i++) {
      const kp = generateEd25519KeyPair();
      const pid = derivePeerId(kp.publicKey);
      const onionHost = String.fromCharCode(97 + (i % 26)).repeat(56);
      const ok = dht.addPeer({
        id: { peerId: pid, publicKeyHex: bytesToHex(kp.publicKey) },
        addresses: [
          `/ip4/127.0.0.1/tcp/${7000 + i}/p2p/${pid}`,
          `/onion3/${onionHost}:4001/p2p/${pid}`,
        ],
        status: 'connected',
        score: 0,
      });
      if (ok) acceptedOnion++;
    }
    expect(acceptedOnion).toBe(MAX_ONION_PEERS_TOTAL);
  });

  it('enforces Ed25519 record signatures, provider address ownership, anti-replay, and expiry on strict DHT', async () => {
    const devKp = generateEd25519KeyPair();
    const attackerKp = generateEd25519KeyPair();
    const aliceKey = new SovraDeviceKey('alice-1', 'Alice', 'did:key:z6MkAlice', devKp.privateKey, Math.floor(Date.now() / 1000) + 3600);
    const attackerKey = new SovraDeviceKey('evil-1', 'Evil', 'did:key:z6MkEvil', attackerKp.privateKey, Math.floor(Date.now() / 1000) + 3600);
    const alicePeerId = derivePeerId(aliceKey.publicKeyBytes);
    const attackerPeerId = derivePeerId(attackerKey.publicKeyBytes);
    const serverPeerId = derivePeerId(generateEd25519KeyPair().publicKey);

    const dht = new KademliaDHT(serverPeerId, undefined, undefined, { requireSignedRecords: true });
    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Unsigned PUT_VALUE rejected when requireSignedRecords=true
    const unsignedPut = dht.handleRpcMessage(
      {
        type: 'PUT_VALUE',
        senderPeerId: alicePeerId,
        targetKey: 'alice:key',
        record: {
          key: 'alice:key',
          value: new Uint8Array([1, 2, 3]),
          authorPeerId: alicePeerId,
          sequenceNumber: 1n,
          timestamp: nowSec,
        },
      },
      alicePeerId,
    );
    expect(unsignedPut.success).toBe(false);

    // 2. Signed PUT_VALUE with wrong signer key (attacker key claiming alicePeerId) rejected
    const forgedRecBase = {
      key: 'alice:key',
      value: new Uint8Array([1, 2, 3]),
      authorPeerId: alicePeerId,
      sequenceNumber: 1n,
      timestamp: nowSec,
    };
    const forgedSig = bytesToHex(attackerKey.sign(buildDhtRecordSignableBytes(forgedRecBase)));
    expect(
      dht.handleRpcMessage(
        {
          type: 'PUT_VALUE',
          senderPeerId: alicePeerId,
          targetKey: 'alice:key',
          record: { ...forgedRecBase, signature: forgedSig },
        },
        alicePeerId,
      ).success,
    ).toBe(false);

    // 3. Valid Ed25519 signed record (even replicated transitively via attackerPeerId!) succeeds
    const validSig1 = bytesToHex(aliceKey.sign(buildDhtRecordSignableBytes(forgedRecBase)));
    expect(
      dht.handleRpcMessage(
        {
          type: 'PUT_VALUE',
          senderPeerId: attackerPeerId,
          targetKey: 'alice:key',
          record: { ...forgedRecBase, signature: validSig1 },
        },
        attackerPeerId,
      ).success,
    ).toBe(true);

    // 4. Equal-sequence equivocation / timestamp replay rejected
    const equivBase = {
      key: 'alice:key',
      value: new Uint8Array([9, 9, 9]),
      authorPeerId: alicePeerId,
      sequenceNumber: 1n,
      timestamp: nowSec,
    };
    const equivSig = bytesToHex(aliceKey.sign(buildDhtRecordSignableBytes(equivBase)));
    expect(
      dht.handleRpcMessage(
        {
          type: 'PUT_VALUE',
          senderPeerId: alicePeerId,
          targetKey: 'alice:key',
          record: { ...equivBase, signature: equivSig },
        },
        alicePeerId,
      ).success,
    ).toBe(false);

    // 5. Expired DHT record rejected cleanly and expired FIND_VALUE purged
    const expBase = {
      key: 'expired:key',
      value: new Uint8Array([4, 5]),
      authorPeerId: alicePeerId,
      sequenceNumber: 2n,
      timestamp: nowSec - 10,
      expiresAt: nowSec - 1,
    };
    expect(
      dht.handleRpcMessage(
        {
          type: 'PUT_VALUE',
          senderPeerId: alicePeerId,
          targetKey: 'expired:key',
          record: { ...expBase, signature: bytesToHex(aliceKey.sign(buildDhtRecordSignableBytes(expBase))) },
        },
        alicePeerId,
      ).success,
    ).toBe(false);

    // 6. Provider ownership check: ADD_PROVIDER claiming another peer's /p2p/<victim> multiaddr rejected
    const badProvBase = {
      peerId: alicePeerId,
      addresses: [`/ip4/198.51.100.12/tcp/4001/p2p/${attackerPeerId}`],
      registeredAt: nowSec,
      expiresAt: nowSec + 3600,
    };
    expect(
      dht.handleRpcMessage(
        {
          type: 'ADD_PROVIDER',
          senderPeerId: alicePeerId,
          targetKey: 'cid-owner-check',
          provider: {
            ...badProvBase,
            signature: bytesToHex(aliceKey.sign(buildProviderRecordSignableBytes('cid-owner-check', badProvBase))),
          },
        },
        alicePeerId,
      ).success,
    ).toBe(false);
  });

  it('penalizes and isolates live Noise_XX peers attempting DHT forgery, PEX spoofing, unallocated relay forwarding, or DCUtR third-party redirect', async () => {
    const server = await startBoundNode();
    const honestClient = await startBoundNode();
    const evilClient = await startBoundNode();
    cleanups.push(() => Promise.all([server.node.stop(), honestClient.node.stop(), evilClient.node.stop()]));

    const srvAddr = `${server.node.boundAddresses[0]}/p2p/${server.peerId}`;
    const d1 = await honestClient.node.dial(srvAddr);
    const d2 = await evilClient.node.dial(srvAddr);
    expect(d1.ok).toBe(true);
    expect(d2.ok).toBe(true);

    // 1. Honest client signs DHT PUT_VALUE via SovraP2PNode signer -> succeeds over wire!
    await honestClient.node.dht.putValue('honest:key', new TextEncoder().encode('verified-payload'));
    const honestRec = (await honestClient.node.dht.getValue('honest:key')).value!;
    expect(honestRec.signature).toMatch(/^[0-9a-f]{128}$/);

    const dhtRes = await honestClient.node.reqResp.sendRequest(
      server.peerId,
      '/sovra/dht/1.0.0',
      new TextEncoder().encode(
        JSON.stringify({
          type: 'PUT_VALUE',
          senderPeerId: honestClient.peerId,
          targetKey: 'honest:key',
          record: { ...honestRec, sequenceNumber: honestRec.sequenceNumber.toString() },
        }),
      ),
    );
    expect(dhtRes.ok).toBe(true);
    if (dhtRes.ok) {
      expect(JSON.parse(new TextDecoder().decode(dhtRes.value)).success).toBe(true);
    }

    // 2. Evil client sends unsigned/forged DHT PUT_VALUE -> rejected + evilClient blacklisted (-50 score)
    const forgeRes = await evilClient.node.reqResp.sendRequest(
      server.peerId,
      '/sovra/dht/1.0.0',
      new TextEncoder().encode(
        JSON.stringify({
          type: 'PUT_VALUE',
          senderPeerId: evilClient.peerId,
          targetKey: 'forged:key',
          record: {
            key: 'forged:key',
            value: Array.from(new TextEncoder().encode('evil')),
            authorPeerId: honestClient.peerId,
            sequenceNumber: '99',
            timestamp: Math.floor(Date.now() / 1000),
          },
        }),
      ),
      { timeoutMs: 1500, retries: 0 },
    );
    expect(forgeRes.ok).toBe(true);
    if (forgeRes.ok) {
      expect(JSON.parse(new TextDecoder().decode(forgeRes.value)).success).toBe(false);
    }
    expect(server.node.scoring.isBlacklisted(evilClient.peerId)).toBe(true);

    // 3. Honest client attempts unauthorized CIRCUIT_RELAY_FORWARD_PROTOCOL on non-existent circuitId & blacklisted target -> rejected
    const victim = await startBoundNode();
    cleanups.push(() => victim.node.stop());

    const blacklistedTargetFwd = await honestClient.node.reqResp.sendRequest(
      server.peerId,
      CIRCUIT_RELAY_FORWARD_PROTOCOL,
      new TextEncoder().encode(
        JSON.stringify({
          circuitId: 'circuit-forged-unauthorized',
          fromPeerId: honestClient.peerId,
          toPeerId: evilClient.peerId,
          channel: 'reqresp',
          payloadBase64: Buffer.from('hello').toString('base64'),
        }),
      ),
    );
    expect(blacklistedTargetFwd.ok).toBe(true);
    if (blacklistedTargetFwd.ok) {
      const parsed = JSON.parse(new TextDecoder().decode(blacklistedTargetFwd.value));
      expect(parsed.ok).toBe(false);
      expect(String(parsed.error)).toMatch(/blacklisted|Unauthorized|unknown circuitId/i);
    }

    const fakeFwdRes = await honestClient.node.reqResp.sendRequest(
      server.peerId,
      CIRCUIT_RELAY_FORWARD_PROTOCOL,
      new TextEncoder().encode(
        JSON.stringify({
          circuitId: 'circuit-forged-unauthorized',
          fromPeerId: honestClient.peerId,
          toPeerId: victim.peerId,
          channel: 'reqresp',
          payloadBase64: Buffer.from('hello').toString('base64'),
        }),
      ),
    );
    expect(fakeFwdRes.ok).toBe(true);
    if (fakeFwdRes.ok) {
      const parsed = JSON.parse(new TextDecoder().decode(fakeFwdRes.value));
      expect(parsed.ok).toBe(false);
      expect(String(parsed.error)).toMatch(/Unauthorized|unknown circuitId/i);
    }

    // 4. Malicious DCUtR CONNECT naming a third-party victim PeerID does NOT initiate dial to victim
    const dcutrRes = await honestClient.node.reqResp.sendRequest(
      server.peerId,
      DCUTR_PROTOCOL,
      new TextEncoder().encode(
        JSON.stringify({
          type: 'CONNECT',
          addrs: [`${victim.node.boundAddresses[0]}/p2p/${victim.peerId}`],
        }),
      ),
    );
    expect(dcutrRes.ok).toBe(true);
    await new Promise(r => setTimeout(r, 150));
    expect(victim.node.connManager.getConnection(server.peerId)).toBeUndefined();

    // 5. PEX announcement with tampered signature triggers sender penalty on fresh connection
    const pexBadPeer = await startBoundNode();
    cleanups.push(() => pexBadPeer.node.stop());
    await pexBadPeer.node.dial(srvAddr);
    const tamperedSelf = pexBadPeer.node.getSignedPeerRecord(300)!;
    const forgedPex = { ...tamperedSelf, signatureHex: '00'.repeat(64) };
    const pexFailRes = await pexBadPeer.node.reqResp.sendRequest(
      server.peerId,
      SOVRA_PEX_PROTOCOL,
      new TextEncoder().encode(JSON.stringify({ announce: [forgedPex] })),
      { timeoutMs: 1500, retries: 0 },
    );
    expect(pexFailRes.ok).toBe(true);
    if (pexFailRes.ok) {
      expect(JSON.parse(new TextDecoder().decode(pexFailRes.value)).ok).toBe(false);
    }
    expect(server.node.scoring.isBlacklisted(pexBadPeer.peerId)).toBe(true);
  }, 15000);
});
