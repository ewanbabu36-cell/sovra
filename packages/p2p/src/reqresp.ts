import { Result, ok, err } from '@sovra/shared';
import { secureRandomBytes, bytesToHex, hexToBytes } from '@sovra/crypto';
import { RequestResponseProtocol } from './types.js';
import { RequestTimeoutError, ResourceExceededError, P2PError } from './errors.js';

export interface WireRequest {
  readonly requestId: string;
  readonly protocolId: string;
  readonly payloadHex: string;
  readonly timestamp: number;
}

export interface WireResponse {
  readonly requestId: string;
  readonly success: boolean;
  readonly payloadHex?: string;
  readonly error?: string;
}

export interface RequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly retries?: number;
  readonly backoffBaseMs?: number;
}

export class RequestResponseManager implements RequestResponseProtocol {
  private handlers = new Map<
    string,
    (peerId: string, request: Uint8Array) => Promise<Uint8Array>
  >();
  private pendingRequests = new Map<
    string,
    {
      resolve: (data: Uint8Array) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      peerId: string;
    }
  >();
  private activePeerRequestCounts = new Map<string, number>();

  constructor(
    private readonly sendRawFn?: (peerId: string, serializedMsg: Uint8Array) => Promise<void>,
    private readonly maxPendingRequests = 100,
    private readonly maxRequestsPerPeer = 10,
    private readonly maxPayloadBytes = 1024 * 1024, // 1MB
  ) {}

  public registerHandler(
    protocolId: string,
    handler: (peerId: string, request: Uint8Array) => Promise<Uint8Array>,
  ): void {
    this.handlers.set(protocolId, handler);
  }

  public async sendRequest(
    peerId: string,
    protocolId: string,
    request: Uint8Array,
    options?: RequestOptions,
  ): Promise<Result<Uint8Array>> {
    if (request.length > this.maxPayloadBytes) {
      return err(
        new ResourceExceededError(
          `Request payload size (${request.length} bytes) exceeds limit of ${this.maxPayloadBytes} bytes`,
        ),
      );
    }

    if (this.pendingRequests.size >= this.maxPendingRequests) {
      return err(
        new ResourceExceededError('Maximum global pending concurrent requests exceeded', {
          current: this.pendingRequests.size,
          max: this.maxPendingRequests,
        }),
      );
    }

    const currentPeerActive = this.activePeerRequestCounts.get(peerId) ?? 0;
    if (currentPeerActive >= this.maxRequestsPerPeer) {
      return err(
        new ResourceExceededError(
          `Maximum concurrent requests to peer ${peerId} exceeded (${this.maxRequestsPerPeer})`,
        ),
      );
    }

    const retries = options?.retries ?? 2;
    const timeoutMs = options?.timeoutMs ?? 5000;
    const baseBackoff = options?.backoffBaseMs ?? 100;

    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt <= retries) {
      if (options?.signal?.aborted) {
        return err(new P2PError('Request cancelled by AbortSignal', 'ERR_REQUEST_CANCELLED'));
      }

      try {
        const responseData = await this.executeSingleRequest(
          peerId,
          protocolId,
          request,
          timeoutMs,
          options?.signal,
        );
        return ok(responseData);
      } catch (errCatch) {
        lastError = errCatch instanceof Error ? errCatch : new Error(String(errCatch));
        attempt++;
        if (attempt <= retries) {
          const delay = baseBackoff * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    return err(
      new RequestTimeoutError(
        `Request to peer ${peerId} on ${protocolId} failed after ${retries + 1} attempts: ${lastError?.message}`,
      ),
    );
  }

  private executeSingleRequest(
    peerId: string,
    protocolId: string,
    request: Uint8Array,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const requestId = bytesToHex(secureRandomBytes(16));

      // Increment per-peer active counter
      const currentCount = this.activePeerRequestCounts.get(peerId) ?? 0;
      this.activePeerRequestCounts.set(peerId, currentCount + 1);

      const cleanup = () => {
        const count = this.activePeerRequestCounts.get(peerId) ?? 1;
        if (count <= 1) {
          this.activePeerRequestCounts.delete(peerId);
        } else {
          this.activePeerRequestCounts.set(peerId, count - 1);
        }
        this.pendingRequests.delete(requestId);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(
          new RequestTimeoutError(`Request ${requestId} timed out after ${timeoutMs}ms`, {
            requestId,
            peerId,
          }),
        );
      }, timeoutMs);

      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          cleanup();
          reject(new P2PError('Request aborted by caller', 'ERR_REQUEST_ABORTED'));
        });
      }

      this.pendingRequests.set(requestId, {
        resolve: data => {
          cleanup();
          resolve(data);
        },
        reject: err => {
          cleanup();
          reject(err);
        },
        timer,
        peerId,
      });

      const wireReq: WireRequest = {
        requestId,
        protocolId,
        payloadHex: bytesToHex(request),
        timestamp: Date.now(),
      };
      const encoded = new TextEncoder().encode(JSON.stringify(wireReq));

      if (this.sendRawFn) {
        this.sendRawFn(peerId, encoded).catch(errSend => {
          clearTimeout(timer);
          cleanup();
          reject(errSend);
        });
      } else {
        const handler = this.handlers.get(protocolId);
        if (!handler) {
          clearTimeout(timer);
          cleanup();
          reject(new P2PError(`Protocol handler not found for ${protocolId}`));
          return;
        }

        handler(peerId, request)
          .then(res => {
            clearTimeout(timer);
            cleanup();
            resolve(res);
          })
          .catch(errHandler => {
            clearTimeout(timer);
            cleanup();
            reject(errHandler);
          });
      }
    });
  }

  /**
   * Dispatches incoming serialized request or response bytes
   */
  public async handleInboundMessage(
    fromPeerId: string,
    rawBytes: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(rawBytes));

      // Handle response to a pending request
      if (parsed.requestId && parsed.success !== undefined) {
        const wireRes = parsed as WireResponse;
        const pending = this.pendingRequests.get(wireRes.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          if (wireRes.success && wireRes.payloadHex) {
            pending.resolve(hexToBytes(wireRes.payloadHex));
          } else {
            pending.reject(new P2PError(wireRes.error ?? 'Remote peer returned error'));
          }
        }
        return undefined;
      }

      // Handle inbound request
      if (parsed.requestId && parsed.protocolId && parsed.payloadHex) {
        const wireReq = parsed as WireRequest;
        const handler = this.handlers.get(wireReq.protocolId);
        const reqPayload = hexToBytes(wireReq.payloadHex);

        if (!handler) {
          const response: WireResponse = {
            requestId: wireReq.requestId,
            success: false,
            error: `Protocol not supported: ${wireReq.protocolId}`,
          };
          return new TextEncoder().encode(JSON.stringify(response));
        }

        try {
          const resPayload = await handler(fromPeerId, reqPayload);
          const response: WireResponse = {
            requestId: wireReq.requestId,
            success: true,
            payloadHex: bytesToHex(resPayload),
          };
          return new TextEncoder().encode(JSON.stringify(response));
        } catch (handlerErr) {
          const response: WireResponse = {
            requestId: wireReq.requestId,
            success: false,
            error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
          };
          return new TextEncoder().encode(JSON.stringify(response));
        }
      }
    } catch {
      // Malformed json safely ignored
    }
    return undefined;
  }
}
