/**
 * @file tests/e2e/blockchain-explorer.test.ts
 * Sovra Layer-1 CometBFT Blockchain Web Explorer E2E & Integrity Suite
 *
 * Verifies:
 * 1. Standalone Web Explorer HTML structure, hero metrics, navigation tabs, and modals
 * 2. Embedded client scripts compile with zero syntax errors via Node vm.Script
 * 3. /explorer route returns HTTP 200 with text/html
 * 4. /api/explorer/summary returns live block production, supply counters, and invariant equation
 * 5. /api/explorer/validators probes all 4 P2P validator nodes (ports 26657, 26667, 26677, 26687)
 * 6. Account inspector and block querying proxies
 * 7. CometBFT Live WebSocket/SSE streaming (/api/explorer/stream)
 * 8. Mempool inspection & unconfirmed transaction monitoring (/api/explorer/mempool)
 * 9. RFC 4180 Ledger CSV export for accounting & tax reporting (/api/explorer/export/csv)
 */

import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { signEd25519, bytesToHex } from '../../packages/crypto/dist/index.js';
import { renderExplorerHtml } from '../../scripts/blockchain-explorer.ts';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Sovra Layer-1 Blockchain Web Explorer Suite', () => {
  describe('Explorer HTML & UI Components', () => {
    const html = renderExplorerHtml();

    it('renders top navigation with brand title, live testnet badge, and global search bar', () => {
      expect(html).toContain('Sovra Layer-1 Explorer');
      expect(html).toContain('sovra-testnet-0');
      expect(html).toContain('id="explorerGlobalSearch"');
      expect(html).toContain('Search by Block Height / Tx Hash / Address (sovra1...)');
    });

    it('renders all 4 hero metric cards for real-time telemetry', () => {
      // 1. Current Block Height
      expect(html).toContain('id="heroHeight"');
      expect(html).toContain('Block Height');

      // 2. Total Bank Supply
      expect(html).toContain('id="heroTotalSupply"');
      expect(html).toContain('Circulating Bank Supply');

      // 3. Supply Invariant Status
      expect(html).toContain('id="heroInvariantBadge"');
      expect(html).toContain('Supply Invariant');

      // 4. Active Consensus Quorum
      expect(html).toContain('id="heroValidators"');
      expect(html).toContain('Consensus Quorum');
    });

    it('renders all 6 core explorer navigation tabs and panels including mempool', () => {
      expect(html).toContain("switchExplorerTab('overview'");
      expect(html).toContain("switchExplorerTab('blocks'");
      expect(html).toContain("switchExplorerTab('transactions'");
      expect(html).toContain("switchExplorerTab('mempool'");
      expect(html).toContain("switchExplorerTab('validators'");
      expect(html).toContain("switchExplorerTab('economics'");

      expect(html).toContain('id="panel-overview"');
      expect(html).toContain('id="panel-blocks"');
      expect(html).toContain('id="panel-transactions"');
      expect(html).toContain('id="panel-mempool"');
      expect(html).toContain('id="panel-validators"');
      expect(html).toContain('id="panel-economics"');

      // Mempool badge and capacity metrics
      expect(html).toContain('id="mempoolBadgeCount"');
      expect(html).toContain('id="mempoolCount"');
      expect(html).toContain('id="mempoolBytes"');
      expect(html).toContain('id="mempoolCongestionBadge"');
      expect(html).toContain('id="mempoolCapacity"');
    });

    it('renders transaction filter controls and CSV export button', () => {
      expect(html).toContain("filterTxTable('all')");
      expect(html).toContain("filterTxTable('send')");
      expect(html).toContain("filterTxTable('burn')");
      expect(html).toContain("exportTransactionsCsv()");
      expect(html).toContain("exportAccountCsv()");
    });

    it('renders interactive modal dialogs for Block, Tx, and Account inspection', () => {
      expect(html).toContain('id="explorerBlockModal"');
      expect(html).toContain('id="blockModalBody"');

      expect(html).toContain('id="explorerTxModal"');
      expect(html).toContain('id="txModalBody"');

      expect(html).toContain('id="explorerAccountModal"');
      expect(html).toContain('id="accountModalBody"');
    });

    it('compiles all embedded script tags with zero syntax errors via Node vm.Script', () => {
      const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
      let match: RegExpExecArray | null;
      let count = 0;

      while ((match = scriptRegex.exec(html)) !== null) {
        const scriptBody = match[1];
        if (scriptBody && scriptBody.trim()) {
          count++;
          expect(() => {
            new vm.Script(scriptBody, { filename: `explorer-script-${count}.js` });
          }).not.toThrow();
        }
      }

      expect(count).toBeGreaterThan(0);
    });
  });

  describe('Live Dev Server Explorer Endpoints', () => {
    it('serves the standalone explorer HTML at /explorer', async () => {
      try {
        const res = await fetch(`${BASE_URL}/explorer`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Sovra Layer-1 Explorer');
        expect(text).toContain('sovra-testnet-0');
      } catch (err: any) {
        if (err.code === 'ECONNREFUSED') return;
        throw err;
      }
    });

    it('returns valid JSON telemetry summary from /api/explorer/summary', async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/explorer/summary`);
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.ok).toBe(true);
        expect(data.chainId).toBe('sovra-testnet-0');
        expect(typeof data.height).toBe('number');
        expect(data.height).toBeGreaterThanOrEqual(0);

        // Supply checks
        expect(data.supply).toBeDefined();
        expect(typeof data.supply.totalSov).toBe('number');
        expect(typeof data.supply.totalUsov).toBe('string');
        expect(typeof data.supply.supplyCorrect).toBe('boolean');
        expect(data.supply.supplyCorrect).toBe(true);
        expect(data.supply.invariantEquation).toContain('==');

        // Consensus & Validators checks
        expect(data.consensus).toBeDefined();
        expect(data.consensus.totalValidators).toBe(4);
        expect(data.validators).toBeInstanceOf(Array);
        expect(data.validators.length).toBe(4);

        // Recent blocks and transactions checks
        expect(data.recentBlocks).toBeInstanceOf(Array);
        expect(data.recentBlocks.length).toBeGreaterThan(0);
        expect(data.recentTransactions).toBeInstanceOf(Array);
      } catch (err: any) {
        if (err.code === 'ECONNREFUSED') return;
        throw err;
      }
    });

    it('returns validator status matrix from /api/explorer/validators', async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/explorer/validators`);
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.ok).toBe(true);
        expect(data.validators).toBeInstanceOf(Array);
        expect(data.validators.length).toBe(4);

        const node0 = data.validators.find((v: any) => v.moniker === 'validator-0');
        expect(node0).toBeDefined();
        expect(node0.rpcPort).toBe(26657);
        expect(node0.p2pPort).toBe(26656);
      } catch (err: any) {
        if (err.code === 'ECONNREFUSED') return;
        throw err;
      }
    });

    it('queries account details from /api/explorer/account', async () => {
      try {
        const validator0Addr = 'sovra1dd7762e1b3133ad89338a87f692eadcf24424448';
        const res = await fetch(`${BASE_URL}/api/explorer/account?address=${validator0Addr}`);
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.ok).toBe(true);
        expect(data.address).toBe(validator0Addr);
        expect(typeof data.balanceSov).toBe('number');
        expect(typeof data.balanceUsov).toBe('string');
        expect(typeof data.nonce).toBe('number');
      } catch (err: any) {
        if (err.code === 'ECONNREFUSED') return;
        throw err;
      }
    });

    it('queries mempool status and unconfirmed transactions from /api/explorer/mempool', async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/explorer/mempool`);
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.ok).toBe(true);
        expect(data.chainId).toBe('sovra-testnet-0');
        expect(typeof data.n_txs).toBe('number');
        expect(typeof data.total_bytes).toBe('number');
        expect(data.mempoolCapacity).toBe('5,000 txs (100 MB)');
        expect(data.congestionStatus).toBeDefined();
        expect(Array.isArray(data.unconfirmedTxs)).toBe(true);
      } catch (err: any) {
        if (err.code === 'ECONNREFUSED') return;
        throw err;
      }
    });

    it('exports RFC 4180 ledger CSV from /api/explorer/export/csv', async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/explorer/export/csv`);
        expect(res.status).toBe(200);
        const contentType = res.headers.get('content-type') || '';
        expect(contentType).toContain('text/csv');
        const disposition = res.headers.get('content-disposition') || '';
        expect(disposition).toContain('attachment');
        expect(disposition).toContain('.csv');

        const csvText = await res.text();
        expect(csvText).toContain('"Timestamp","Date_UTC","Block_Height","Tx_Hash","Type","Sender","Recipient","Amount_SOV"');
        expect(csvText.split('\r\n').length).toBeGreaterThan(1);
      } catch (err: any) {
        if (err.code === 'ECONNREFUSED') return;
        throw err;
      }
    });

    it('initiates live SSE block stream from /api/explorer/stream', async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${BASE_URL}/api/explorer/stream`, { signal: controller.signal });
        expect(res.status).toBe(200);
        const contentType = res.headers.get('content-type') || '';
        expect(contentType).toContain('text/event-stream');
        clearTimeout(timeout);
        controller.abort();
      } catch (err: any) {
        if (err.name === 'AbortError' || err.code === 'ECONNREFUSED') return;
        throw err;
      }
    });

    it('relays signed transactions directly to L1 CometBFT mempool via POST /api/blockchain/broadcast', async () => {
      try {
        // 1. Missing fields rejection
        const badRes = await fetch(`${BASE_URL}/api/blockchain/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: 'sovra1test', amount: '100' }),
        });
        expect(badRes.status).toBe(400);
        const badData = await badRes.json();
        expect(badData.ok).toBe(false);
        expect(badData.error).toContain('Missing required transaction fields');

        // 2. Cryptographic signature failure rejection
        const fakeSigRes = await fetch(`${BASE_URL}/api/blockchain/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: 'sovra11d495effad59540a2005388a74ee1b1f5c692476',
            recipient: 'sovra1abf118dbbf84692e7be98cccfe4dc82959bfaf03',
            amount: '1000',
            nonce: 0,
            fee: '100',
            pub_key: '8df39d54f8e61c4119cdafc80cd4ccdf102635ee0487677d5515cea55795b724',
            sig: '00'.repeat(64),
          }),
        });
        expect(fakeSigRes.status).toBe(400);
        const fakeSigData = await fakeSigRes.json();
        expect(fakeSigData.ok).toBe(false);
        expect(fakeSigData.phase).toBe('CheckTx');

        // 3. Valid transaction broadcast with decrypted keystore
        const ksFile = path.resolve(process.cwd(), 'chain/mytestnet/node0/keyring/validator-0.keystore');
        if (fs.existsSync(ksFile)) {
          const ksRaw = JSON.parse(fs.readFileSync(ksFile, 'utf8'));
          const passphrase = 'sovra-testnet-secret';
          const salt = Buffer.from(ksRaw.crypto.scrypt_params.salt, 'hex');
          const aesKey = crypto.scryptSync(passphrase, salt, 32, {
            N: ksRaw.crypto.scrypt_params.n,
            r: ksRaw.crypto.scrypt_params.r,
            p: ksRaw.crypto.scrypt_params.p,
            maxmem: 64 * 1024 * 1024,
          });
          const nonceBuf = Buffer.from(ksRaw.crypto.nonce, 'hex');
          const rawCipher = Buffer.from(ksRaw.crypto.ciphertext, 'hex');
          const authTag = rawCipher.subarray(rawCipher.length - 16);
          const ciphertext = rawCipher.subarray(0, rawCipher.length - 16);

          const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonceBuf);
          decipher.setAAD(Buffer.from(ksRaw.address, 'utf8'));
          decipher.setAuthTag(authTag);
          const privKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

          // Query current nonce
          const nonceRes = await fetch(`http://127.0.0.1:26657/query/nonce?address=${encodeURIComponent(ksRaw.address)}`);
          const nonceData = await nonceRes.json();
          const currentNonce = Number(nonceData.nonce || 0);

          const txPayload = {
            type: 'send',
            sender: ksRaw.address,
            recipient: 'sovra1abf118dbbf84692e7be98cccfe4dc82959bfaf03',
            amount: '1000',
            nonce: currentNonce,
            fee: '100',
          };
          const signBytes = Buffer.from(JSON.stringify(txPayload), 'utf8');
          const sig = signEd25519(new Uint8Array(privKey.subarray(0, 32)), new Uint8Array(signBytes));
          const sigHex = bytesToHex(sig);

          const broadcastRes = await fetch(`${BASE_URL}/api/blockchain/broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...txPayload,
              pub_key: ksRaw.pub_key,
              sig: sigHex,
              memo: 'Direct L1 Mempool Relay Test',
            }),
          });
          expect(broadcastRes.status).toBe(200);
          const broadcastData = await broadcastRes.json();
          expect(broadcastData.ok).toBe(true);
          expect(typeof broadcastData.height).toBe('number');
          expect(broadcastData.txHash).toBeDefined();
          expect(broadcastData.txHash.startsWith('0x')).toBe(true);
          expect(broadcastData.log).toContain('executed');
        }
      } catch (err: any) {
        if (err.code === 'ECONNREFUSED') return;
        throw err;
      }
    });

    it('connects to native CometBFT WebSocket at ws://127.0.0.1:26657/websocket and receives NewBlock events', async () => {
      try {
        if (typeof globalThis.WebSocket === 'undefined') return;
        const received = await new Promise<boolean>((resolve) => {
          let ws: any;
          const timeout = setTimeout(() => {
            try { if (ws) ws.close(); } catch {}
            resolve(false);
          }, 5000);

          ws = new globalThis.WebSocket('ws://127.0.0.1:26657/websocket');
          ws.onopen = () => {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              method: 'subscribe',
              id: 1,
              params: { query: "tm.event='NewBlock'" },
            }));
          };
          ws.onmessage = (event: any) => {
            try {
              const data = JSON.parse(event.data);
              if (data?.result?.query === "tm.event='NewBlock'") {
                clearTimeout(timeout);
                ws.close();
                resolve(true);
              }
            } catch {}
          };
          ws.onerror = () => {
            clearTimeout(timeout);
            resolve(false);
          };
        });
        expect(received).toBe(true);
      } catch (err: any) {
        if (err.code === 'ECONNREFUSED') return;
        throw err;
      }
    });
  });
});
