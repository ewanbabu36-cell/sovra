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
  });
});
