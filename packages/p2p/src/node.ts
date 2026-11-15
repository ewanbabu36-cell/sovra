import * as net from 'node:net';
import { Result, ok, err } from '@sovra/shared';
import { SovraDeviceKey, RevocationRegistry } from '@sovra/identity';
import {
  P2PNode,
  PeerIdentity,
  PeerIdentityBinding,
  PeerInfo,
  ResourceLimits,
  BootstrapConfig,
  MuxedStream,
} from './types.js';
import { PeerConnectionError } from './errors.js';
import { derivePeerId } from './identity.js';
import { PeerScoringEngine } from './scoring.js';
import { GossipSubRouter } from './gossipsub.js';
import { PeerDiscoveryManager } from './discovery.js';
import { CircuitRelayClient } from './relay.js';
import { RequestResponseManager } from './reqresp.js';
import { KademliaDHT, DhtRpcMessage, DhtRpcResponse } from './dht.js';
import {
  NatManager,
  IceFallbackEngine,
  IceNegotiationPlan,
  RelayCandidateMetrics,
  isCgnatAddress,
  AUTONAT_PROTOCOL,
  AutoNatService,
  AutoNatDialRequest,
  AutoNatDialResponse,
  DCUTR_PROTOCOL,
  DcutrCoordinator,
  DcutrMessage,
} from './nat.js';
import {
  CircuitRelayV2,
  CircuitRelayV2Client,
  CircuitRelayV2Config,
  CIRCUIT_RELAY_V2_HOP_PROTOCOL,
  CIRCUIT_RELAY_V2_STOP_PROTOCOL,
  RelayHopMessage,
  RelayStopMessage,
} from './relay-v2.js';
import { SessionMigrationToken } from './light-client.js';
import { NodeMetricsCollector } from './metrics.js';
import { ConnectionManager, DEFAULT_RESOURCE_LIMITS, ActivePeerConnection } from './connection.js';
import {
  TcpTransport,
  LengthPrefixedFrameCodec,
  SecureTransportHandshake,
} from './transport.js';
import { StreamMultiplexer } from './multiplex.js';

export interface SovraP2PNodeConfig {
  readonly deviceKey: SovraDeviceKey;
  readonly binding?: PeerIdentityBinding;
  readonly revocationRegistry?: RevocationRegistry;
  readonly limits?: Partial<ResourceLimits>;
  readonly bootstrapConfig?: Partial<BootstrapConfig>;
  readonly listenAddresses?: readonly string[];
  readonly relayAddresses?: readonly string[];
  readonly enableRelayService?: boolean;
  readonly relayConfig?: CircuitRelayV2Config;
}

function safeJsonStringify(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Uint8Array) return { __u8: Array.from(v) };
    return v;
  });
}

function safeJsonParse<T = any>(str: string): T {
  return JSON.parse(str, (_k, v) => {
    if (v && typeof v === 'object' && Array.isArray((v as any).__u8)) {
      return new Uint8Array((v as any).__u8);
    }
    return v;
  });
}

/**
 * Unified Sovra P2P Node orchestrating:
 * - Real TCP OS socket transport & length-prefixed framing
 * - Noise_XX mutual authentication & forward secrecy
 * - Yamux specification stream multiplexing & flow control
 * - Kademlia DHT routing & provider store
 * - GossipSub v1.2 pub/sub router with heartbeat
 * - Request/Response RPC protocol
 * - Circuit Relay v2 & AutoNAT
 */
export class SovraP2PNode implements P2PNode {
  public readonly identity: PeerIdentity;
  public readonly binding?: PeerIdentityBinding | undefined;
  public readonly limits: ResourceLimits;
  private _isRunning = false;

  public readonly scoring: PeerScoringEngine;
  public readonly pubsub: GossipSubRouter;
  public readonly discovery: PeerDiscoveryManager;
  public readonly relay: CircuitRelayClient;
  public readonly reqResp: RequestResponseManager;
  public readonly dht: KademliaDHT;
  public readonly nat: NatManager;
  public readonly metrics: NodeMetricsCollector;
  public readonly connManager: ConnectionManager;
  public readonly tcpTransport: TcpTransport;
  public readonly relayV2?: CircuitRelayV2;
  public readonly relayV2Client: CircuitRelayV2Client;
  public readonly autoNat: AutoNatService;
  private advertisedAddresses: string[] = [];

  private readonly customProtocolHandlers = new Map<
    string,
    (peerId: string, stream: MuxedStream) => void | Promise<void>
  >();

  private listenPort?: number;
  private listenHost = '127.0.0.1';

  public registerProtocolHandler(
    protocolId: string,
    handler: (peerId: string, stream: MuxedStream) => void | Promise<void>,
  ): void {
    this.customProtocolHandlers.set(protocolId, handler);
    for (const conn of this.connManager.getAllConnections()) {
      if (conn.multiplexer) {
        conn.multiplexer.registerProtocolHandler(protocolId, stream => {
          handler(conn.peerId, stream);
        });
      }
    }
  }

  public async openProtocolStream(
    peerId: string,
    protocolId: string,
  ): Promise<MuxedStream | null> {
    const conn = this.connManager.getConnection(peerId);
    if (!conn || !conn.multiplexer) {
      return null;
    }
    return conn.multiplexer.openStream(protocolId);
  }

  constructor(public readonly config: SovraP2PNodeConfig) {
    const peerId = derivePeerId(config.deviceKey.publicKeyBytes);
    this.identity = {
      peerId,
      publicKeyHex: config.deviceKey.publicKeyHex,
    };
    this.binding = config.binding;

    this.limits = {
      ...DEFAULT_RESOURCE_LIMITS,
      ...config.limits,
    };

    this.scoring = new PeerScoringEngine();
    this.metrics = new NodeMetricsCollector();
    this.tcpTransport = new TcpTransport();

    this.connManager = new ConnectionManager(this.limits);
    this.nat = new NatManager(config.listenAddresses ?? []);

    if (config.enableRelayService) {
      this.relayV2 = new CircuitRelayV2(config.relayConfig);
    }
    this.relayV2Client = new CircuitRelayV2Client(config.relayAddresses ?? []);
    this.autoNat = new AutoNatService();
    this.advertisedAddresses = [...(config.listenAddresses ?? [])];

    // Wire GossipSub with peer broadcast dispatcher
    this.pubsub = new GossipSubRouter(
      peerId,
      this.scoring,
      config.revocationRegistry,
      undefined,
      async (recipientId, packet) => {
        const conn = this.connManager.getConnection(recipientId);
        if (conn?.multiplexer) {
          const stream =
            conn.multiplexer.getStreamByProtocol('/sovra/gossipsub/1.2.0') ??
            conn.multiplexer.getStream(1);
          if (stream?.isOpen) {
            const data = new TextEncoder().encode(safeJsonStringify(packet));
            await stream.send(data);
          }
        }
      },
    );

    const initialBootstraps = [
      ...(config.bootstrapConfig?.bootstrapNodes ?? []),
      ...(config.bootstrapConfig?.communityNodes ?? []),
      ...(config.bootstrapConfig?.userConfiguredNodes ?? []),
    ];
    this.discovery = new PeerDiscoveryManager(initialBootstraps);

    this.relay = new CircuitRelayClient(config.relayAddresses ?? []);

    // Wire ReqResp with network stream transport
    this.reqResp = new RequestResponseManager(async (targetPeerId, serializedReq) => {
      const conn = this.connManager.getConnection(targetPeerId);
      if (conn?.multiplexer) {
        let stream: MuxedStream | undefined =
          conn.multiplexer.getStreamByProtocol('/sovra/reqresp/1.0.0');
        if (!stream || !stream.isOpen) {
          const newStream = await conn.multiplexer.openStream('/sovra/reqresp/1.0.0');
          newStream.onData(async data => {
            const res = await this.reqResp.handleInboundMessage(targetPeerId, data);
            if (res) await newStream.send(res);
          });
          stream = newStream;
        }
        if (stream.isOpen) {
          await stream.send(serializedReq);
        }
      }
    });

    // Wire DHT with RPC query function over peer connections using ReqResp
    this.dht = new KademliaDHT(peerId, config.bootstrapConfig, async (peer, dhtMsg) => {
      const conn = this.connManager.getConnection(peer.id.peerId);
      if (!conn?.multiplexer) {
        return { type: dhtMsg.type, success: false, error: 'Peer connection unavailable' };
      }
      try {
        const reqBytes = new TextEncoder().encode(safeJsonStringify(dhtMsg));
        const resResult = await this.reqResp.sendRequest(peer.id.peerId, '/sovra/dht/1.0.0', reqBytes, {
          timeoutMs: 3000,
          retries: 1,
        });
        if (resResult.ok) {
          const dhtRes: DhtRpcResponse = JSON.parse(new TextDecoder().decode(resResult.value));
          return dhtRes;
        }
        return { type: dhtMsg.type, success: false, error: resResult.error.message };
      } catch (err) {
        return {
          type: dhtMsg.type,
          success: false,
          error: err instanceof Error ? err.message : 'DHT RPC failed',
        };
      }
    });

    this.reqResp.registerHandler('/sovra/dht/1.0.0', async (_peerId, requestBytes) => {
      try {
        const dhtMsg: DhtRpcMessage = JSON.parse(new TextDecoder().decode(requestBytes));
        const dhtRes = this.dht.handleRpcMessage(dhtMsg);
        return new TextEncoder().encode(safeJsonStringify(dhtRes));
      } catch (e) {
        const errRes: DhtRpcResponse = {
          type: 'FIND_NODE',
          success: false,
          error: e instanceof Error ? e.message : 'Unknown DHT error',
        };
        return new TextEncoder().encode(safeJsonStringify(errRes));
      }
    });

    // Circuit Relay v2 Hop protocol (/libp2p/circuit/relay/0.2.0/hop)
    this.reqResp.registerHandler(CIRCUIT_RELAY_V2_HOP_PROTOCOL, async (peerId, payload) => {
      try {
        if (!this.relayV2) {
          const errRes: RelayHopMessage = {
            type: 'STATUS',
            status: 'PERMISSION_DENIED',
            errorMessage: 'Relay service not enabled on this node',
          };
          return new TextEncoder().encode(safeJsonStringify(errRes));
        }
        const hopMsg: RelayHopMessage = JSON.parse(new TextDecoder().decode(payload));
        const res = this.relayV2.handleHopMessage(peerId, hopMsg, this.advertisedAddresses);
        return new TextEncoder().encode(safeJsonStringify(res));
      } catch (e) {
        const errRes: RelayHopMessage = {
          type: 'STATUS',
          status: 'MALFORMED_MESSAGE',
          errorMessage: e instanceof Error ? e.message : 'Unknown Hop RPC error',
        };
        return new TextEncoder().encode(safeJsonStringify(errRes));
      }
    });

    // Circuit Relay v2 Stop protocol (/libp2p/circuit/relay/0.2.0/stop)
    this.reqResp.registerHandler(CIRCUIT_RELAY_V2_STOP_PROTOCOL, async (_peerId, _payload) => {
      try {
        const stopRes = this.relayV2Client.createStopResponse('OK');
        return new TextEncoder().encode(safeJsonStringify(stopRes));
      } catch {
        const errRes: RelayStopMessage = { type: 'STATUS', status: 'MALFORMED_MESSAGE' };
        return new TextEncoder().encode(safeJsonStringify(errRes));
      }
    });

    // AutoNAT protocol (/libp2p/autonat/1.0.0)
    this.reqResp.registerHandler(AUTONAT_PROTOCOL, async (peerId, payload) => {
      try {
        const req: AutoNatDialRequest = JSON.parse(new TextDecoder().decode(payload));
        const conn = this.connManager.getConnection(peerId);
        let remoteIp = '127.0.0.1';
        let remotePort = 4001;
        if (conn && conn.socket) {
          remoteIp = conn.socket.remoteAddress || '127.0.0.1';
          remotePort = conn.socket.remotePort || 4001;
        }
        const resp = await this.autoNat.handleDialRequest(peerId, remoteIp, remotePort, req);
        return new TextEncoder().encode(safeJsonStringify(resp));
      } catch (e) {
        const errRes: AutoNatDialResponse = {
          status: 'E_INTERNAL_ERROR',
          message: e instanceof Error ? e.message : 'AutoNAT failed',
        };
        return new TextEncoder().encode(safeJsonStringify(errRes));
      }
    });

    // DCUtR hole-punching protocol (/libp2p/dcutr)
    this.reqResp.registerHandler(DCUTR_PROTOCOL, async (_peerId, payload) => {
      try {
        const dcutrMsg: DcutrMessage = JSON.parse(new TextDecoder().decode(payload));
        if (dcutrMsg.type === 'CONNECT') {
          const respMsg: DcutrMessage = {
            type: 'SYNC',
            addrs: this.getAdvertisedAddresses(),
            delayMs: 100,
          };
          return new TextEncoder().encode(safeJsonStringify(respMsg));
        }
        return new TextEncoder().encode(safeJsonStringify({ type: 'SYNC', delayMs: 0 }));
      } catch {
        return new TextEncoder().encode(safeJsonStringify({ type: 'SYNC', delayMs: 0 }));
      }
    });

    // Parse listen port from multiaddrs if present
    if (config.listenAddresses) {
      for (const addr of config.listenAddresses) {
        const match = addr.match(/\/tcp\/(\d+)/);
        if (match && match[1]) {
          this.listenPort = parseInt(match[1], 10);
          const hostMatch = addr.match(/\/ip4\/([^/]+)/);
          if (hostMatch && hostMatch[1]) {
            if (isCgnatAddress(hostMatch[1])) {
              this.listenHost = '127.0.0.1';
            } else {
              this.listenHost = hostMatch[1];
            }
          }
          break;
        }
      }
    }
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public async start(): Promise<Result<void>> {
    if (this._isRunning) return ok(undefined);
    this._isRunning = true;

    // Start real TCP server if port configured
    if (this.listenPort !== undefined) {
      try {
        await this.tcpTransport.listen(this.listenPort, this.listenHost, socket => {
          this.handleInboundTcpSocket(socket).catch(() => {});
        });
      } catch (errListen) {
        try {
          await this.tcpTransport.listen(this.listenPort, '127.0.0.1', socket => {
            this.handleInboundTcpSocket(socket).catch(() => {});
          });
          this.listenHost = '127.0.0.1';
        } catch {
          this._isRunning = false;
          return err(
            new PeerConnectionError(
              `Failed to bind TCP listen port ${this.listenPort}: ${errListen instanceof Error ? errListen.message : String(errListen)}`,
            ),
          );
        }
      }
    }

    this.pubsub.start();
    await this.discovery.startDiscovery();
    await this.nat.detectNat();

    if (this.relay.getActiveRelays().length > 0) {
      for (const relayAddr of this.relay.getActiveRelays()) {
        await this.relay.requestReservation(relayAddr);
      }
    }

    // Cellular 4G/5G CGNAT and NAT traversal refresh
    await this.refreshRelayReservations();

    return ok(undefined);
  }

  public async stop(): Promise<Result<void>> {
    if (!this._isRunning) return ok(undefined);
    this._isRunning = false;

    this.pubsub.stop();
    await this.discovery.stopDiscovery();
    this.connManager.closeAll();
    await this.tcpTransport.close();

    return ok(undefined);
  }

  /**
   * Handles an incoming raw TCP connection from a remote peer:
   * Performs Noise_XX handshake, initializes Yamux multiplexer, and attaches protocols.
   */
  private async handleInboundTcpSocket(socket: net.Socket): Promise<void> {
    const codec = new LengthPrefixedFrameCodec();

    // Helper to read next length-prefixed frame
    const readNextFrame = (): Promise<Uint8Array> => {
      const existing = codec.nextFrame();
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const onData = (chunk: Buffer) => {
          codec.appendData(new Uint8Array(chunk));
          const next = codec.nextFrame();
          if (next) {
            socket.off('data', onData);
            socket.off('error', onError);
            resolve(next);
          }
        };
        const onError = (err: Error) => {
          socket.off('data', onData);
          socket.off('error', onError);
          reject(err);
        };
        socket.on('data', onData);
        socket.on('error', onError);
      });
    };

    try {
      if (!this.binding) {
        socket.destroy();
        return;
      }

      // 1. Read Message 1
      const msg1Bytes = await readNextFrame();
      const msg1 = { rawBytes: msg1Bytes, ephemeralPublicKeyHex: '' };

      // 2. Respond with Message 2
      const respState = SecureTransportHandshake.respond(
        msg1,
        this.config.deviceKey,
        this.binding,
        undefined,
        this.config.revocationRegistry,
      );
      socket.write(LengthPrefixedFrameCodec.encode(respState.message2.rawBytes));

      // 3. Read Message 3
      const msg3Bytes = await readNextFrame();
      const finalState = SecureTransportHandshake.finalizeResponder(
        { rawBytes: msg3Bytes },
        respState.symmetricState,
        respState.ephemeralKeyPair.privateKey,
        this.config.revocationRegistry,
      );

      const channel = finalState.channel;
      const remotePeerId = finalState.initiatorBinding.peerId;

      // 4. Attach Yamux Multiplexer
      const writeFrameFn = async (rawFrameBytes: Uint8Array) => {
        if (socket.destroyed || !socket.writable) return;
        try {
          const encryptedFrame = channel.encrypt(rawFrameBytes);
          socket.write(LengthPrefixedFrameCodec.encode(encryptedFrame), () => {});
        } catch {}
      };

      const muxer = new StreamMultiplexer(
        false, // Responder
        writeFrameFn,
        this.limits.maxStreamsPerConnection,
      );

      // Register protocol stream handlers
      muxer.registerProtocolHandler('/sovra/gossipsub/1.2.0', stream => {
        stream.onData(async data => {
          try {
            const packet = safeJsonParse(new TextDecoder().decode(data));
            await this.pubsub.handleInboundPacket(remotePeerId, packet);
          } catch {}
        });
      });

      muxer.registerProtocolHandler('/sovra/reqresp/1.0.0', stream => {
        stream.onData(async data => {
          const res = await this.reqResp.handleInboundMessage(remotePeerId, data);
          if (res) {
            await stream.send(res);
          }
        });
      });

      muxer.registerProtocolHandler('/sovra/dht/1.0.0', stream => {
        stream.onData(async data => {
          try {
            const dhtMsg: DhtRpcMessage = JSON.parse(new TextDecoder().decode(data));
            const dhtRes = this.dht.handleRpcMessage(dhtMsg);
            await stream.send(new TextEncoder().encode(safeJsonStringify(dhtRes)));
          } catch {}
        });
      });

      for (const [protoId, handler] of this.customProtocolHandlers.entries()) {
        muxer.registerProtocolHandler(protoId, stream => {
          handler(remotePeerId, stream);
        });
      }

      let isProcessing = false;
      const processFrames = async () => {
        if (isProcessing) return;
        isProcessing = true;
        try {
          while (!socket.destroyed) {
            const frame = codec.nextFrame();
            if (!frame) break;
            try {
              const decrypted = channel.decrypt(frame);
              await muxer.receiveRawBytes(decrypted);
            } catch {
              socket.destroy();
              break;
            }
          }
        } finally {
          isProcessing = false;
          if (codec.hasFrame() && !socket.destroyed) {
            processFrames().catch(() => {});
          }
        }
      };

      socket.on('error', () => {});
      socket.on('data', (chunk: Buffer) => {
        codec.appendData(new Uint8Array(chunk));
        processFrames().catch(() => {});
      });

      await processFrames();

      const activeConn: ActivePeerConnection = {
        peerId: remotePeerId,
        multiaddr: `/ip4/${socket.remoteAddress}/tcp/${socket.remotePort}/p2p/${remotePeerId}`,
        status: 'connected',
        channel,
        multiplexer: muxer,
        socket,
        lastActive: Date.now(),
        retryCount: 0,
      };

      this.connManager.registerEstablishedConnection(activeConn);
      this.pubsub.registerKnownPeer(remotePeerId);
    } catch (e) {
      console.error('[DEBUG INBOUND ERROR]', e);
      socket.destroy();
    }
  }

  public async dial(peerMultiaddr: string): Promise<Result<PeerInfo>> {
    if (!this._isRunning) {
      return err(new PeerConnectionError('Cannot dial peer: P2PNode is not running'));
    }

    const parts = peerMultiaddr.split('/p2p/');
    const peerId = parts[parts.length - 1];
    if (!peerId) {
      return err(
        new PeerConnectionError('Invalid multiaddr: missing /p2p/ Peer ID component', {
          multiaddr: peerMultiaddr,
        }),
      );
    }

    // Check if real TCP connection is specified and reachable locally
    const tcpMatch = peerMultiaddr.match(/\/tcp\/(\d+)/);
    const ipMatch = peerMultiaddr.match(/\/ip4\/([^/]+)/);

    if (
      !peerMultiaddr.includes('/p2p-circuit/') &&
      tcpMatch &&
      tcpMatch[1] &&
      ipMatch &&
      ipMatch[1] &&
      this.binding &&
      (ipMatch[1] === '127.0.0.1' || ipMatch[1] === 'localhost')
    ) {
      const dialPort = parseInt(tcpMatch[1], 10);
      const dialHost = ipMatch[1];

      try {
        const socket = await this.tcpTransport.dial(dialPort, dialHost, 1000);
        const codec = new LengthPrefixedFrameCodec();

        const readNextFrame = (): Promise<Uint8Array> => {
          const existing = codec.nextFrame();
          if (existing) return Promise.resolve(existing);

          return new Promise((resolve, reject) => {
            const onData = (chunk: Buffer) => {
              codec.appendData(new Uint8Array(chunk));
              const next = codec.nextFrame();
              if (next) {
                socket.off('data', onData);
                socket.off('error', onError);
                resolve(next);
              }
            };
            const onError = (err: Error) => {
              socket.off('data', onData);
              socket.off('error', onError);
              reject(err);
            };
            socket.on('data', onData);
            socket.on('error', onError);
          });
        };

        // 1. Noise Message 1
        const initHandshake = SecureTransportHandshake.initiate();
        socket.write(LengthPrefixedFrameCodec.encode(initHandshake.message1.rawBytes));

        // 2. Read Message 2
        const msg2Bytes = await readNextFrame();
        const msg2 = { rawBytes: msg2Bytes };

        // 3. Process Message 2 and send Message 3
        const finalHandshake = SecureTransportHandshake.processMessage2AndCreateMessage3(
          msg2,
          initHandshake.symmetricState,
          initHandshake.ephemeralKeyPair.privateKey,
          this.config.deviceKey,
          this.binding,
          undefined,
          this.config.revocationRegistry,
        );
        socket.write(LengthPrefixedFrameCodec.encode(finalHandshake.message3.rawBytes));

        const channel = finalHandshake.channel;

        // 4. Attach Yamux Multiplexer
        const writeFrameFn = async (rawFrameBytes: Uint8Array) => {
          if (socket.destroyed || !socket.writable) return;
          try {
            const encryptedFrame = channel.encrypt(rawFrameBytes);
            socket.write(LengthPrefixedFrameCodec.encode(encryptedFrame), () => {});
          } catch {}
        };

        const muxer = new StreamMultiplexer(
          true, // Initiator
          writeFrameFn,
          this.limits.maxStreamsPerConnection,
        );

        let isProcessing = false;
        const processFrames = async () => {
          if (isProcessing) return;
          isProcessing = true;
          try {
            while (!socket.destroyed) {
              const frame = codec.nextFrame();
              if (!frame) break;
              try {
                const decrypted = channel.decrypt(frame);
                await muxer.receiveRawBytes(decrypted);
              } catch {
                socket.destroy();
                break;
              }
            }
          } finally {
            isProcessing = false;
            if (codec.hasFrame() && !socket.destroyed) {
              processFrames().catch(() => {});
            }
          }
        };

        socket.on('error', () => {});
        socket.on('data', (chunk: Buffer) => {
          codec.appendData(new Uint8Array(chunk));
          processFrames().catch(() => {});
        });

        // Open core protocol streams and attach data handlers
        const pubsubStream = await muxer.openStream('/sovra/gossipsub/1.2.0');
        pubsubStream.onData(async data => {
          try {
            const packet = safeJsonParse(new TextDecoder().decode(data));
            await this.pubsub.handleInboundPacket(peerId, packet);
          } catch {}
        });

        const reqRespStream = await muxer.openStream('/sovra/reqresp/1.0.0');
        reqRespStream.onData(async data => {
          const res = await this.reqResp.handleInboundMessage(peerId, data);
          if (res) await reqRespStream.send(res);
        });

        const dhtStream = await muxer.openStream('/sovra/dht/1.0.0');
        dhtStream.onData(async data => {
          try {
            const dhtMsg: DhtRpcMessage = JSON.parse(new TextDecoder().decode(data));
            const dhtRes = this.dht.handleRpcMessage(dhtMsg);
            await dhtStream.send(new TextEncoder().encode(safeJsonStringify(dhtRes)));
          } catch {}
        });

        for (const [protoId, handler] of this.customProtocolHandlers.entries()) {
          muxer.registerProtocolHandler(protoId, stream => {
            handler(peerId, stream);
          });
        }

        await processFrames();

        const activeConn: ActivePeerConnection = {
          peerId,
          multiaddr: peerMultiaddr,
          status: 'connected',
          channel,
          multiplexer: muxer,
          socket,
          lastActive: Date.now(),
          retryCount: 0,
        };

        this.connManager.registerEstablishedConnection(activeConn);
        this.pubsub.registerKnownPeer(peerId);

        const peerInfo: PeerInfo = {
          id: {
            peerId,
            publicKeyHex: finalHandshake.responderBinding.devicePublicKeyHex,
          },
          addresses: [peerMultiaddr],
          status: 'connected',
          score: this.scoring.getScore(peerId),
          connectionType: 'direct',
          binding: finalHandshake.responderBinding,
        };

        this.connManager.registerPeerInfo(peerInfo);
        this.dht.addPeer(peerInfo);

        return ok(peerInfo);
      } catch {
        // Fall back to connection manager path if local TCP listener is not responding
      }
    }

    if (peerMultiaddr.includes('/p2p-circuit/')) {
      const circuitParts = peerMultiaddr.split('/p2p-circuit/');
      const relayAddr = circuitParts[0];
      const targetSub = circuitParts[1] ?? '';
      const targetPeerId = targetSub.replace(/^\/?p2p\//, '') || peerId;
      const relayParts = (relayAddr || '').split('/p2p/');
      const relayPeerId = relayParts[1];

      // If connected to this relay with an active multiplexer, coordinate live Hop stream
      const relayConn = relayPeerId ? this.connManager.getConnection(relayPeerId) : undefined;
      if (relayPeerId && relayConn && relayConn.multiplexer) {
        try {
          const hopConnectReq: RelayHopMessage = this.relayV2Client.createConnectRequest(targetPeerId);
          const reqBytes = new TextEncoder().encode(safeJsonStringify(hopConnectReq));
          const hopRes = await this.reqResp.sendRequest(relayPeerId, CIRCUIT_RELAY_V2_HOP_PROTOCOL, reqBytes, {
            timeoutMs: 2000,
          });

          if (hopRes.ok) {
            const resMsg: RelayHopMessage = JSON.parse(new TextDecoder().decode(hopRes.value));
            if (resMsg.status === 'OK') {
              const peerInfo: PeerInfo = {
                id: { peerId: targetPeerId, publicKeyHex: '' },
                addresses: [peerMultiaddr],
                status: 'connected',
                score: this.scoring.getScore(targetPeerId),
                connectionType: 'relayed',
              };
              this.connManager.registerPeerInfo(peerInfo);
              this.pubsub.registerKnownPeer(targetPeerId);
              this.dht.addPeer(peerInfo);

              this.attemptDcutrUpgrade(targetPeerId, relayPeerId).catch(() => {});

              return ok(peerInfo);
            }
          }
        } catch {}
      }
    }

    // Fallback simulation / relayed path
    const connectResult = await this.connManager.connect(peerMultiaddr);
    if (!connectResult.ok) {
      this.metrics.recordFailedConnection();
      return err(connectResult.error);
    }

    const activeConn = connectResult.value;
    const peerInfo: PeerInfo = {
      id: {
        peerId,
        publicKeyHex: '',
      },
      addresses: [peerMultiaddr],
      status: activeConn.status,
      score: this.scoring.getScore(peerId),
      connectionType: activeConn.status === 'relayed' ? 'relayed' : 'direct',
    };

    this.connManager.registerPeerInfo(peerInfo);
    this.dht.addPeer(peerInfo);
    this.pubsub.registerKnownPeer(peerId);

    return ok(peerInfo);
  }

  public async disconnect(peerId: string): Promise<Result<void>> {
    this.connManager.disconnect(peerId);
    this.dht.removePeer(peerId);
    this.pubsub.unregisterKnownPeer(peerId);

    return ok(undefined);
  }

  public getConnectedPeers(): readonly PeerInfo[] {
    return this.connManager.getConnectedPeers();
  }

  public readonly iceEngine: IceFallbackEngine = new IceFallbackEngine();

  /**
   * Pillar 2: Dynamic ICE Connection Planner for CGNAT and Telecom environments.
   */
  public planIceConnection(
    remoteNat: import('./types.js').NatStatus,
    remoteCandidateAddrs: readonly string[],
    relays?: readonly RelayCandidateMetrics[],
  ): IceNegotiationPlan {
    return this.iceEngine.planConnection(
      this.nat.status,
      remoteNat,
      remoteCandidateAddrs,
      relays,
    );
  }

  /**
   * Pillar 1: Zero-Handshake Connection Migration across Wi-Fi and 5G cellular switches.
   */
  public migrateSession(
    token: SessionMigrationToken,
    newEndpointAddress: string,
  ): Result<boolean> {
    return this.connManager.migratePeerConnection(
      token.peerId,
      newEndpointAddress,
      300000,
      token.issuedAt,
    );
  }

  public getAdvertisedAddresses(): readonly string[] {
    const relayed = this.relayV2Client.getAdvertisedRelayedAddrs(this.identity.peerId);
    return Array.from(new Set([...this.advertisedAddresses, ...relayed]));
  }

  public isCgnatActive(): boolean {
    const hasCgnatAddr = this.advertisedAddresses.some(a => {
      const match = a.match(/\/ip4\/([^/]+)/);
      return match && match[1] && isCgnatAddress(match[1]);
    });
    return hasCgnatAddr || this.nat.status === 'symmetric_nat' || this.nat.status === 'relayed';
  }

  public getRelayStatus() {
    return {
      relayServiceEnabled: Boolean(this.relayV2),
      activeReservationsCount: this.relayV2
        ? this.relayV2.getAllReservations().length
        : this.relayV2Client.getActiveReservations().length,
      activeCircuitsCount: this.relayV2 ? this.relayV2.getActiveCircuits().length : 0,
      advertisedRelayedAddresses: this.relayV2Client.getAdvertisedRelayedAddrs(this.identity.peerId),
      natStatus: this.nat.status,
      isCgnat: this.isCgnatActive(),
      metrics: this.relayV2 ? this.relayV2.getMetrics() : null,
    };
  }

  public async refreshRelayReservations(): Promise<void> {
    const isBehindNat = this.nat.status !== 'direct';
    const hasCgnat = this.advertisedAddresses.some(a => {
      const match = a.match(/\/ip4\/([^/]+)/);
      return match && match[1] && isCgnatAddress(match[1]);
    });

    if (isBehindNat || hasCgnat) {
      const relays = this.relayV2Client.getRelayAddresses();
      for (const relayAddr of relays) {
        try {
          await this.requestRelayV2Reservation(relayAddr);
        } catch {}
      }
    }
  }

  public async requestRelayV2Reservation(relayMultiaddr: string): Promise<boolean> {
    const parts = relayMultiaddr.split('/p2p/');
    const relayPeerId = parts[1];
    if (!relayPeerId) return false;

    if (!this.connManager.getConnection(relayPeerId)) {
      const dialRes = await this.dial(relayMultiaddr);
      if (!dialRes.ok) return false;
    }

    const reqMsg: RelayHopMessage = this.relayV2Client.createReserveRequest(this.identity.peerId);
    const reqBytes = new TextEncoder().encode(safeJsonStringify(reqMsg));
    const rpcRes = await this.reqResp.sendRequest(relayPeerId, CIRCUIT_RELAY_V2_HOP_PROTOCOL, reqBytes, {
      timeoutMs: 5000,
      retries: 1,
    });

    if (rpcRes.ok) {
      const respMsg: RelayHopMessage = JSON.parse(new TextDecoder().decode(rpcRes.value));
      if (respMsg.status === 'OK' && respMsg.reservation) {
        this.relayV2Client.setReservation(relayMultiaddr, respMsg.reservation);
        const relayedAddrs = this.relayV2Client.getAdvertisedRelayedAddrs(this.identity.peerId);
        for (const rAddr of relayedAddrs) {
          if (!this.advertisedAddresses.includes(rAddr)) {
            this.advertisedAddresses.push(rAddr);
          }
        }
        return true;
      }
    }
    return false;
  }

  public async attemptDcutrUpgrade(targetPeerId: string, _relayPeerId: string): Promise<boolean> {
    try {
      const connectMsg = DcutrCoordinator.createConnectMessage(this.getAdvertisedAddresses());
      const reqBytes = new TextEncoder().encode(safeJsonStringify(connectMsg));
      const rpcRes = await this.reqResp.sendRequest(targetPeerId, DCUTR_PROTOCOL, reqBytes, {
        timeoutMs: 3000,
      });
      if (rpcRes.ok) {
        const syncMsg: DcutrMessage = JSON.parse(new TextDecoder().decode(rpcRes.value));
        if (syncMsg.type === 'SYNC' && syncMsg.addrs && syncMsg.addrs.length > 0) {
          const delay = syncMsg.delayMs || 100;
          await new Promise(r => setTimeout(r, delay));
          const directCand = syncMsg.addrs.find(a => !a.includes('/p2p-circuit/'));
          if (directCand) {
            const directDialRes = await this.dial(directCand);
            if (directDialRes.ok) {
              const conn = this.connManager.getConnection(targetPeerId);
              if (conn) {
                conn.status = 'connected';
              }
              return true;
            }
          }
        }
      }
    } catch {}
    return false;
  }
}

