import * as dgram from 'node:dgram';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';

export interface PortMappingRequest {
  readonly internalPort: number;
  readonly externalPort?: number;
  readonly protocol?: 'TCP' | 'UDP';
  readonly leaseSeconds?: number;
  readonly description?: string;
  readonly natPmpGateway?: string;
  readonly natPmpPort?: number;
  readonly pcpGateway?: string;
  readonly pcpPort?: number;
  readonly clientIp?: string;
  readonly upnpLocationUrl?: string;
  readonly multicastAddress?: string;
  readonly multicastPort?: number;
  readonly timeoutMs?: number;
}

export interface PortMappingLease {
  readonly ok: true;
  readonly method: 'upnp-igd' | 'nat-pmp' | 'pcp';
  readonly protocol: 'TCP' | 'UDP';
  readonly internalPort: number;
  readonly externalPort: number;
  readonly externalIp: string;
  readonly leaseSeconds: number;
  readonly controlUrl?: string;
  readonly serviceType?: string;
  readonly gatewayIp?: string;
  readonly natPmpPort?: number;
  readonly pcpPort?: number;
  readonly pcpNonceHex?: string;
  readonly clientIp?: string;
}

export type PortMappingResult =
  | PortMappingLease
  | { readonly ok: false; readonly reason: string };

const SSDP_SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
];

function getLocalNonLoopbackIpv4(): string | null {
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return null;
}

export function inferNatPmpGatewayFromInterfaces(): string | null {
  try {
    if (process.platform === 'linux' && fs.existsSync('/proc/net/route')) {
      const lines = fs.readFileSync('/proc/net/route', 'utf8').split(/\r?\n/);
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]?.trim().split(/\s+/);
        if (cols && cols.length >= 3 && cols[1] === '00000000' && /^[0-9A-Fa-f]{8}$/.test(cols[2]!)) {
          const hex = cols[2]!;
          // /proc/net/route stores IPv4 gateway in host byte order (little-endian on x86/arm64 LE)
          const b0 = parseInt(hex.slice(6, 8), 16);
          const b1 = parseInt(hex.slice(4, 6), 16);
          const b2 = parseInt(hex.slice(2, 4), 16);
          const b3 = parseInt(hex.slice(0, 2), 16);
          const gw = `${b0}.${b1}.${b2}.${b3}`;
          if (net.isIPv4(gw) && gw !== '0.0.0.0') return gw;
        }
      }
    }
    if (process.platform === 'win32') {
      const cp = (process as unknown as { getBuiltinModule?: (id: string) => { execSync?: typeof import('node:child_process').execSync } }).getBuiltinModule?.('node:child_process');
      const out = cp?.execSync?.('route print 0.0.0.0', { encoding: 'utf8', timeout: 250, windowsHide: true }) ?? '';
      const m = out.match(/\b0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})\b/);
      if (m && m[1] && net.isIPv4(m[1])) return m[1];
    }
  } catch {}

  const localIp = getLocalNonLoopbackIpv4();
  if (!localIp) return null;
  const parts = localIp.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
}

function buildNatPmpMappingPacket(
  protocol: 'TCP' | 'UDP',
  internalPort: number,
  externalPort: number,
  leaseSeconds: number,
): Buffer {
  const pkt = Buffer.alloc(12);
  pkt[0] = 0x00; // RFC 6886 version 0
  pkt[1] = protocol === 'TCP' ? 2 : 1; // opcode 1=UDP, 2=TCP
  pkt.writeUInt16BE(0, 2);
  pkt.writeUInt16BE(internalPort, 4);
  pkt.writeUInt16BE(externalPort, 6);
  pkt.writeUInt32BE(leaseSeconds, 8);
  return pkt;
}

function sendUdpRequest(
  host: string,
  port: number,
  payload: Buffer,
  timeoutMs: number,
): Promise<Buffer | null> {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    let settled = false;
    const finish = (buf: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {}
      resolve(buf);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on('error', () => finish(null));
    sock.on('message', msg => finish(msg));
    sock.send(payload, port, host, err => {
      if (err) finish(null);
    });
  });
}

/**
 * RFC 6886 NAT-PMP external IP query & port mapping request.
 */
export async function requestNatPmpMapping(opts: {
  gatewayIp: string;
  internalPort: number;
  externalPort?: number;
  protocol?: 'TCP' | 'UDP';
  leaseSeconds?: number;
  natPmpPort?: number;
  timeoutMs?: number;
}): Promise<PortMappingResult> {
  const port = opts.natPmpPort ?? 5351;
  const timeoutMs = opts.timeoutMs ?? 1200;
  const protocol = opts.protocol ?? 'TCP';
  const leaseSeconds = opts.leaseSeconds ?? 3600;
  const desiredExt = opts.externalPort ?? opts.internalPort;

  const ipReply = await sendUdpRequest(opts.gatewayIp, port, Buffer.from([0x00, 0x00]), timeoutMs);
  if (!ipReply || ipReply.length < 12 || ipReply[1] !== 128) {
    return { ok: false, reason: `NAT-PMP gateway ${opts.gatewayIp}:${port} did not respond` };
  }
  const ipResultCode = ipReply.readUInt16BE(2);
  if (ipResultCode !== 0) {
    return { ok: false, reason: `NAT-PMP external IP query error ${ipResultCode}` };
  }
  const externalIp = `${ipReply[8]}.${ipReply[9]}.${ipReply[10]}.${ipReply[11]}`;

  const mapReq = buildNatPmpMappingPacket(protocol, opts.internalPort, desiredExt, leaseSeconds);
  const mapReply = await sendUdpRequest(opts.gatewayIp, port, mapReq, timeoutMs);
  const expectedOp = protocol === 'TCP' ? 130 : 129;
  if (!mapReply || mapReply.length < 16 || mapReply[1] !== expectedOp) {
    return { ok: false, reason: `NAT-PMP mapping response invalid from ${opts.gatewayIp}:${port}` };
  }
  const mapResultCode = mapReply.readUInt16BE(2);
  if (mapResultCode !== 0) {
    return { ok: false, reason: `NAT-PMP mapping refused (code ${mapResultCode})` };
  }
  const mappedExternalPort = mapReply.readUInt16BE(10);
  const grantedLease = mapReply.readUInt32BE(12);

  return {
    ok: true,
    method: 'nat-pmp',
    protocol,
    internalPort: opts.internalPort,
    externalPort: mappedExternalPort,
    externalIp,
    leaseSeconds: grantedLease,
    gatewayIp: opts.gatewayIp,
    natPmpPort: port,
  };
}

function parseSsdpLocation(rawHeaders: string): string | null {
  const m = rawHeaders.match(/^LOCATION:\s*(.+)$/im);
  return m?.[1]?.trim() || null;
}

function httpGetText(urlStr: string, timeoutMs: number): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const req = http.get(urlStr, { timeout: timeoutMs }, res => {
        if ((res.statusCode ?? 0) >= 400) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

function postUpnpSoap(
  controlUrl: string,
  serviceType: string,
  action: string,
  innerXml: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: string }> {
  const envelope =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${serviceType}">${innerXml}</u:${action}></s:Body></s:Envelope>`;

  return new Promise(resolve => {
    try {
      const target = new URL(controlUrl);
      const req = http.request(
        target,
        {
          method: 'POST',
          timeout: timeoutMs,
          headers: {
            'Content-Type': 'text/xml; charset="utf-8"',
            'Content-Length': Buffer.byteLength(envelope),
            SOAPAction: `"${serviceType}#${action}"`,
          },
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            resolve({ ok: status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString('utf8') });
          });
        },
      );
      req.on('error', err => resolve({ ok: false, status: 0, body: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0, body: 'timeout' });
      });
      req.write(envelope);
      req.end();
    } catch (err) {
      resolve({ ok: false, status: 0, body: err instanceof Error ? err.message : String(err) });
    }
  });
}

function extractUpnpControlEndpoint(xml: string, baseLocationUrl: string): { serviceType: string; controlUrl: string } | null {
  const serviceBlocks = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
  for (const block of serviceBlocks) {
    const stMatch = block.match(/<serviceType>([^<]*WAN(?:IP|PPP)Connection:\d+)<\/serviceType>/i);
    const ctrlMatch = block.match(/<controlURL>([^<]+)<\/controlURL>/i);
    if (stMatch?.[1] && ctrlMatch?.[1]) {
      const resolvedUrl = new URL(ctrlMatch[1].trim(), baseLocationUrl).toString();
      return { serviceType: stMatch[1].trim(), controlUrl: resolvedUrl };
    }
  }
  return null;
}

async function discoverSsdpLocation(
  multicastAddress = '239.255.255.250',
  multicastPort = 1900,
  timeoutMs = 1200,
): Promise<string | null> {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    let settled = false;
    const finish = (loc: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {}
      resolve(loc);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on('error', () => finish(null));
    sock.on('message', msg => {
      const loc = parseSsdpLocation(msg.toString('utf8'));
      if (loc) finish(loc);
    });
    for (const st of SSDP_SEARCH_TARGETS) {
      const query =
        'M-SEARCH * HTTP/1.1\r\n' +
        `HOST: ${multicastAddress}:${multicastPort}\r\n` +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 1\r\n' +
        `ST: ${st}\r\n\r\n`;
      sock.send(Buffer.from(query, 'utf8'), multicastPort, multicastAddress, () => {});
    }
  });
}

function encodeIpTo16Bytes(ip: string): Buffer {
  const out = Buffer.alloc(16);
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (net.isIPv4(clean)) {
    out[10] = 0xff;
    out[11] = 0xff;
    const parts = clean.split('.').map(n => parseInt(n, 10) & 0xff);
    out[12] = parts[0] ?? 0;
    out[13] = parts[1] ?? 0;
    out[14] = parts[2] ?? 0;
    out[15] = parts[3] ?? 0;
    return out;
  }
  if (net.isIPv6(clean)) {
    const halves = clean.split('::');
    const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
    const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
    const missing = halves.length === 2 ? Math.max(0, 8 - (left.length + right.length)) : 0;
    const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right].slice(0, 8);
    for (let i = 0; i < groups.length; i++) {
      out.writeUInt16BE(parseInt(groups[i] || '0', 16) & 0xffff, i * 2);
    }
    return out;
  }
  out[10] = 0xff;
  out[11] = 0xff;
  return out;
}

function decode16ByteIp(buf: Buffer, offset: number): string {
  const slice = buf.subarray(offset, offset + 16);
  const isV4Mapped =
    slice.subarray(0, 10).every(b => b === 0) &&
    slice[10] === 0xff &&
    slice[11] === 0xff;
  if (isV4Mapped) {
    return `${slice[12]}.${slice[13]}.${slice[14]}.${slice[15]}`;
  }
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    groups.push(slice.readUInt16BE(i * 2).toString(16));
  }
  return groups.join(':');
}

/**
 * Builds an RFC 6887 PCP (Port Control Protocol v2) MAP request packet (60 bytes).
 */
export function buildPcpMapPacket(opts: {
  clientIp: string;
  protocol: 'TCP' | 'UDP';
  internalPort: number;
  externalPort: number;
  leaseSeconds: number;
  nonce?: Buffer;
  suggestedExternalIp?: string;
}): Buffer {
  const pkt = Buffer.alloc(60);
  pkt[0] = 0x02; // RFC 6887 PCP version 2
  pkt[1] = 0x01; // R=0, Opcode=1 (MAP)
  pkt.writeUInt16BE(0, 2);
  pkt.writeUInt32BE(opts.leaseSeconds >>> 0, 4);
  encodeIpTo16Bytes(opts.clientIp).copy(pkt, 8);
  const nonce = opts.nonce ?? Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(12)));
  nonce.copy(pkt, 24, 0, 12);
  pkt[36] = opts.protocol === 'UDP' ? 17 : 6;
  pkt.writeUInt16BE(opts.internalPort, 40);
  pkt.writeUInt16BE(opts.externalPort, 42);
  encodeIpTo16Bytes(opts.suggestedExternalIp ?? '0.0.0.0').copy(pkt, 44);
  return pkt;
}

/**
 * RFC 6887 PCP (Port Control Protocol v2) MAP port mapping request.
 */
export async function requestPcpMapping(opts: {
  gatewayIp: string;
  clientIp?: string;
  internalPort: number;
  externalPort?: number;
  protocol?: 'TCP' | 'UDP';
  leaseSeconds?: number;
  pcpPort?: number;
  timeoutMs?: number;
  nonce?: Buffer;
}): Promise<PortMappingResult> {
  const port = opts.pcpPort ?? 5351;
  const timeoutMs = opts.timeoutMs ?? 1200;
  const protocol = opts.protocol ?? 'TCP';
  const leaseSeconds = opts.leaseSeconds ?? 3600;
  const desiredExt = opts.externalPort ?? opts.internalPort;
  const clientIp = opts.clientIp || getLocalNonLoopbackIpv4() || '127.0.0.1';
  const nonce = opts.nonce ?? Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(12)));

  const pkt = buildPcpMapPacket({
    clientIp,
    protocol,
    internalPort: opts.internalPort,
    externalPort: desiredExt,
    leaseSeconds,
    nonce,
  });

  const reply = await sendUdpRequest(opts.gatewayIp, port, pkt, timeoutMs);
  if (!reply || reply.length < 60 || reply[0] !== 0x02 || reply[1] !== 0x81) {
    return { ok: false, reason: `PCP gateway ${opts.gatewayIp}:${port} did not return a valid MAP v2 response` };
  }
  const resultCode = reply[3]!;
  if (resultCode !== 0) {
    return { ok: false, reason: `PCP MAP refused (result code ${resultCode})` };
  }
  if (!reply.subarray(24, 36).equals(nonce)) {
    return { ok: false, reason: 'PCP MAP response nonce mismatch' };
  }

  const grantedLease = reply.readUInt32BE(4);
  const mappedExternalPort = reply.readUInt16BE(42);
  const externalIp = decode16ByteIp(reply, 44);

  return {
    ok: true,
    method: 'pcp',
    protocol,
    internalPort: opts.internalPort,
    externalPort: mappedExternalPort,
    externalIp,
    leaseSeconds: grantedLease,
    gatewayIp: opts.gatewayIp,
    pcpPort: port,
    pcpNonceHex: nonce.toString('hex'),
    clientIp,
  };
}

/**
 * Automatic router port mapper supporting home UPnP IGD (SSDP + SOAP), RFC 6886 NAT-PMP, and RFC 6887 PCP.
 */
export class AutoPortMapper {
  private readonly activeLeases: PortMappingLease[] = [];

  public getActiveLeases(): readonly PortMappingLease[] {
    return [...this.activeLeases];
  }

  public async mapPort(req: PortMappingRequest): Promise<PortMappingResult> {
    const protocol = req.protocol ?? 'TCP';
    const internalPort = req.internalPort;
    const externalPort = req.externalPort ?? internalPort;
    const leaseSeconds = req.leaseSeconds ?? 3600;
    const timeoutMs = req.timeoutMs ?? 1200;
    const localIp = req.clientIp || getLocalNonLoopbackIpv4() || '127.0.0.1';

    // 1. Try UPnP IGD (explicit LOCATION URL or SSDP multicast discovery)
    const locationUrl =
      req.upnpLocationUrl ??
      (await discoverSsdpLocation(
        req.multicastAddress ?? '239.255.255.250',
        req.multicastPort ?? 1900,
        timeoutMs,
      ));

    if (locationUrl) {
      const xml = await httpGetText(locationUrl, timeoutMs);
      const endpoint = xml ? extractUpnpControlEndpoint(xml, locationUrl) : null;
      if (endpoint) {
        const desc = (req.description || 'Sovra P2P Node').replace(/[<>&"]/g, '');
        const addRes = await postUpnpSoap(
          endpoint.controlUrl,
          endpoint.serviceType,
          'AddPortMapping',
          `<NewRemoteHost></NewRemoteHost>` +
            `<NewExternalPort>${externalPort}</NewExternalPort>` +
            `<NewProtocol>${protocol}</NewProtocol>` +
            `<NewInternalPort>${internalPort}</NewInternalPort>` +
            `<NewInternalClient>${localIp}</NewInternalClient>` +
            `<NewEnabled>1</NewEnabled>` +
            `<NewPortMappingDescription>${desc}</NewPortMappingDescription>` +
            `<NewLeaseDuration>${leaseSeconds}</NewLeaseDuration>`,
          timeoutMs,
        );
        if (addRes.ok) {
          const extRes = await postUpnpSoap(
            endpoint.controlUrl,
            endpoint.serviceType,
            'GetExternalIPAddress',
            '',
            timeoutMs,
          );
          const ipMatch = extRes.body.match(/<NewExternalIPAddress>([^<]+)<\/NewExternalIPAddress>/i);
          const externalIp = ipMatch?.[1]?.trim() || localIp;
          const lease: PortMappingLease = {
            ok: true,
            method: 'upnp-igd',
            protocol,
            internalPort,
            externalPort,
            externalIp,
            leaseSeconds,
            controlUrl: endpoint.controlUrl,
            serviceType: endpoint.serviceType,
          };
          this.activeLeases.push(lease);
          return lease;
        }
      }
    }

    // 2. Fallback to NAT-PMP (RFC 6886)
    const gateway = req.natPmpGateway ?? inferNatPmpGatewayFromInterfaces();
    if (gateway) {
      const natPmpRes = await requestNatPmpMapping({
        gatewayIp: gateway,
        internalPort,
        externalPort,
        protocol,
        leaseSeconds,
        ...(req.natPmpPort !== undefined ? { natPmpPort: req.natPmpPort } : {}),
        timeoutMs,
      });
      if (natPmpRes.ok) {
        this.activeLeases.push(natPmpRes);
        return natPmpRes;
      }
    }

    // 3. Fallback to PCP (RFC 6887) MAP v2
    const pcpGateway = req.pcpGateway ?? gateway;
    if (pcpGateway) {
      const pcpRes = await requestPcpMapping({
        gatewayIp: pcpGateway,
        clientIp: localIp,
        internalPort,
        externalPort,
        protocol,
        leaseSeconds,
        ...(req.pcpPort !== undefined ? { pcpPort: req.pcpPort } : req.natPmpPort !== undefined ? { pcpPort: req.natPmpPort } : {}),
        timeoutMs,
      });
      if (pcpRes.ok) {
        this.activeLeases.push(pcpRes);
        return pcpRes;
      }
      return pcpRes;
    }

    return { ok: false, reason: 'No UPnP IGD, NAT-PMP, or PCP router responder found on LAN' };
  }

  public async unmapAll(timeoutMs = 800): Promise<void> {
    while (this.activeLeases.length > 0) {
      const lease = this.activeLeases.pop()!;
      if (lease.method === 'upnp-igd' && lease.controlUrl && lease.serviceType) {
        await postUpnpSoap(
          lease.controlUrl,
          lease.serviceType,
          'DeletePortMapping',
          `<NewRemoteHost></NewRemoteHost>` +
            `<NewExternalPort>${lease.externalPort}</NewExternalPort>` +
            `<NewProtocol>${lease.protocol}</NewProtocol>`,
          timeoutMs,
        ).catch(() => {});
      } else if (lease.method === 'nat-pmp' && lease.gatewayIp) {
        const pkt = buildNatPmpMappingPacket(lease.protocol, lease.internalPort, 0, 0);
        await sendUdpRequest(lease.gatewayIp, lease.natPmpPort ?? 5351, pkt, timeoutMs).catch(() => {});
      } else if (lease.method === 'pcp' && lease.gatewayIp && lease.pcpNonceHex) {
        const pkt = buildPcpMapPacket({
          clientIp: lease.clientIp || getLocalNonLoopbackIpv4() || '127.0.0.1',
          protocol: lease.protocol,
          internalPort: lease.internalPort,
          externalPort: 0,
          leaseSeconds: 0,
          nonce: Buffer.from(lease.pcpNonceHex, 'hex'),
        });
        await sendUdpRequest(lease.gatewayIp, lease.pcpPort ?? 5351, pkt, timeoutMs).catch(() => {});
      }
    }
  }
}
