import { MuxedStream } from './types.js';
import { StreamMultiplexError, ResourceExceededError } from './errors.js';

// =========================================================================
// YAMUX SPECIFICATION COMPATIBLE MULTIPLEXING ENGINE
// Header layout (12 Bytes Big-Endian):
// [ Version (1B) | Type (1B) | Flags (2B) | Stream ID (4B) | Length (4B) ]
// =========================================================================

export const YAMUX_VERSION = 0;

export enum YamuxType {
  DATA = 0,
  WINDOW_UPDATE = 1,
  PING = 2,
  GO_AWAY = 3,
}

export enum YamuxFlag {
  NONE = 0,
  SYN = 1,
  ACK = 2,
  FIN = 4,
  RST = 8,
}

export const DEFAULT_INITIAL_WINDOW_SIZE = 1024 * 1024; // 1 MB credit
export const MAX_STREAM_WINDOW_SIZE = 16 * 1024 * 1024; // 16 MB max

export interface YamuxHeader {
  readonly version: number;
  readonly type: YamuxType;
  readonly flags: number;
  readonly streamId: number;
  readonly length: number;
}

export interface YamuxFrame {
  readonly header: YamuxHeader;
  readonly payload: Uint8Array;
}

/**
 * Encodes a 12-byte Yamux frame header followed by payload.
 */
export function encodeYamuxFrame(
  type: YamuxType,
  flags: number,
  streamId: number,
  lengthOrData: number | Uint8Array,
): Uint8Array {
  const payload = typeof lengthOrData === 'number' ? new Uint8Array(0) : lengthOrData;
  const lengthVal = typeof lengthOrData === 'number' ? lengthOrData : payload.length;

  const frameBytes = new Uint8Array(12 + payload.length);
  const view = new DataView(frameBytes.buffer, frameBytes.byteOffset, 12);
  view.setUint8(0, YAMUX_VERSION);
  view.setUint8(1, type);
  view.setUint16(2, flags, false);
  view.setUint32(4, streamId, false);
  view.setUint32(8, lengthVal, false);

  if (payload.length > 0) {
    frameBytes.set(payload, 12);
  }
  return frameBytes;
}

/**
 * Decodes a 12-byte Yamux frame header.
 */
export function decodeYamuxHeader(bytes: Uint8Array): YamuxHeader {
  if (bytes.length < 12) {
    throw new StreamMultiplexError('Buffer too small for 12-byte Yamux header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, 12);
  return {
    version: view.getUint8(0),
    type: view.getUint8(1) as YamuxType,
    flags: view.getUint16(2, false),
    streamId: view.getUint32(4, false),
    length: view.getUint32(8, false),
  };
}

/**
 * Logical multiplexed bidirectional stream implementing Yamux credit flow control.
 */
export class MultiplexedStream implements MuxedStream {
  private _isOpen = true;
  private sendWindow = DEFAULT_INITIAL_WINDOW_SIZE;
  private recvWindow = DEFAULT_INITIAL_WINDOW_SIZE;
  private windowWaiters: Array<{ bytes: number; resolve: () => void }> = [];

  private dataHandlers: Array<(data: Uint8Array) => void | Promise<void>> = [];
  private closeHandlers: Array<() => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];

  constructor(
    public readonly streamId: number,
    public readonly protocolId: string,
    private readonly sendFrameFn: (frameBytes: Uint8Array) => Promise<void>,
    private readonly onStreamClosedFn: (streamId: number) => void,
  ) {}

  public get isOpen(): boolean {
    return this._isOpen;
  }

  public get currentSendWindow(): number {
    return this.sendWindow;
  }

  public get currentRecvWindow(): number {
    return this.recvWindow;
  }

  /**
   * Sends data over the stream, respecting flow control credit.
   * If send window is insufficient, suspends until WINDOW_UPDATE arrives.
   */
  public async send(data: Uint8Array): Promise<void> {
    if (!this._isOpen) {
      throw new StreamMultiplexError(`Cannot send on closed stream ${this.streamId}`);
    }

    let offset = 0;
    while (offset < data.length) {
      if (this.sendWindow <= 0) {
        // Wait for window credit
        await new Promise<void>(resolve => {
          this.windowWaiters.push({ bytes: data.length - offset, resolve });
        });
      }

      const chunkSize = Math.min(data.length - offset, this.sendWindow, 65536);
      const chunk = data.subarray(offset, offset + chunkSize);
      this.sendWindow -= chunkSize;
      offset += chunkSize;

      const frame = encodeYamuxFrame(YamuxType.DATA, YamuxFlag.NONE, this.streamId, chunk);
      await this.sendFrameFn(frame);
    }
  }

  public async close(): Promise<void> {
    if (!this._isOpen) return;
    this._isOpen = false;
    try {
      const finFrame = encodeYamuxFrame(YamuxType.DATA, YamuxFlag.FIN, this.streamId, 0);
      await this.sendFrameFn(finFrame);
    } finally {
      this.notifyClosed();
    }
  }

  public reset(reason = 'Stream reset by peer'): void {
    if (!this._isOpen) return;
    this._isOpen = false;

    // Send RST frame
    const rstFrame = encodeYamuxFrame(
      YamuxType.DATA,
      YamuxFlag.RST,
      this.streamId,
      new TextEncoder().encode(reason),
    );
    this.sendFrameFn(rstFrame).catch(() => {});

    const err = new StreamMultiplexError(reason, { streamId: this.streamId });
    for (const handler of this.errorHandlers) {
      try {
        handler(err);
      } catch {
        // Suppress subscriber error
      }
    }
    this.notifyClosed();
  }

  public onData(handler: (data: Uint8Array) => void | Promise<void>): void {
    this.dataHandlers.push(handler);
  }

  public onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  public onError(handler: (err: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Internal push of incoming frame data from the multiplexer.
   * Tracks consumed receive credits and issues WINDOW_UPDATE when needed.
   */
  public async _pushData(data: Uint8Array): Promise<void> {
    if (!this._isOpen) return;

    this.recvWindow -= data.length;

    for (const handler of this.dataHandlers) {
      try {
        await handler(data);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        for (const errHandler of this.errorHandlers) {
          errHandler(error);
        }
      }
    }

    // Replenish receive window if below threshold (128 KB)
    if (this.recvWindow < DEFAULT_INITIAL_WINDOW_SIZE / 2) {
      const delta = DEFAULT_INITIAL_WINDOW_SIZE - this.recvWindow;
      this.recvWindow += delta;
      const updateFrame = encodeYamuxFrame(
        YamuxType.WINDOW_UPDATE,
        YamuxFlag.NONE,
        this.streamId,
        delta,
      );
      this.sendFrameFn(updateFrame).catch(() => {});
    }
  }

  public _handleWindowUpdate(delta: number): void {
    this.sendWindow += delta;
    if (this.sendWindow > MAX_STREAM_WINDOW_SIZE) {
      this.sendWindow = MAX_STREAM_WINDOW_SIZE;
    }

    // Wake up any pending senders waiting for credits
    while (this.windowWaiters.length > 0 && this.sendWindow > 0) {
      const waiter = this.windowWaiters.shift();
      if (waiter) {
        waiter.resolve();
      }
    }
  }

  public _handleRemoteClose(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.notifyClosed();
  }

  public _handleRemoteReset(reason?: string): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    const err = new StreamMultiplexError(reason ?? 'Stream reset by remote peer', {
      streamId: this.streamId,
    });
    for (const handler of this.errorHandlers) {
      try {
        handler(err);
      } catch {
        // Suppress subscriber error
      }
    }
    this.notifyClosed();
  }

  private notifyClosed(): void {
    this.onStreamClosedFn(this.streamId);
    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch {
        // Suppress subscriber error
      }
    }
  }
}

/**
 * Yamux Stream Multiplexer managing multiple concurrent logical streams.
 * Complies with the 12-byte Yamux specification, flow control windows, PING, and GO_AWAY.
 */
export class StreamMultiplexer {
  private nextStreamId: number;
  private streams = new Map<number, MultiplexedStream>();
  private streamHandlers = new Map<string, (stream: MuxedStream) => void>();
  private pingWaiters = new Map<number, (rttMs: number) => void>();
  private pingStartTime = new Map<number, number>();
  private isGoAwayReceived = false;

  constructor(
    public readonly isInitiator: boolean,
    private readonly writeFrameFn: (rawFrameBytes: Uint8Array) => Promise<void>,
    public readonly maxStreams = 256,
  ) {
    // Initiator uses odd stream IDs (1, 3, 5...), responder uses even stream IDs (2, 4, 6...)
    this.nextStreamId = isInitiator ? 1 : 2;
  }

  public get activeStreamCount(): number {
    return this.streams.size;
  }

  public registerProtocolHandler(protocolId: string, handler: (stream: MuxedStream) => void): void {
    this.streamHandlers.set(protocolId, handler);
  }

  public async openStream(protocolId: string): Promise<MuxedStream> {
    if (this.isGoAwayReceived) {
      throw new StreamMultiplexError('Cannot open stream: GO_AWAY received on session');
    }

    if (this.streams.size >= this.maxStreams) {
      throw new ResourceExceededError('Maximum concurrent streams per connection exceeded', {
        maxStreams: this.maxStreams,
        currentStreams: this.streams.size,
      });
    }

    const streamId = this.nextStreamId;
    this.nextStreamId += 2;

    const stream = new MultiplexedStream(
      streamId,
      protocolId,
      frame => this.writeFrameFn(frame),
      id => this.streams.delete(id),
    );

    this.streams.set(streamId, stream);

    // Send SYN frame with protocol ID in payload
    const synFrame = encodeYamuxFrame(
      YamuxType.DATA,
      YamuxFlag.SYN,
      streamId,
      new TextEncoder().encode(protocolId),
    );
    await this.writeFrameFn(synFrame);

    return stream;
  }

  public getStream(streamId: number): MultiplexedStream | undefined {
    return this.streams.get(streamId);
  }

  public getStreamByProtocol(protocolId: string): MultiplexedStream | undefined {
    for (const stream of this.streams.values()) {
      if (stream.protocolId === protocolId && stream.isOpen) {
        return stream;
      }
    }
    return undefined;
  }

  public async sendPing(pingId = Math.floor(Math.random() * 0xffffffff)): Promise<number> {
    return new Promise(resolve => {
      this.pingWaiters.set(pingId, resolve);
      this.pingStartTime.set(pingId, Date.now());

      const pingFrame = encodeYamuxFrame(YamuxType.PING, YamuxFlag.SYN, 0, pingId);
      this.writeFrameFn(pingFrame).catch(() => {
        this.pingWaiters.delete(pingId);
        this.pingStartTime.delete(pingId);
        resolve(-1);
      });
    });
  }

  public async sendGoAway(errorCode = 0): Promise<void> {
    const goAwayFrame = encodeYamuxFrame(YamuxType.GO_AWAY, YamuxFlag.NONE, 0, errorCode);
    await this.writeFrameFn(goAwayFrame);
    this.closeAll();
  }

  /**
   * Receives and processes raw frame bytes from the underlying connection.
   */
  public async receiveRawBytes(rawFrameBytes: Uint8Array): Promise<void> {
    if (rawFrameBytes.length < 12) {
      throw new StreamMultiplexError('Malformed Yamux frame: length less than 12-byte header size', {
        length: rawFrameBytes.length,
      });
    }

    const header = decodeYamuxHeader(rawFrameBytes);
    const payloadLength = header.length;

    // Handle session-level frames (streamId == 0)
    if (header.streamId === 0) {
      if (header.type === YamuxType.PING) {
        if (header.flags & YamuxFlag.SYN) {
          // Echo PING back with ACK flag
          const pongFrame = encodeYamuxFrame(YamuxType.PING, YamuxFlag.ACK, 0, header.length);
          await this.writeFrameFn(pongFrame);
        } else if (header.flags & YamuxFlag.ACK) {
          // Received PING response
          const resolver = this.pingWaiters.get(header.length);
          const start = this.pingStartTime.get(header.length);
          if (resolver && start) {
            this.pingWaiters.delete(header.length);
            this.pingStartTime.delete(header.length);
            resolver(Date.now() - start);
          }
        }
        return;
      }

      if (header.type === YamuxType.GO_AWAY) {
        this.isGoAwayReceived = true;
        this.closeAll();
        return;
      }
    }

    // Stream-level frames
    const payload = rawFrameBytes.subarray(12, 12 + payloadLength);

    if (header.type === YamuxType.WINDOW_UPDATE) {
      const stream = this.streams.get(header.streamId);
      if (stream) {
        stream._handleWindowUpdate(header.length);
      }
      return;
    }

    if (header.flags & YamuxFlag.SYN) {
      if (this.streams.size >= this.maxStreams) {
        // Send RST for stream exceeding capacity
        const rstFrame = encodeYamuxFrame(
          YamuxType.DATA,
          YamuxFlag.RST,
          header.streamId,
          new TextEncoder().encode('Max streams exceeded'),
        );
        await this.writeFrameFn(rstFrame);
        return;
      }

      const protocolId = new TextDecoder().decode(payload);
      const incomingStream = new MultiplexedStream(
        header.streamId,
        protocolId,
        f => this.writeFrameFn(f),
        id => this.streams.delete(id),
      );
      this.streams.set(header.streamId, incomingStream);

      const handler = this.streamHandlers.get(protocolId);
      if (handler) {
        handler(incomingStream);
      } else {
        incomingStream.reset(`Unsupported protocol: ${protocolId}`);
      }

      // Acknowledge stream creation with ACK flag
      const ackFrame = encodeYamuxFrame(YamuxType.DATA, YamuxFlag.ACK, header.streamId, 0);
      await this.writeFrameFn(ackFrame);
      return;
    }

    const stream = this.streams.get(header.streamId);
    if (!stream) {
      return; // Stream closed or unknown; drop safely
    }

    if (header.flags & YamuxFlag.RST) {
      const reason = payload.length > 0 ? new TextDecoder().decode(payload) : undefined;
      stream._handleRemoteReset(reason);
      return;
    }

    if (header.flags & YamuxFlag.FIN) {
      stream._handleRemoteClose();
      return;
    }

    if (header.type === YamuxType.DATA && payload.length > 0) {
      await stream._pushData(payload);
    }
  }

  public closeAll(): void {
    for (const stream of this.streams.values()) {
      stream.reset('Multiplexer session closed');
    }
    this.streams.clear();
  }
}
