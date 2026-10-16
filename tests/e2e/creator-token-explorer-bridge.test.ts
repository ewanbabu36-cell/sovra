/**
 * @file tests/e2e/creator-token-explorer-bridge.test.ts
 * CosmWasm CW20 Creator Tokens & Blockchain Explorer Bridge Integration Suite
 *
 * Verifies:
 * 1. Creator Studio token launch endpoint (POST /api/studio/token/launch)
 * 2. Creator Studio dashboard token reflection (GET /api/studio/dashboard)
 * 3. Explorer WASM token gateway (GET /api/blockchain/wasm/tokens and /contracts)
 * 4. Smart contract queries (POST /api/blockchain/wasm/query) for token_info and balance
 * 5. Direct CosmWasm execute transaction broadcast (POST /api/blockchain/broadcast)
 * 6. Explorer summary transaction ledger decoding for CW20 actions
 * 7. Standalone Explorer HTML structure, CW20 tokens panel, and vm.Script integrity
 */

import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { signEd25519, bytesToHex } from '../../packages/crypto/dist/index.js';
import { renderExplorerHtml } from '../../scripts/blockchain-explorer.ts';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';
const L1_RPC = process.env.SOVRA_L1_RPC || 'http://127.0.0.1:26657';

describe('CosmWasm CW20 Creator Tokens & Explorer Bridge Suite', () => {
  let deployedContractAddress = '';
  let tokenSymbol = 'NOVA';
  let tokenName = 'Nova Sovereign Token';
  let initialSupply = 5_000_000;
  let creatorAddress = 'sovra12a806ca82d506a025d580d40600abc77a69e10e7';
  let recipientAddress = 'sovra1abf118dbbf84692e7be98cccfe4dc82959bfaf03';

  describe('Explorer HTML & UI Component Integrity', () => {
    const html = renderExplorerHtml();

    it('renders Creator Tokens tab button in tab bar', () => {
      expect(html).toContain('id="tabBtnTokens"');
      expect(html).toContain('Creator Tokens (CW20)');
      expect(html).toContain('id="tokensCountBadge"');
    });

    it('renders tokens panel with table columns and contract modal', () => {
      expect(html).toContain('id="panel-tokens"');
      expect(html).toContain('id="tokensTableBody"');
      expect(html).toContain('<th>Symbol</th>');
      expect(html).toContain('<th>Token Name</th>');
      expect(html).toContain('<th>Contract Address</th>');
      expect(html).toContain('id="explorerContractModal"');
      expect(html).toContain('id="contractModalBody"');
    });

    it('compiles embedded explorer script with zero syntax errors via vm.Script', () => {
      const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
      let match: RegExpExecArray | null;
      let count = 0;

      while ((match = scriptRegex.exec(html)) !== null) {
        const scriptBody = match[1];
        if (scriptBody && scriptBody.trim()) {
          count++;
          expect(() => {
            new vm.Script(scriptBody, { filename: `explorer-tokens-script-${count}.js` });
          }).not.toThrow();
        }
      }
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('Creator Studio Token Launchpad Integration', () => {
    it('deploys and instantiates a new CW20 creator token via POST /api/studio/token/launch', async () => {
      const payload = {
        name: tokenName,
        symbol: tokenSymbol,
        initialSupply,
        decimals: 6,
        creator: creatorAddress,
      };

      const res = await fetch(`${BASE_URL}/api/studio/token/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.contractAddress).toBeDefined();
      expect(data.contractAddress.startsWith('sovra1wasm')).toBe(true);
      expect(data.token).toBeDefined();
      expect(data.token.symbol).toBe('NOVA');
      expect(data.token.name).toBe('Nova Sovereign Token');
      expect(Number(data.token.totalSupply)).toBe(initialSupply);

      deployedContractAddress = data.contractAddress;
    });

    it('reflects the newly launched creator token on the Studio Dashboard (GET /api/studio/dashboard)', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/dashboard?creatorAddress=${encodeURIComponent(creatorAddress)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.creatorToken).toBeDefined();
      expect(data.creatorToken.symbol).toBe('NOVA');
      expect(data.creatorToken.contractAddress).toBe(deployedContractAddress);
      expect(Number(data.creatorToken.totalSupply)).toBe(initialSupply);
    });
  });

  describe('Explorer Blockchain WASM Gateways & Query Proxy', () => {
    it('lists deployed smart contracts via GET /api/blockchain/wasm/contracts', async () => {
      const res = await fetch(`${BASE_URL}/api/blockchain/wasm/contracts`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.contracts)).toBe(true);
      expect(data.contracts.length).toBeGreaterThan(0);

      const contract = data.contracts.find((c: any) => c.address === deployedContractAddress);
      expect(contract).toBeDefined();
      expect(contract.creator).toBe(creatorAddress);
    });

    it('lists active CW20 creator tokens via GET /api/blockchain/wasm/tokens', async () => {
      const res = await fetch(`${BASE_URL}/api/blockchain/wasm/tokens`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.tokens)).toBe(true);

      const token = data.tokens.find((t: any) => t.contractAddress === deployedContractAddress || t.symbol === 'NOVA');
      expect(token).toBeDefined();
      expect(token.symbol).toBe('NOVA');
      expect(token.name).toBe('Nova Sovereign Token');
      expect(token.decimals).toBe(6);
      expect(Number(token.totalSupply || token.total_supply)).toBe(initialSupply);
    });

    it('executes smart contract query token_info via POST /api/blockchain/wasm/query', async () => {
      const res = await fetch(`${BASE_URL}/api/blockchain/wasm/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: deployedContractAddress,
          query: { token_info: {} },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      const info = data.data || data;
      expect(info.name).toBe('Nova Sovereign Token');
      expect(info.symbol).toBe('NOVA');
      expect(info.decimals).toBe(6);
      expect(Number(info.total_supply || info.totalSupply)).toBe(initialSupply);
    });

    it('executes smart contract query balance via POST /api/blockchain/wasm/query', async () => {
      const res = await fetch(`${BASE_URL}/api/blockchain/wasm/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: deployedContractAddress,
          query: { balance: { address: creatorAddress } },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      const balanceObj = data.data || data;
      expect(Number(balanceObj.balance)).toBe(initialSupply);
    });
  });

  describe('CosmWasm Execute & Transaction Ledger Bridge', () => {
    it('relays signed CW20 execute transfer transaction via POST /api/blockchain/broadcast', async () => {
      const ksFile = path.resolve(process.cwd(), 'chain/mytestnet/node0/keyring/validator-0.keystore');
      if (!fs.existsSync(ksFile)) return;

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
      const nonceRes = await fetch(`${L1_RPC}/query/nonce?address=${encodeURIComponent(creatorAddress)}`);
      const nonceData = await nonceRes.json();
      const currentNonce = Number(nonceData.nonce || 0);

      const executeMsg = JSON.stringify({
        transfer: {
          recipient: recipientAddress,
          amount: '5000',
        },
      });

      const txPayload = {
        type: 'execute',
        sender: creatorAddress,
        nonce: currentNonce,
        fee: '100',
        contract: deployedContractAddress,
        msg: executeMsg,
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
          memo: 'CW20 Token Transfer Test',
        }),
      });

      if (broadcastRes.status !== 200) {
        console.error('CW20 BROADCAST ERR:', await broadcastRes.text());
      }
      expect(broadcastRes.status).toBe(200);
      const broadcastData = await broadcastRes.json();
      expect(broadcastData.ok).toBe(true);
      expect(broadcastData.txHash).toBeDefined();
    });

    it('reflects CosmWasm CW20 transactions in explorer summary (GET /api/explorer/summary)', async () => {
      const res = await fetch(`${BASE_URL}/api/explorer/summary`);
      expect(res.status).toBe(200);
      const summary = await res.json();
      expect(summary.ok).toBe(true);
      expect(Array.isArray(summary.recentTransactions)).toBe(true);

      const cw20Tx = summary.recentTransactions.find(
        (t: any) =>
          t.type === 'cw20_transfer' ||
          t.type === 'wasm_instantiate' ||
          t.type === 'wasm_execute' ||
          t.contractAddress === deployedContractAddress
      );
      expect(cw20Tx).toBeDefined();
    });
  });
});
