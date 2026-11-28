/**
 * @file scripts/verify-dns-ssl.ts
 * Production Pre-Flight Verifier for Sovra Domain DNS, Let's Encrypt TLS,
 * Coturn TURNS (5349) HMAC-SHA1 Ephemeral Auth, and Digital Asset Links.
 */

import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { getWebRtcConfiguration, generateTurnCredentials } from './webrtc-config.ts';

export interface PreflightReport {
  ok: boolean;
  dnsManifestValid: boolean;
  caddyTlsConfigValid: boolean;
  coturnTlsConfigValid: boolean;
  turnHmacVerified: boolean;
  assetLinksValid: boolean;
  liveDnsChecks: Array<{ hostname: string; resolved: boolean; addresses?: string[]; error?: string }>;
  liveTlsChecks: Array<{ host: string; port: number; authorized?: boolean; subjectCN?: string; error?: string }>;
  errors: string[];
}

export function verifyStaticInfraConfigs(rootDir = process.cwd()): {
  dnsManifestValid: boolean;
  caddyTlsConfigValid: boolean;
  coturnTlsConfigValid: boolean;
  turnHmacVerified: boolean;
  assetLinksValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 1. Validate DNS Manifest
  let dnsManifestValid = false;
  const dnsPath = path.join(rootDir, 'deploy', 'dns', 'sovra-dns-records.json');
  if (!fs.existsSync(dnsPath)) {
    errors.push('Missing deploy/dns/sovra-dns-records.json');
  } else {
    try {
      const dnsJson = JSON.parse(fs.readFileSync(dnsPath, 'utf-8'));
      const names = new Set((dnsJson.records || []).map((r: any) => `${r.type}:${r.name}`));
      const required = [
        'A:@',
        'A:seed-us-east',
        'A:seed-eu-central',
        'A:seed-ap-east',
        'A:turn-us-east',
        'A:turn-eu-central',
        'A:turn-ap-south',
        'SRV:_turns._tcp',
        'CAA:@',
      ];
      const missing = required.filter(reqKey => !names.has(reqKey));
      if (missing.length > 0) {
        errors.push(`DNS manifest missing required records: ${missing.join(', ')}`);
      } else {
        dnsManifestValid = true;
      }
    } catch (e: any) {
      errors.push(`Invalid DNS manifest JSON: ${e.message}`);
    }
  }

  // 2. Validate Caddyfile auto-TLS & HLS/well-known routes
  let caddyTlsConfigValid = false;
  const caddyPath = path.join(rootDir, 'docker', 'Caddyfile');
  if (!fs.existsSync(caddyPath)) {
    errors.push('Missing docker/Caddyfile');
  } else {
    const caddy = fs.readFileSync(caddyPath, 'utf-8');
    const hasDomainVar = caddy.includes('{$SOVRA_DOMAIN');
    const hasWellKnown = caddy.includes('/.well-known/assetlinks.json');
    const hasHls = caddy.includes('/api/videos/hls/*');
    if (!hasDomainVar || !hasWellKnown || !hasHls) {
      errors.push('docker/Caddyfile missing SOVRA_DOMAIN ACME TLS, .well-known, or HLS directives');
    } else {
      caddyTlsConfigValid = true;
    }
  }

  // 3. Validate Coturn SSL/TURNS Config & Renew Hook
  let coturnTlsConfigValid = false;
  const turnConfPath = path.join(rootDir, 'deploy', 'coturn', 'turnserver.conf');
  const renewHookPath = path.join(rootDir, 'deploy', 'coturn', 'renew-hook.sh');
  if (!fs.existsSync(turnConfPath) || !fs.existsSync(renewHookPath)) {
    errors.push('Missing deploy/coturn/turnserver.conf or renew-hook.sh');
  } else {
    const conf = fs.readFileSync(turnConfPath, 'utf-8');
    if (
      conf.includes('tls-listening-port=5349') &&
      conf.includes('use-auth-secret') &&
      conf.includes('cert=/etc/coturn/certs/fullchain.pem') &&
      conf.includes('pkey=/etc/coturn/certs/privkey.pem')
    ) {
      coturnTlsConfigValid = true;
    } else {
      errors.push('deploy/coturn/turnserver.conf missing TURNS 5349 cert/pkey or use-auth-secret');
    }
  }

  // 4. Verify RFC 5766 HMAC-SHA1 Ephemeral Credential Generation
  let turnHmacVerified = false;
  const testSecret = 'sovra-preflight-verify-secret';
  const creds = generateTurnCredentials('did:sovra:preflight', testSecret, 3600);
  const expected = crypto.createHmac('sha1', testSecret).update(creds.username).digest('base64');
  const rtcConfig = getWebRtcConfiguration({ userDid: 'did:sovra:preflight', region: 'us-east', zeroCloudMode: false });
  if (creds.credential === expected && rtcConfig.iceServers.some(s => String(s.urls).includes('5349'))) {
    turnHmacVerified = true;
  } else {
    errors.push('RFC 5766 HMAC-SHA1 credential verification failed');
  }

  // 5. Verify Android AssetLinks
  let assetLinksValid = false;
  const assetPath = path.join(rootDir, 'public', '.well-known', 'assetlinks.json');
  if (fs.existsSync(assetPath)) {
    try {
      const arr = JSON.parse(fs.readFileSync(assetPath, 'utf-8'));
      const mobileEntry = Array.isArray(arr)
        ? arr.find((e: any) => e?.target?.package_name === 'network.sovra.mobile')
        : null;
      if (
        mobileEntry?.target?.sha256_cert_fingerprints?.includes(
          '5F:E9:60:5F:17:55:F2:0A:9E:6C:F9:55:9D:3A:DF:B2:EC:88:23:25:18:32:9C:45:57:E4:66:A6:33:D6:2B:1C',
        )
      ) {
        assetLinksValid = true;
      } else {
        errors.push('assetlinks.json missing verified release keystore SHA-256 fingerprint');
      }
    } catch (e: any) {
      errors.push(`Invalid assetlinks.json: ${e.message}`);
    }
  } else {
    errors.push('Missing public/.well-known/assetlinks.json');
  }

  return {
    dnsManifestValid,
    caddyTlsConfigValid,
    coturnTlsConfigValid,
    turnHmacVerified,
    assetLinksValid,
    errors,
  };
}

export async function checkTlsEndpoint(host: string, port: number, timeoutMs = 2500): Promise<{
  host: string;
  port: number;
  authorized: boolean;
  subjectCN?: string;
  error?: string;
}> {
  return new Promise(resolve => {
    const socket = tls.connect(
      { host, port, rejectUnauthorized: false, servername: host === '127.0.0.1' ? 'localhost' : host },
      () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        socket.end();
        resolve({
          host,
          port,
          authorized,
          subjectCN: typeof cert?.subject?.CN === 'string' ? cert.subject.CN : undefined,
        });
      },
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({ host, port, authorized: false, error: 'TLS handshake timeout' });
    });
    socket.on('error', err => {
      resolve({ host, port, authorized: false, error: err.message });
    });
  });
}

export async function runPreflight(options: { checkLiveDns?: boolean; domain?: string; localTlsPort?: number } = {}): Promise<PreflightReport> {
  const staticChecks = verifyStaticInfraConfigs();
  const liveDnsChecks: PreflightReport['liveDnsChecks'] = [];
  const liveTlsChecks: PreflightReport['liveTlsChecks'] = [];

  if (options.checkLiveDns && options.domain) {
    const hosts = [
      options.domain,
      `seed-us-east.${options.domain}`,
      `seed-eu-central.${options.domain}`,
      `seed-ap-east.${options.domain}`,
      `turn-us-east.${options.domain}`,
    ];
    for (const h of hosts) {
      try {
        const ips = await dns.resolve4(h);
        liveDnsChecks.push({ hostname: h, resolved: ips.length > 0, addresses: ips });
      } catch (e: any) {
        liveDnsChecks.push({ hostname: h, resolved: false, error: e.code || e.message });
      }
    }
  }

  if (options.localTlsPort) {
    const tlsRes = await checkTlsEndpoint('127.0.0.1', options.localTlsPort);
    liveTlsChecks.push(tlsRes);
  }

  const ok =
    staticChecks.dnsManifestValid &&
    staticChecks.caddyTlsConfigValid &&
    staticChecks.coturnTlsConfigValid &&
    staticChecks.turnHmacVerified &&
    staticChecks.assetLinksValid;

  return {
    ok,
    ...staticChecks,
    liveDnsChecks,
    liveTlsChecks,
  };
}

if (process.argv[1] && process.argv[1].endsWith('verify-dns-ssl.ts')) {
  const checkLive = process.argv.includes('--live');
  const domainArg = process.argv.find(a => a.startsWith('--domain='))?.split('=')[1] || 'sovra.network';
  runPreflight({ checkLiveDns: checkLive, domain: domainArg })
    .then(rep => {
      console.log(JSON.stringify(rep, null, 2));
      process.exit(rep.ok ? 0 : 1);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
