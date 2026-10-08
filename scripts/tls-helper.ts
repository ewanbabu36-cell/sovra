import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

export function getLanIpAddresses(): string[] {
  const ips: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

export function findOpenSslBinary(): string | null {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
    '/usr/bin/openssl',
    '/usr/local/bin/openssl'
  ];

  for (const candidate of candidates) {
    try {
      if (candidate !== 'openssl' && !fs.existsSync(candidate)) {
        continue;
      }
      execSync(`"${candidate}" version`, { stdio: 'ignore' });
      return candidate;
    } catch (_) {}
  }
  return null;
}

export function ensureDevTlsCertificates(certDir = path.join(process.cwd(), '.sovra-tls')): { cert: string; key: string } | null {
  try {
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }

    const certPath = path.join(certDir, 'dev-cert.pem');
    const keyPath = path.join(certDir, 'dev-key.pem');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return {
        cert: fs.readFileSync(certPath, 'utf8'),
        key: fs.readFileSync(keyPath, 'utf8')
      };
    }

    const openssl = findOpenSslBinary();
    if (!openssl) {
      console.warn('[TLS] OpenSSL binary not found. Skipping auto TLS generation.');
      return null;
    }

    const lanIps = getLanIpAddresses();
    const primaryIp = lanIps[0] || '127.0.0.1';

    const cnfPath = path.join(certDir, 'openssl.cnf');
    let altNames = 'DNS.1 = localhost\nIP.1 = 127.0.0.1\n';
    let ipIdx = 2;
    for (const ip of lanIps) {
      altNames += `IP.${ipIdx} = ${ip}\n`;
      ipIdx++;
    }

    const cnfContent = `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = Development
L = Local
O = Sovra
CN = ${primaryIp}

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${altNames}`;

    fs.writeFileSync(cnfPath, cnfContent, 'utf8');

    const cmd = `"${openssl}" req -x509 -nodes -days 365 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -config "${cnfPath}"`;
    execSync(cmd, { stdio: 'ignore' });

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      console.log(`[TLS] Development TLS certificate generated for LAN IP ${primaryIp} in ${certDir}`);
      return {
        cert: fs.readFileSync(certPath, 'utf8'),
        key: fs.readFileSync(keyPath, 'utf8')
      };
    }
  } catch (err) {
    console.warn('[TLS] Failed to generate self-signed certificate:', err);
  }
  return null;
}
