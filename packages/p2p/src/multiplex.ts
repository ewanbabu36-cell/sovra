import { MuxedStream, StreamFlag, StreamFrame } from './types.js';
import { StreamMultiplexError, ResourceExceededError } from './errors.js';

export class MultiplexedStream implements MuxedStream {
  private _isOpen = true;
  private dataHandlers: Array<(data: Uint8Array) => void | Promise<void>> = [];
  private closeHandlers: Array<() => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];

  constructor(
    public readonly streamId: number,
    public readonly protocolId: string,
    private readonly sendFrameFn: (frame: StreamFrame) => Promise<void>,
    private readonly onStreamClosedFn: (streamId: number) => void,
  ) {}

  public get isOpen(): boolean {
    return this._isOpen;
  }

  public async send(data: Uint8Array): Promise<void> {
    if (!this._isOpen) {
      throw new StreamMultiplexError(`Cannot send on closed stream ${this.streamId}`);
    }
    await this.sendFrameFn({
      streamId: this.streamId,
      flag: StreamFlag.DATA,
      payload: data,
    });
  }

  public async close(): Promise<void> {
    if (!this._isOpen) return;
    this._isOpen = false;
    try {
      await this.sendFrameFn({
        streamId: this.streamId,
        flag: StreamFlag.FIN,
        payload: new Uint8Array(0),
      });
    } finally {
      this.notifyClosed();
    }
  }

  public reset(reason = 'Stream reset by peer'): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    // Attempt best-effort RST frame dispatch
    this.sendFrameFn({
      streamId: this.streamId,
      flag: StreamFlag.RST,
      payload: new TextEncoder().encode(reason),
    }).catch(() => {
      // Ignored during reset
    });

    const err = new StreamMultiplexError(reason, { streamId: this.streamId });
    for (const handler of this.errorHandlers) {
      try {
        handler(err);
      } catch {
        // Prevent subscriber error from crashing stream
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
   * Internal push of incoming frame data from the multiplexer
   */
  public async _pushData(data: Uint8Array): Promise<void> {
    if (!this._isOpen) return;
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
        // Prevent subscriber error
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
        // Prevent subscriber error
      }
    }
  }
}

/**
 * Stream Multiplexer managing multiple concurrent logical streams over a peer connection.
 * Provides frame encoding/decoding, stream isolation, and max streams limit.
 */
export class StreamMultiplexer {
  private nextStreamId: number;
  private streams = new Map<number, MultiplexedStream>();
  private streamHandlers = new Map<string, (stream: MuxedStream) => void>();

  constructor(
    public readonly isInitiator: boolean,
    private readonly writeFrameFn: (rawFrameBytes: Uint8Array) => Promise<void>,
    private readonly maxStreams = 32,
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
      frame => this.sendFrame(frame),
      id => this.streams.delete(id),
    );

    this.streams.set(streamId, stream);

    // Send SYN frame with protocol ID in payload
    await this.sendFrame({
      streamId,
      flag: StreamFlag.SYN,
      payload: new TextEncoder().encode(protocolId),
    });

    return stream;
  }

  public getStream(streamId: number): MultiplexedStream | undefined {
    return this.streams.get(streamId);
  }

  /**
   * Encodes and writes a stream frame through the underlying connection
   */
  private async sendFrame(frame: StreamFrame): Promise<void> {
    const header = new Uint8Array(9);
    const view = new DataView(header.buffer, header.byteOffset, 9);
    view.setUint32(0, frame.streamId, false);
    view.setUint8(4, frame.flag);
    view.setUint32(5, frame.payload.length, false);

    const fullFrame = new Uint8Array(9 + frame.payload.length);
    fullFrame.set(header, 0);
    fullFrame.set(frame.payload, 9);

    await this.writeFrameFn(fullFrame);
  }

  /**
   * Receives and processes raw frame bytes from the underlying connection
   */
  public async receiveRawBytes(rawFrameBytes: Uint8Array): Promise<void> {
    if (rawFrameBytes.length < 9) {
      throw new StreamMultiplexError('Malformed frame: length less than header size', {
        length: rawFrameBytes.length,
      });
    }

    const view = new DataView(rawFrameBytes.buffer, rawFrameBytes.byteOffset, 9);
    const streamId = view.getUint32(0, false);
    const flag = view.getUint8(4) as StreamFlag;
    const payloadLength = view.getUint32(5, false);

    if (rawFrameBytes.length < 9 + payloadLength) {
      throw new StreamMultiplexError('Malformed frame: truncated payload', {
        expected: 9 + payloadLength,
        received: rawFrameBytes.length,
      });
    }

    const payload = rawFrameBytes.subarray(9, 9 + payloadLength);

    if (flag === StreamFlag.SYN) {
      if (this.streams.size >= this.maxStreams) {
        // Send reset for stream exceeding capacity without breaking connection
        await this.sendFrame({
          streamId,
          flag: StreamFlag.RST,
          payload: new TextEncoder().encode('Max streams exceeded'),
        });
        return;
      }

      const protocolId = new TextDecoder().decode(payload);
      const incomingStream = new MultiplexedStream(
        streamId,
        protocolId,
        f => this.sendFrame(f),
        id => this.streams.delete(id),
      );
      this.streams.set(streamId, incomingStream);

      const handler = this.streamHandlers.get(protocolId);
      if (handler) {
        handler(incomingStream);
      } else {
        // Unknown protocol, reset this stream
        incomingStream.reset(`Unsupported protocol: ${protocolId}`);
      }
      return;
    }

    const stream = this.streams.get(streamId);
    if (!stream) {
      // Stream not found or already closed; ignore or drop safely
      return;
    }

    if (flag === StreamFlag.DATA) {
      await stream._pushData(payload);
    } else if (flag === StreamFlag.FIN) {
      stream._handleRemoteClose();
    } else if (flag === StreamFlag.RST) {
      const reason = payload.length > 0 ? new TextDecoder().decode(payload) : undefined;
      stream._handleRemoteReset(reason);
    }
  }

  public closeAll(): void {
    for (const stream of this.streams.values()) {
      stream.reset('Multiplexer closed');
    }
    this.streams.clear();
  }
}
