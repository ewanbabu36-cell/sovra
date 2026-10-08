import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDevTlsCertificates, getLanIpAddresses } from '../../scripts/tls-helper.ts';

describe('Mobile LAN WebRTC & HTTPS Gateway Verification', () => {
  it('detects available LAN IPv4 addresses', () => {
    const ips = getLanIpAddresses();
    expect(Array.isArray(ips)).toBe(true);
    // Should contain valid IPv4 addresses if connected to network
    for (const ip of ips) {
      expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    }
  });

  it('ensures valid self-signed dev TLS certificates with Subject Alternative Names', () => {
    const tempCertDir = path.join(process.cwd(), '.tmp-test-tls-' + Date.now());
    try {
      const creds = ensureDevTlsCertificates(tempCertDir);
      expect(creds).not.toBeNull();
      if (creds) {
        expect(creds.cert).toContain('BEGIN CERTIFICATE');
        expect(creds.key).toContain('BEGIN PRIVATE KEY');

        const x509 = new crypto.X509Certificate(creds.cert);
        expect(x509.subjectAltName).toBeTruthy();
        expect(x509.subjectAltName).toContain('DNS:localhost');
        expect(x509.subjectAltName).toContain('IP Address:127.0.0.1');
      }
    } finally {
      if (fs.existsSync(tempCertDir)) {
        fs.rmSync(tempCertDir, { recursive: true, force: true });
      }
    }
  });

  it('verifies insecure context notice and call HTTPS switch UI markup exist in rendered HTML', () => {
    const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
    const content = fs.readFileSync(devServerPath, 'utf8');

    // Insecure context top notice banner
    expect(content).toContain('id="insecureContextNotice"');
    expect(content).toContain('Switch to HTTPS (Port 3443)');

    // Call modal HTTPS switch helper
    expect(content).toContain('id="callHttpsSwitchWrap"');
    expect(content).toContain('id="callHttpsSwitchBtn"');

    // Informative diagnostic in initCallLocalMediaStream
    expect(content).toContain('WebRTC requires HTTPS on mobile devices. Switch to https://');
  });
});
