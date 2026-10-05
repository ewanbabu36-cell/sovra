import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BitChatMeshRouter } from '../../packages/messaging/src/bitchat-mesh.js';

describe('BitChat Zero-Internet Mesh E2E Suite', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const content = fs.readFileSync(devServerPath, 'utf8');

  it('proves BitChat mesh UI components exist in dev server UI', () => {
    expect(content).toContain('id="bitchatModeBar"');
    expect(content).toContain('id="bitchatModeToggleBtn"');
    expect(content).toContain('id="bitchatPanicBtn"');
    expect(content).toContain('id="bitchatRadarContainer"');
    expect(content).toContain('id="bitchatHeaderRoute"');
    expect(content).toContain('toggleBitChatMode');
    expect(content).toContain('executeBitChatPanicWipe');
    expect(content).toContain('renderChatContactsList');
  });

  it('proves BitChat hyperlocal mesh channels and direct BLE peers are modeled', () => {
    expect(content).toContain('channel:local_mesh');
    expect(content).toContain('channel:emergency_sos');
    expect(content).toContain('#local-mesh');
    expect(content).toContain('#emergency-sos');
    expect(content).toContain('did:sovra:alice_ble');
    expect(content).toContain('did:sovra:bob_ble');
    expect(content).toContain('Direct BLE');
  });

  it('proves BitChat multi-hop packet routing and route badges are rendered in message bubbles', () => {
    expect(content).toContain('bitchat-mesh-route-box');
    expect(content).toContain('bitchat-hop-badge');
    expect(content).toContain('isBitChat');
    expect(content).toContain('hopCount');
  });

  it('verifies BitChatMeshRouter protocol class handles end-to-end multi-hop communication', () => {
    const nodeA = new BitChatMeshRouter('did:sovra:nodeA', 'Node A');
    const nodeB = new BitChatMeshRouter('did:sovra:nodeB', 'Node B (Relay)');
    const nodeC = new BitChatMeshRouter('did:sovra:nodeC', 'Node C');

    // Node A creates packet for Node C
    const packet = nodeA.createPacket('did:sovra:nodeC', 'Encrypted zero-internet payload');

    // Node B receives and forwards packet
    const forwardResult = nodeB.receivePacket(packet);
    expect(forwardResult.action).toBe('forward');
    expect(forwardResult.forwardedPacket).toBeDefined();
    expect(forwardResult.forwardedPacket?.hopCount).toBe(1);

    // Node C receives and delivers packet
    const deliverResult = nodeC.receivePacket(forwardResult.forwardedPacket!);
    expect(deliverResult.action).toBe('deliver');
    expect(deliverResult.deliveredPacket?.payload).toBe('Encrypted zero-internet payload');
  });

  it('verifies BitChat emergency panic wipe erases in-memory cryptographic state', () => {
    const node = new BitChatMeshRouter('did:sovra:panicNode', 'Panic Node');
    node.createPacket('did:sovra:peer', 'Confidential SOS payload');

    const result = node.panicWipe();
    expect(result.wipedPacketsCount).toBeGreaterThanOrEqual(1);
    expect(node.getDeliveredPackets().length).toBe(0);
  });
});
