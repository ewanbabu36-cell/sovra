/**
 * @file tests/e2e/l1-consensus-supervisor.test.ts
 * Tests the Sovra Layer-1 Consensus Node Supervisor (Path A & Path B)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { L1ChainSupervisor } from '../../scripts/chain-supervisor.ts';
import { signEd25519, bytesToHex, hexToBytes } from '../../packages/crypto/dist/index.js';
import crypto from 'node:crypto';

describe('Sovra Layer-1 Consensus Supervisor & Engine Suite', () => {
  const supervisor = new L1ChainSupervisor({ rpcPort: 26697, p2pPort: 26696 });

  afterAll(async () => {
    await supervisor.stop();
  });

  it('initializes In-Process CometBFT PBFT Consensus Engine on port 26697', async () => {
    // Force in-process mode by disabling native binary resolution on this instance
    (supervisor as any).resolveSovradBinary = () => null;
    const started = await supervisor.start();
    expect(started).toBe(true);

    const status = supervisor.getStatus();
    expect(status.online).toBe(true);
    expect(status.mode).toBe('in-process-cometbft');
    expect(status.validatorsCount).toBe(4);
    expect(status.supplyUsov).toBe('30000000000000');
  });

  it('serves CometBFT /status endpoint with valid chain, height, and AppHash', async () => {
    const res = await fetch('http://127.0.0.1:26697/status');
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.chain_id).toBe('sovra-testnet-0');
    expect(data.moniker).toBe('validator-0');
    expect(typeof data.height).toBe('number');
    expect(data.height).toBeGreaterThanOrEqual(9662);
    expect(data.app_hash).toBeDefined();
    expect(data.supply_correct).toBe(true);
    expect(data.sync_info.catching_up).toBe(false);
  });

  it('serves CometBFT /query/supply with 30M SOV total supply and invariant equation', async () => {
    const res = await fetch('http://127.0.0.1:26697/query/supply');
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total_supply).toBe('30000000000000');
    expect(data.total_sov).toBe(30000000);
    expect(data.denom).toBe('usov');
    expect(data.supply_correct).toBe(true);
    expect(data.invariant_equation).toContain('==');
  });

  it('queries genesis account balance via /query/balance', async () => {
    const validator0Addr = 'sovra12a806ca82d506a025d580d40600abc77a69e10e7';
    const res = await fetch(`http://127.0.0.1:26697/query/balance?address=${validator0Addr}`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.address).toBe(validator0Addr);
    expect(data.balance).toBe('7500000000000');
    expect(data.denom).toBe('usov');
  });

  it('rejects forged / invalid signature transactions during CheckTx with HTTP 400', async () => {
    const res = await fetch('http://127.0.0.1:26697/broadcast_tx_commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: 'sovra12a806ca82d506a025d580d40600abc77a69e10e7',
        recipient: 'sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1',
        amount: '1000',
        nonce: 0,
        fee: '100',
        pub_key: '50dec499bc1281f64488a3ca9500c9c1a4eea67f5147af0450ee0deebf8601be',
        sig: '00'.repeat(64), // Invalid signature
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.phase).toBe('CheckTx');
    expect(data.error).toContain('Invalid transaction signature');
  });

  it('validates authentic signed transaction, executes DeliverTx, updates AppHash & state', async () => {
    // Generate fresh keypair for deterministic signature test
    const seed = crypto.randomBytes(32);
    // Give test account balance in supervisor
    const testAddr = 'sovra1testaccount00000000000000000000000';
    (supervisor as any).accounts.set(testAddr, 10000000n);

    // Derive ed25519 keypair
    const edKeyPair = crypto.generateKeyPairSync('ed25519');
    const rawPrivKey = edKeyPair.privateKey.export({ type: 'pkcs8', format: 'der' });
    // In PKCS#8 Ed25519 DER, the 32-byte seed is at offset 16..48
    const privSeed = rawPrivKey.subarray(16, 48);
    const rawPubKey = edKeyPair.publicKey.export({ type: 'spki', format: 'der' });
    const pubBytes = rawPubKey.subarray(rawPubKey.length - 32);

    const txPayload = {
      type: 'send',
      sender: testAddr,
      recipient: 'sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1',
      amount: '5000',
      nonce: 0,
      fee: '100',
    };

    const signBytes = Buffer.from(JSON.stringify(txPayload), 'utf8');
    const sig = signEd25519(new Uint8Array(privSeed), new Uint8Array(signBytes));

    const broadcastRes = await fetch('http://127.0.0.1:26697/broadcast_tx_commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...txPayload,
        pub_key: bytesToHex(pubBytes),
        sig: bytesToHex(sig),
      }),
    });

    expect(broadcastRes.status).toBe(200);
    const data = await broadcastRes.json();
    expect(data.ok).toBe(true);
    expect(data.hash.startsWith('0x')).toBe(true);
    expect(data.check_tx.code).toBe(0);
    expect(data.deliver_tx.code).toBe(0);

    // Verify balance was updated
    const balRes = await fetch(`http://127.0.0.1:26697/query/balance?address=${testAddr}`);
    const balData = await balRes.json();
    expect(balData.balance).toBe('9994900'); // 10000000 - 5000 - 100
  });

  it('subscribes to RFC 6455 WebSocket and receives real-time NewBlock events', async () => {
    const received = await new Promise<boolean>((resolve) => {
      let ws: any;
      const timer = setTimeout(() => {
        try { if (ws) ws.close(); } catch {}
        resolve(false);
      }, 5000);

      ws = new globalThis.WebSocket('ws://127.0.0.1:26697/websocket');
      ws.onopen = () => {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'subscribe',
          params: { query: "tm.event='NewBlock'" },
        }));
      };
      ws.onmessage = (event: any) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.result?.query === "tm.event='NewBlock'") {
            clearTimeout(timer);
            ws.close();
            resolve(true);
          }
        } catch {}
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });

    expect(received).toBe(true);
  });
});
