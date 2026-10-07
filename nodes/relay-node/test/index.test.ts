import { describe, it, expect } from 'vitest';
import { RelayDaemon, RelayNodeConfig } from '../src/index.js';

describe('@sovra/relay-node', () => {
  it('instantiates Circuit Relay v2 daemon config', async () => {
    const config: RelayNodeConfig = {
      listenPort: 4002,
      maxReservations: 128,
      maxCircuits: 256,
      bufferDurationSeconds: 120,
    };
    const daemon = new RelayDaemon(config);
    expect(daemon.getConfig().maxReservations).toBe(128);

    const res = await daemon.start();
    expect(res.ok).toBe(true);
    expect(daemon.isRunning).toBe(true);

    // Test circuit creation
    const reserveRes = daemon.createCircuit('peer_alice', 'peer_bob', 60, 1024 * 1024);
    expect(reserveRes.ok).toBe(true);
    if (!reserveRes.ok) return;

    const circuitId = reserveRes.value.circuitId;
    expect(daemon.getMetrics().activeCircuits).toBe(1);

    // Test relaying data chunk
    const relayRes = daemon.relayChunk(circuitId, 128);
    expect(relayRes.ok).toBe(true);
    if (relayRes.ok) {
      expect(relayRes.value.bytesRelayed).toBe(128);
    }

    // Test closing circuit
    const closeRes = daemon.closeCircuit(circuitId);
    expect(closeRes.ok).toBe(true);
    expect(daemon.getMetrics().activeCircuits).toBe(0);

    await daemon.stop();
    expect(daemon.isRunning).toBe(false);
  });
});
