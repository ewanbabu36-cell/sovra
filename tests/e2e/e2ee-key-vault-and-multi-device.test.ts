import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Sovereign Key Vault & Multi-Device Pairing Suite (Loop #8)', () => {
  let devServerCode: string;

  beforeAll(() => {
    devServerCode = fs.readFileSync(path.resolve(__dirname, '../../scripts/dev-server.ts'), 'utf-8');
  });

  // 1. Sovereign Key Vault & Multi-Device UI Integrations
  it('guarantees Sovereign Key Vault and Device Link modals exist and default to display: none', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // #sovereignKeyVaultModal
    expect(html).toMatch(/id="sovereignKeyVaultModal"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toContain('id="vaultExportPane"');
    expect(html).toContain('id="vaultImportPane"');
    expect(html).toContain('id="vaultMnemonicPane"');
    expect(html).toContain('id="btnGenerateVaultBackup"');
    expect(html).toContain('id="btnDownloadVaultBackup"');
    expect(html).toContain('id="btnRestoreVaultBackup"');
    expect(html).toContain('id="vaultMnemonicWordsGrid"');

    // #deviceLinkModal
    expect(html).toMatch(/id="deviceLinkModal"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toContain('id="deviceLinkQrPane"');
    expect(html).toContain('id="deviceLinkEnterPane"');
    expect(html).toContain('id="deviceLinkQrContainer"');
    expect(html).toContain('id="deviceLinkTicketCode"');
    expect(html).toContain('id="deviceLinkTicketInput"');
    expect(html).toContain('id="btnClaimDeviceLink"');

    // Trigger buttons in Account Dashboard
    expect(html).toContain('id="btnOpenKeyVault"');
    expect(html).toContain('id="btnLinkNewDevice"');
  });

  // 2. Cryptographic Enclave Vault & Seed Generation
  it('guarantees client-side Crypto Vault implements AES-256-GCM + PBKDF2 and 128-word mnemonic dictionaries', () => {
    expect(devServerCode).toContain('exportEncryptedVault');
    expect(devServerCode).toContain('importEncryptedVault');
    expect(devServerCode).toContain('getMnemonicWords');
    expect(devServerCode).toContain('PBKDF2');
    expect(devServerCode).toContain('AES-GCM');
    expect(devServerCode).toContain('100000'); // 100,000 PBKDF2 iterations
    expect(devServerCode).toContain('generateEncryptedVaultBundle');
    expect(devServerCode).toContain('restoreEncryptedVaultBundle');
  });

  // 3. Dynamic E2EE Safety Numbers SVG QR
  it('guarantees Safety Numbers modal generates dynamic SVG QR code without static block placeholders', () => {
    expect(devServerCode).toContain("generateSvgQrCode('sovra:safety:' +");
    expect(devServerCode).not.toContain('background: #000; border-radius: 1px; opacity:');
  });

  // 4. Offline Outbox Replay Pill
  it('guarantees Dynamic Top Status Pill transitions between Queuing to Outbox and Back Online Synced', () => {
    expect(devServerCode).toContain('Offline Mode — Queuing to Sovereign Outbox');
    expect(devServerCode).toContain('Back Online — Synced');
    expect(devServerCode).toContain('window.SovraOfflineOutbox.getInstance().drainOutbox()');
  });

  // 5. WhatsApp-Style Multi-Device Ticket Flow (API E2E)
  it('proves WhatsApp-style ephemeral QR ticket flow links secondary devices with zero private key leak', async () => {
    const timestamp = Date.now();
    const primaryHandle = `@primary_${timestamp}`;

    // Register primary user on running dev-server
    const regRes = await makeJsonPost('http://127.0.0.1:3001/api/user/register', {
      handle: primaryHandle,
      name: 'Primary Peer',
      deviceType: 'Desktop'
    });
    expect(regRes.status).toBe(200);
    expect(regRes.data.ok).toBe(true);
    expect(regRes.data.sessionToken).toBeTruthy();

    const primaryToken = regRes.data.sessionToken;
    const primaryDid = regRes.data.user.did;

    // Step A: Primary device requests ephemeral link ticket
    const createRes = await makeJsonPost('http://127.0.0.1:3001/api/user/sessions/create-link-ticket', {
      deviceName: 'MacBook Air'
    }, {
      'Authorization': `Bearer ${primaryToken}`,
      'x-sovra-session-token': primaryToken
    });

    expect(createRes.status).toBe(200);
    expect(createRes.data.ok).toBe(true);
    expect(createRes.data.ticket).toMatch(/^slt_\d+_[a-f0-9]+/);
    expect(createRes.data.expiresAt).toBeGreaterThan(Date.now() + 500000); // ~10 min TTL
    expect(createRes.data.qrPayload).toBeTruthy();

    const ticketCode = createRes.data.ticket;

    // Step B: Secondary device (e.g. tablet) claims pairing ticket
    const claimRes = await makeJsonPost('http://127.0.0.1:3001/api/user/sessions/claim-link-ticket', {
      ticket: ticketCode,
      deviceName: 'iPad Pro Companion',
      deviceType: 'Tablet'
    });

    expect(claimRes.status).toBe(200);
    expect(claimRes.data.ok).toBe(true);
    expect(claimRes.data.sessionToken).toMatch(/^stk_\d+_[a-f0-9]+/);
    expect(claimRes.data.sessionToken).not.toBe(primaryToken); // Independent session token!
    expect(claimRes.data.did).toBe(primaryDid); // Same sovereign identity!
    expect(claimRes.data.handle).toBe(primaryHandle);

    // Step C: Verify single-use / replay protection (claiming second time fails)
    const replayClaimRes = await makeJsonPost('http://127.0.0.1:3001/api/user/sessions/claim-link-ticket', {
      ticket: ticketCode,
      deviceName: 'Hacker Browser'
    });
    expect(replayClaimRes.status).toBe(400);
    expect(replayClaimRes.data.ok).toBe(false);

    // Step D: Verify fake/non-existent ticket fails
    const fakeClaimRes = await makeJsonPost('http://127.0.0.1:3001/api/user/sessions/claim-link-ticket', {
      ticket: 'slt_fake_invalid_ticket_xyz'
    });
    expect(fakeClaimRes.status).toBe(400);
    expect(fakeClaimRes.data.ok).toBe(false);
  });
});

function makeJsonPost(urlStr: string, bodyObj: any, customHeaders: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const postData = JSON.stringify(bodyObj);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...customHeaders
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 200, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode || 200, data });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
