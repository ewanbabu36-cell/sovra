import * as net from 'node:net';
import { PeerConnectionError } from './errors.js';

export interface ParsedSocks5Proxy {
  readonly host: string;
  readonly port: number;
  readonly resolveRemoteHostnames: boolean;
}

export interface ParsedOnionTarget {
  readonly host: string;
  readonly port: number;
  readonly peerId: string;
  readonly version: 2 | 3;
}

const ONION_V3_RE = /^[a-z2-7]{56}$/i;
const ONION_V2_RE = /^[a-z2-7]{16}$/i;

/**
 * Parses a SOCKS5/Tor proxy URI (e.g. socks5h://127.0.0.1:9050 or 127.0.0.1:9050).
 * Returns null if proxyUrl is empty or invalid.
 */
export function parseSocks5ProxyUrl(proxyUrl?: string): ParsedSocks5Proxy | null {
  const raw = String(proxyUrl || '').trim();
  if (!raw) return null;

  try {
    const normalized = raw.includes('://') ? raw : `socks5h://${raw}`;
    const u = new URL(normalized);
    if (u.protocol !== 'socks5:' && u.protocol !== 'socks5h:') {
      return null;
    }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const port = u.port ? parseInt(u.port, 10) : 9050;
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return {
      host,
      port,
      resolveRemoteHostnames: u.protocol === 'socks5h:' || raw.includes('9050') || !net.isIP(host),
    };
  } catch {
    return null;
  }
}

/**
 * Parses `/onion/<addr16>:<port>/p2p/<PeerID>`, `/onion3/<addr56>:<port>/p2p/<PeerID>`,
 * or `/onion3/<addr56>/tcp/<port>/p2p/<PeerID>`.
 */
export function parseOnionMultiaddr(multiaddr: string): ParsedOnionTarget | null {
  const raw = String(multiaddr || '').trim();
  if (!raw || (!raw.includes('/onion/') && !raw.includes('/onion3/'))) {
    return null;
  }
  const peerParts = raw.split('/p2p/');
  const peerId = peerParts[peerParts.length - 1]?.split('/')[0]?.trim();
  if (!peerId) return null;

  const v3Inline = raw.match(/\/onion3\/([a-z2-7]+):(\d+)/i);
  if (v3Inline && v3Inline[1] && v3Inline[2] && ONION_V3_RE.test(v3Inline[1])) {
    const port = parseInt(v3Inline[2], 10);
    if (port >= 1 && port <= 65535) {
      return { host: `${v3Inline[1].toLowerCase()}.onion`, port, peerId, version: 3 };
    }
  }

  const v3Tcp = raw.match(/\/onion3\/([a-z2-7]+)(?:\.onion)?\/tcp\/(\d+)/i);
  if (v3Tcp && v3Tcp[1] && v3Tcp[2] && ONION_V3_RE.test(v3Tcp[1])) {
    const port = parseInt(v3Tcp[2], 10);
    if (port >= 1 && port <= 65535) {
      return { host: `${v3Tcp[1].toLowerCase()}.onion`, port, peerId, version: 3 };
    }
  }

  const v2Inline = raw.match(/\/onion\/([a-z2-7]+):(\d+)/i);
  if (v2Inline && v2Inline[1] && v2Inline[2] && ONION_V2_RE.test(v2Inline[1])) {
    const port = parseInt(v2Inline[2], 10);
    if (port >= 1 && port <= 65535) {
      return { host: `${v2Inline[1].toLowerCase()}.onion`, port, peerId, version: 2 };
    }
  }

  const v2Tcp = raw.match(/\/onion\/([a-z2-7]+)(?:\.onion)?\/tcp\/(\d+)/i);
  if (v2Tcp && v2Tcp[1] && v2Tcp[2] && ONION_V2_RE.test(v2Tcp[1])) {
    const port = parseInt(v2Tcp[2], 10);
    if (port >= 1 && port <= 65535) {
      return { host: `${v2Tcp[1].toLowerCase()}.onion`, port, peerId, version: 2 };
    }
  }

  return null;
}

function encodeSocks5ConnectRequest(targetHost: string, targetPort: number): Buffer {
  const ipKind = net.isIP(targetHost);
  if (ipKind === 4) {
    const octets = targetHost.split('.').map(o => parseInt(o, 10));
    return Buffer.from([
      0x05, 0x01, 0x00, 0x01,
      octets[0]!, octets[1]!, octets[2]!, octets[3]!,
      (targetPort >>> 8) & 0xff, targetPort & 0xff,
    ]);
  }
  const hostBuf = Buffer.from(targetHost, 'utf8');
  if (hostBuf.length === 0 || hostBuf.length > 255) {
    throw new PeerConnectionError(`Invalid target hostname length for SOCKS5: ${targetHost}`);
  }
  const req = Buffer.alloc(7 + hostBuf.length);
  req[0] = 0x05; // VER
  req[1] = 0x01; // CMD = CONNECT
  req[2] = 0x00; // RSV
  req[3] = 0x03; // ATYP = DOMAINNAME (remote resolution, prevents DNS leaks for .onion)
  req[4] = hostBuf.length;
  hostBuf.copy(req, 5);
  req.writeUInt16BE(targetPort, 5 + hostBuf.length);
  return req;
}

function describeSocks5ReplyCode(code: number): string {
  switch (code) {
    case 0x01: return 'general SOCKS server failure';
    case 0x02: return 'connection not allowed by ruleset';
    case 0x03: return 'network unreachable';
    case 0x04: return 'host unreachable';
    case 0x05: return 'connection refused';
    case 0x06: return 'TTL expired';
    case 0x07: return 'command not supported';
    case 0x08: return 'address type not supported';
    default: return `SOCKS5 error code ${code}`;
  }
}

function replyRequiredBytes(buf: Buffer): number | null {
  if (buf.length < 4) return null;
  const atyp = buf[3]!;
  if (atyp === 0x01) return 10; // IPv4 (4) + port (2)
  if (atyp === 0x04) return 22; // IPv6 (16) + port (2)
  if (atyp === 0x03) {
    if (buf.length < 5) return null;
    return 5 + buf[4]! + 2;
  }
  return 4;
}

/**
 * RFC 1928 SOCKS5 TCP client transport enabling Tor `.onion` and zero-DNS proxy dialing.
 */
export class Socks5TcpTransport {
  public async dial(
    targetHost: string,
    targetPort: number,
    proxy: ParsedSocks5Proxy,
    timeoutMs = 5000,
  ): Promise<net.Socket> {
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      throw new PeerConnectionError(`Invalid SOCKS5 target port: ${targetPort}`);
    }

    return new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection({ host: proxy.host, port: proxy.port });
      let stage: 'greeting' | 'connect' | 'done' = 'greeting';
      let rx = Buffer.alloc(0);
      let settled = false;

      const timer = setTimeout(() => {
        fail(new PeerConnectionError(`SOCKS5 dial to ${targetHost}:${targetPort} via ${proxy.host}:${proxy.port} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('close', onClose);
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.destroy();
        reject(err);
      };

      const onError = (err: Error) => {
        fail(new PeerConnectionError(`SOCKS5 proxy error (${proxy.host}:${proxy.port}): ${err.message}`));
      };

      const onClose = () => {
        fail(new PeerConnectionError(`SOCKS5 proxy closed connection before tunnel established`));
      };

      const onData = (chunk: Buffer) => {
        rx = Buffer.concat([rx, chunk]);
        try {
          if (stage === 'greeting') {
            if (rx.length < 2) return;
            const ver = rx[0]!;
            const method = rx[1]!;
            if (ver !== 0x05 || method !== 0x00) {
              fail(new PeerConnectionError(`SOCKS5 auth negotiation failed: ver=${ver} method=${method}`));
              return;
            }
            rx = rx.subarray(2);
            stage = 'connect';
            socket.write(encodeSocks5ConnectRequest(targetHost, targetPort));
          }

          if (stage === 'connect') {
            const needed = replyRequiredBytes(rx);
            if (needed === null || rx.length < needed) return;
            const ver = rx[0]!;
            const rep = rx[1]!;
            if (ver !== 0x05) {
              fail(new PeerConnectionError(`Invalid SOCKS5 connect reply version: ${ver}`));
              return;
            }
            if (rep !== 0x00) {
              fail(new PeerConnectionError(`SOCKS5 CONNECT rejected for ${targetHost}:${targetPort}: ${describeSocks5ReplyCode(rep)}`));
              return;
            }
            stage = 'done';
            settled = true;
            cleanup();
            const leftover = rx.subarray(needed);
            if (leftover.length > 0) {
              socket.unshift(leftover);
            }
            resolve(socket);
          }
        } catch (err) {
          fail(err instanceof Error ? err : new PeerConnectionError(String(err)));
        }
      };

      socket.on('error', onError);
      socket.on('close', onClose);
      socket.on('data', onData);
      socket.once('connect', () => {
        // Send SOCKS5 greeting: version 5, 1 auth method, 0x00 = NO AUTHENTICATION REQUIRED
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      });
    });
  }
}
