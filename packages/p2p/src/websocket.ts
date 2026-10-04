import * as http from 'node:http';
import * as net from 'node:net';
import { createHash } from 'node:crypto';

export interface DuplexTransportStream {
  write(data: Uint8Array, callback?: (err?: Error) => void): boolean;
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: () => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  destroy(error?: Error): void;
  destroyed: boolean;
  writable: boolean;
  remoteAddress?: string | undefined;
  remotePort?: number | undefined;
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Lightweight RFC 6455 WebSocket framing duplex stream adapter.
 * Wraps raw TCP socket upgraded to WebSocket or browser WebSocket connection.
 */
export class WebSocketDuplexStream implements DuplexTransportStream {
  private dataListeners: Array<(chunk: Buffer) => void> = [];
  private errorListeners: Array<(err: Error) => void> = [];
  private closeListeners: Array<() => void> = [];
  private _destroyed = false;
  private buffer = Buffer.alloc(0);

  constructor(
    private readonly rawSocket: net.Socket,
    private readonly isServer = true,
  ) {
    this.rawSocket.on('data', chunk => this.handleRawData(chunk));
    this.rawSocket.on('error', err => this.emitError(err));
    this.rawSocket.on('close', () => this.emitClose());
    this.rawSocket.on('end', () => this.emitClose());
  }

  public get destroyed(): boolean {
    return this._destroyed || this.rawSocket.destroyed;
  }

  public get writable(): boolean {
    return !this.destroyed && this.rawSocket.writable;
  }

  public get remoteAddress(): string | undefined {
    return this.rawSocket.remoteAddress;
  }

  public get remotePort(): number | undefined {
    return this.rawSocket.remotePort;
  }

  public on(event: 'data' | 'error' | 'close', listener: any): this {
    if (event === 'data') this.dataListeners.push(listener);
    if (event === 'error') this.errorListeners.push(listener);
    if (event === 'close') this.closeListeners.push(listener);
    return this;
  }

  public off(event: string, listener: (...args: any[]) => void): this {
    if (event === 'data') this.dataListeners = this.dataListeners.filter(l => l !== listener);
    if (event === 'error') this.errorListeners = this.errorListeners.filter(l => l !== listener);
    if (event === 'close') this.closeListeners = this.closeListeners.filter(l => l !== listener);
    return this;
  }

  /**
   * Sends binary payload wrapped in standard RFC 6455 WebSocket binary frame (opcode 0x02).
   */
  public write(data: Uint8Array, callback?: (err?: Error) => void): boolean {
    if (this.destroyed) return false;

    const frame = this.encodeWsBinaryFrame(data, !this.isServer);
    return this.rawSocket.write(frame, err => {
      if (callback) callback(err ?? undefined);
    });
  }

  public end(callback?: () => void): void {
    if (this._destroyed) {
      if (callback) callback();
      return;
    }
    const closeFrame = Buffer.from(this.isServer ? [0x88, 0x00] : [0x88, 0x80, 0x00, 0x00, 0x00, 0x00]);
    this.rawSocket.write(closeFrame, () => {
      this.destroy();
      if (callback) callback();
    });
  }

  public close(): void {
    this.end();
  }

  public destroy(error?: Error): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.rawSocket.destroy(error);
    this.emitClose();
  }

  public handleRawData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const byte1 = this.buffer[0]!;
      const byte2 = this.buffer[1]!;
      const opcode = byte1 & 0x0f;
      const isMasked = (byte2 & 0x80) !== 0;
      let payloadLen = byte2 & 0x7f;
      let offset = 2;

      // Handle close frame (opcode 0x08)
      if (opcode === 0x08) {
        this.buffer = Buffer.alloc(0);
        this.destroy();
        return;
      }

      // Handle ping frame (opcode 0x09)
      if (opcode === 0x09) {
        const pong = Buffer.from([0x8a, 0x00]);
        this.rawSocket.write(pong);
        this.buffer = this.buffer.subarray(2);
        continue;
      }

      if (payloadLen === 126) {
        if (this.buffer.length < offset + 2) break;
        payloadLen = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (this.buffer.length < offset + 8) break;
        payloadLen = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey: Buffer | null = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) break;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) break;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLen));
      this.buffer = this.buffer.subarray(offset + payloadLen);

      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          const current = payload[i] ?? 0;
          const maskByte = maskKey[i % 4] ?? 0;
          payload[i] = current ^ maskByte;
        }
      }

      // Opcode 0x02 = binary frame
      for (const listener of this.dataListeners) {
        listener(payload);
      }
    }
  }

  private encodeWsBinaryFrame(payload: Uint8Array, mask: boolean): Buffer {
    let headerLen = 2;
    if (payload.length >= 126 && payload.length <= 65535) headerLen += 2;
    else if (payload.length > 65535) headerLen += 8;
    if (mask) headerLen += 4;

    const frame = Buffer.alloc(headerLen + payload.length);
    frame[0] = 0x82; // FIN = 1, opcode = 2 (Binary)

    let offset = 1;
    if (payload.length < 126) {
      frame[offset++] = (mask ? 0x80 : 0x00) | payload.length;
    } else if (payload.length <= 65535) {
      frame[offset++] = (mask ? 0x80 : 0x00) | 126;
      frame.writeUInt16BE(payload.length, offset);
      offset += 2;
    } else {
      frame[offset++] = (mask ? 0x80 : 0x00) | 127;
      frame.writeBigUInt64BE(BigInt(payload.length), offset);
      offset += 8;
    }

    if (mask) {
      const maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);
      maskKey.copy(frame, offset);
      offset += 4;
      for (let i = 0; i < payload.length; i++) {
        frame[offset + i] = (payload[i] ?? 0) ^ (maskKey[i % 4] ?? 0);
      }
    } else {
      Buffer.from(payload).copy(frame, offset);
    }

    return frame;
  }

  private emitError(err: Error): void {
    for (const listener of this.errorListeners) listener(err);
  }

  private emitClose(): void {
    for (const listener of this.closeListeners) listener();
  }
}

/**
 * Standard WebSocket Transport for hybrid Browser / Node.js P2P networking.
 */
export class WebSocketTransport {
  private server: http.Server | null = null;
  private isListening = false;
  private activeSockets = new Set<net.Socket>();

  public async listen(
    port: number,
    host = '127.0.0.1',
    onConnection: (stream: WebSocketDuplexStream) => void,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((_req, res) => {
        res.writeHead(426, { 'Content-Type': 'text/plain' });
        res.end('Upgrade Required: WebSocket Only');
      });

      srv.on('connection', socket => {
        this.activeSockets.add(socket);
        socket.on('close', () => this.activeSockets.delete(socket));
      });

      srv.on('upgrade', (req, socket, head) => {
        const key = req.headers['sec-websocket-key'];
        if (!key) {
          socket.destroy();
          return;
        }

        const accept = createHash('sha1').update(key + WS_GUID).digest('base64');

        const responseHeaders = [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '\r\n',
        ];

        socket.write(responseHeaders.join('\r\n'));
        const wsStream = new WebSocketDuplexStream(socket as net.Socket, true);
        if (head && head.length > 0) {
          wsStream.handleRawData(head);
        }
        onConnection(wsStream);
      });

      srv.on('error', err => reject(err));

      srv.listen(port, host, () => {
        this.server = srv;
        this.isListening = true;
        const addr = srv.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(actualPort);
      });
    });
  }

  public async dial(
    target: number | string,
    host = '127.0.0.1',
    path = '/',
    timeoutMs = 3000,
  ): Promise<WebSocketDuplexStream> {
    let portNum: number;
    let hostStr = host;
    let pathStr = path;

    if (typeof target === 'string') {
      try {
        const normalized = target.startsWith('ws://') || target.startsWith('http://') ? target : `ws://${target}`;
        const parsed = new URL(normalized);
        portNum = parsed.port ? parseInt(parsed.port, 10) : 80;
        hostStr = parsed.hostname || '127.0.0.1';
        pathStr = parsed.pathname || '/';
      } catch {
        const parts = target.split(':');
        portNum = parseInt(parts[parts.length - 1] ?? '80', 10);
      }
    } else {
      portNum = target;
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ port: portNum, host: hostStr });
      socket.setTimeout(timeoutMs);

      const secKey = Buffer.from('sovra-p2p-client-ws').toString('base64');

      socket.on('connect', () => {
        const upgradeReq = [
          `GET ${pathStr} HTTP/1.1`,
          `Host: ${hostStr}:${portNum}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${secKey}`,
          'Sec-WebSocket-Version: 13',
          '\r\n',
        ].join('\r\n');

        socket.write(upgradeReq);
      });

      socket.once('data', chunk => {
        const resStr = chunk.toString();
        if (resStr.includes('101 Switching Protocols')) {
          socket.setTimeout(0);
          const wsStream = new WebSocketDuplexStream(socket, false);
          resolve(wsStream);
        } else {
          socket.destroy();
          reject(new Error(`WebSocket handshake failed: ${resStr.slice(0, 100)}`));
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`WebSocket connection to ${hostStr}:${portNum} timed out after ${timeoutMs}ms`));
      });

      socket.on('error', err => reject(err));
    });
  }

  public close(): Promise<void> {
    return new Promise(resolve => {
      for (const sock of this.activeSockets) {
        try {
          sock.destroy();
        } catch {}
      }
      this.activeSockets.clear();

      if (this.server && this.isListening) {
        const srv = this.server;
        if (typeof (srv as any).closeAllConnections === 'function') {
          (srv as any).closeAllConnections();
        }
        srv.close(() => {
          this.isListening = false;
          this.server = null;
          resolve();
        });
      } else {
        this.server = null;
        this.isListening = false;
        resolve();
      }
    });
  }
}
