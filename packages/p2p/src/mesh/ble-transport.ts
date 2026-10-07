/**
 * @file packages/p2p/src/mesh/ble-transport.ts
 * Bluetooth Low Energy (BLE) Transport Implementation.
 *
 * Implements:
 * 1. SovraTransport interface for BLE radio communication.
 * 2. Automated mutual cryptographic handshake (BleHandshakeEngine) on connection.
 * 3. Transparent ChaCha20-Poly1305 forward-secure frame encryption.
 * 4. Automatic MTU-bounded chunk fragmentation and reassembly.
 * 5. Dual Peripheral (Advertising) and Central (Scanning) lifecycle coordination.
 */

import { ok, err, Result } from '@sovra/shared';
import {
  SovraTransport,
  TransportChannel,
  TransportType,
  TransportStatus,
  TransportCapabilities,
  MeshDiscoveredPeer,
  DiscoveryAdvertisement,
} from './types.js';
import {
  BlePlatformAdapter,
  BleConnectionChannel,
  BleDiscoveredDevice,
  BleSendReceipt,
} from './ble-adapters.js';
import { BleFrameCodec, BleFrameReassembler } from './ble-codec.js';
import {
  BleHandshakeEngine,
  AuthenticatedBleSession,
  HandshakeStep1Message,
  HandshakeStep2Message,
  HandshakeStep3Message,
  ResponderHandshakeState,
} from './ble-handshake.js';

export const SOVRA_BLE_SERVICE_UUID = '00005356-0000-1000-8000-00805f9b34fb';
const HANDSHAKE_PREFIX = new Uint8Array([0x53, 0x56, 0x48, 0x53]); // 'SVHS'

export interface BleTransportConfig {
  adapter: BlePlatformAdapter;
  localDid: string;
  localDevicePrivkey: Uint8Array;
  localDevicePubkeyHex: string;
  serviceUuid?: string | undefined;
  transportId?: string | undefined;
}

export class ConcreteBleChannel implements TransportChannel {
  public readonly id: string;
  public readonly peerAddress: string;
  public readonly transportType: TransportType = 'ble';
  public readonly mtu: number;

  private readonly rawChannel: BleConnectionChannel;
  private session: AuthenticatedBleSession | null = null;
  private readonly reassembler: BleFrameReassembler;

  private dataHandlers: Array<(data: Uint8Array) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];

  // Handshake listener hook for raw protocol messages
  public rawPayloadHandler: ((payload: Uint8Array) => void) | null = null;

  constructor(id: string, rawChannel: BleConnectionChannel) {
    this.id = id;
    this.peerAddress = rawChannel.address;
    this.mtu = rawChannel.mtu;
    this.rawChannel = rawChannel;
    this.reassembler = new BleFrameReassembler();

    this.rawChannel.onData(chunk => {
      this.handleIncomingChunk(chunk);
    });

    this.rawChannel.onClose(() => {
      for (const h of this.closeHandlers) {
        try {
          h();
        } catch {}
      }
    });
  }

  public setSession(session: AuthenticatedBleSession): void {
    this.session = session;
  }

  public getSession(): AuthenticatedBleSession | null {
    return this.session;
  }

  public get remoteDid(): string | undefined {
    return this.session?.remoteDid;
  }

  private handleIncomingChunk(chunk: Uint8Array): void {
    let payload: Uint8Array | null = null;
    try {
      payload = this.reassembler.feed(chunk);
    } catch (e: any) {
      this.notifyError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (!payload) return; // Incomplete transfer

    // Check if payload is a raw Handshake message (starts with 'SVHS')
    if (this.isHandshakePayload(payload)) {
      if (this.rawPayloadHandler) {
        this.rawPayloadHandler(payload.slice(4));
      }
      return;
    }

    // Otherwise, payload is application data: must be encrypted via authenticated session
    if (!this.session) {
      this.notifyError(new Error('Rejected cleartext application frame on unauthenticated BLE channel'));
      return;
    }

    try {
      const plaintext = this.session.decrypt(payload);

      for (const h of this.dataHandlers) {
        try {
          h(plaintext);
        } catch (e: any) {
          this.notifyError(e instanceof Error ? e : new Error(String(e)));
        }
      }
    } catch (e: any) {
      this.notifyError(new Error(`Failed to decrypt BLE frame: ${e?.message ?? e}`));
    }
  }

  private isHandshakePayload(payload: Uint8Array): boolean {
    if (payload.length < 4) return false;
    return (
      payload[0] === HANDSHAKE_PREFIX[0] &&
      payload[1] === HANDSHAKE_PREFIX[1] &&
      payload[2] === HANDSHAKE_PREFIX[2] &&
      payload[3] === HANDSHAKE_PREFIX[3]
    );
  }

  public async sendRawHandshake(payloadJson: unknown): Promise<Result<void>> {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payloadJson));
    const framed = new Uint8Array(4 + jsonBytes.length);
    framed.set(HANDSHAKE_PREFIX, 0);
    framed.set(jsonBytes, 4);

    const chunks = BleFrameCodec.fragment(framed, this.mtu);
    for (const chunk of chunks) {
      const sent = await this.rawChannel.send(chunk);
      if (!sent) {
        return err(new Error('Failed to send raw handshake chunk over BLE link'));
      }
    }
    return ok(undefined);
  }

  public async send(data: Uint8Array): Promise<Result<void>> {
    try {
      if (!this.session) {
        return err(new Error('Cannot transmit unencrypted application data on unauthenticated BLE channel'));
      }
      const bytesToSend = this.session.encrypt(data);

      const chunks = BleFrameCodec.fragment(bytesToSend, this.mtu);
      for (const chunk of chunks) {
        const sent = await this.rawChannel.send(chunk);
        if (!sent) {
          return err(new Error(`Failed to transmit chunk across BLE channel to ${this.peerAddress}`));
        }
      }
      return ok(undefined);
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  public async sendWithReceipt(data: Uint8Array): Promise<Result<BleSendReceipt>> {
    try {
      if (!this.session) {
        return err(new Error('Cannot transmit unencrypted application data on unauthenticated BLE channel'));
      }
      const bytesToSend = this.session.encrypt(data);
      const chunks = BleFrameCodec.fragment(bytesToSend, this.mtu);
      let lastReceipt: BleSendReceipt = {
        chunkId: `tx-${Date.now()}`,
        status: 'QUEUED',
        timestamp: Date.now(),
        bytesSent: 0,
      };

      for (const chunk of chunks) {
        if (this.rawChannel.sendWithReceipt) {
          lastReceipt = await this.rawChannel.sendWithReceipt(chunk);
          if (lastReceipt.status !== 'ACKNOWLEDGED_BY_BLE_TRANSPORT') {
            return err(new Error(`BLE transport rejected chunk: ${lastReceipt.error || 'unacknowledged'}`));
          }
        } else {
          const sent = await this.rawChannel.send(chunk);
          if (!sent) {
            return err(new Error(`Failed to transmit chunk across BLE channel to ${this.peerAddress}`));
          }
          lastReceipt = {
            chunkId: `tx-${Date.now()}`,
            status: 'ACKNOWLEDGED_BY_BLE_TRANSPORT',
            timestamp: Date.now(),
            bytesSent: chunk.length,
          };
        }
      }
      return ok(lastReceipt);
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  public async close(): Promise<void> {
    await this.rawChannel.close();
  }

  public onData(handler: (data: Uint8Array) => void): () => void {
    this.dataHandlers.push(handler);
    return () => {
      this.dataHandlers = this.dataHandlers.filter(h => h !== handler);
    };
  }

  public onClose(handler: () => void): () => void {
    this.closeHandlers.push(handler);
    return () => {
      this.closeHandlers = this.closeHandlers.filter(h => h !== handler);
    };
  }

  public onError(handler: (err: Error) => void): () => void {
    this.errorHandlers.push(handler);
    return () => {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    };
  }

  private notifyError(err: Error): void {
    for (const h of this.errorHandlers) {
      try {
        h(err);
      } catch {}
    }
  }
}

export class BluetoothLETransport implements SovraTransport {
  public readonly id: string;
  public readonly type: TransportType = 'ble';
  public status: TransportStatus = 'inactive';

  public readonly capabilities: TransportCapabilities = {
    mtuBytes: 182,
    maxBandwidthBps: 200_000, // ~200 kbps practical BLE throughput
    supportsBroadcast: false,
    supportsBackgroundExecution: true,
    isBatterySensitive: true,
    requiresPermissions: ['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT'],
  };

  private readonly adapter: BlePlatformAdapter;
  private readonly localDid: string;
  private readonly localDevicePrivkey: Uint8Array;
  private readonly localDevicePubkeyHex: string;
  private readonly serviceUuid: string;

  private activeChannels = new Map<string, ConcreteBleChannel>();
  private channelHandlers: Array<(channel: TransportChannel) => void> = [];

  constructor(config: BleTransportConfig) {
    this.id = config.transportId ?? `ble-${config.localDid.slice(0, 16)}`;
    this.adapter = config.adapter;
    this.localDid = config.localDid;
    this.localDevicePrivkey = config.localDevicePrivkey;
    this.localDevicePubkeyHex = config.localDevicePubkeyHex;
    this.serviceUuid = config.serviceUuid ?? SOVRA_BLE_SERVICE_UUID;
  }

  public async start(): Promise<Result<void>> {
    this.status = 'active';

    // Register incoming connection handler on the hardware/virtual adapter
    this.adapter.onIncomingConnection(rawChannel => {
      this.handleIncomingRawConnection(rawChannel).catch(() => {});
    });

    return ok(undefined);
  }

  public async stop(): Promise<void> {
    this.status = 'inactive';
    await this.adapter.stopAdvertising();
    await this.adapter.stopScanning();

    for (const channel of this.activeChannels.values()) {
      await channel.close();
    }
    this.activeChannels.clear();
  }

  public async advertise(payload: DiscoveryAdvertisement): Promise<Result<void>> {
    const advBytes = new TextEncoder().encode(
      JSON.stringify({
        t: payload.ephemeralDiscoveryToken,
        v: payload.protocolVersion,
        f: payload.capabilityFlags,
      }),
    );

    const success = await this.adapter.startAdvertising(this.serviceUuid, advBytes);
    if (!success) {
      return err(new Error('BLE Platform Adapter failed to start advertising'));
    }
    return ok(undefined);
  }

  public async discover(handler: (discovered: MeshDiscoveredPeer) => void): Promise<Result<void>> {
    const success = await this.adapter.startScanning(this.serviceUuid, (dev: BleDiscoveredDevice) => {
      let token: string | undefined;
      let version = 1;
      let flags = 0;

      try {
        const parsed = JSON.parse(new TextDecoder().decode(dev.serviceData));
        token = parsed.t;
        version = parsed.v ?? 1;
        flags = parsed.f ?? 0;
      } catch {}

      handler({
        peerAddress: dev.address,
        transportType: 'ble',
        rssi: dev.rssi,
        ephemeralToken: token,
        protocolVersion: version,
        capabilityFlags: flags,
        discoveredAt: Date.now(),
      });
    });

    if (!success) {
      return err(new Error('BLE Platform Adapter failed to start scanning'));
    }
    return ok(undefined);
  }

  public async connect(peerAddress: string): Promise<Result<TransportChannel>> {
    try {
      const rawChannel = await this.adapter.connect(peerAddress);
      const channelId = `ch-${rawChannel.address}-${Date.now()}`;
      const channel = new ConcreteBleChannel(channelId, rawChannel);

      // Perform Initiator Handshake with Responder
      const session = await this.executeInitiatorHandshake(channel);
      channel.setSession(session);

      this.activeChannels.set(peerAddress, channel);
      channel.onClose(() => {
        this.activeChannels.delete(peerAddress);
      });

      this.notifyChannel(channel);
      return ok(channel);
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  public async disconnect(peerAddress: string): Promise<void> {
    const channel = this.activeChannels.get(peerAddress);
    if (channel) {
      await channel.close();
      this.activeChannels.delete(peerAddress);
    }
  }

  public getConnectedPeers(): readonly string[] {
    return Array.from(this.activeChannels.keys());
  }

  public onChannel(handler: (channel: TransportChannel) => void): () => void {
    this.channelHandlers.push(handler);
    return () => {
      this.channelHandlers = this.channelHandlers.filter(h => h !== handler);
    };
  }

  private notifyChannel(channel: TransportChannel): void {
    for (const h of this.channelHandlers) {
      try {
        h(channel);
      } catch {}
    }
  }

  // ==========================================
  // HANDSHAKE ORCHESTRATION
  // ==========================================

  private async executeInitiatorHandshake(channel: ConcreteBleChannel): Promise<AuthenticatedBleSession> {
    return new Promise<AuthenticatedBleSession>((resolve, reject) => {
      const timeout = setTimeout(() => {
        channel.rawPayloadHandler = null;
        reject(new Error('Initiator handshake timed out after 10 seconds'));
      }, 10000);

      const { step1, ephemeralPrivate, initiatorNonce } = BleHandshakeEngine.createInitiatorStep1();

      channel.rawPayloadHandler = async (payloadBytes: Uint8Array) => {
        try {
          const message: HandshakeStep2Message = JSON.parse(new TextDecoder().decode(payloadBytes));
          if (message.type !== 'STEP_2_CHALLENGE_RESPONSE') {
            return;
          }

          // Process Step 2 and produce Step 3
          const { step3, session } = BleHandshakeEngine.processStep2AndCreateStep3(
            message,
            ephemeralPrivate,
            initiatorNonce,
            this.localDid,
            this.localDevicePrivkey,
            this.localDevicePubkeyHex,
          );

          // Send Step 3 confirmation to responder
          await channel.sendRawHandshake(step3);

          clearTimeout(timeout);
          channel.rawPayloadHandler = null;
          resolve(session);
        } catch (err) {
          clearTimeout(timeout);
          channel.rawPayloadHandler = null;
          reject(err);
        }
      };

      // Send Step 1 to kick off handshake
      channel.sendRawHandshake(step1).catch(err => {
        clearTimeout(timeout);
        channel.rawPayloadHandler = null;
        reject(err);
      });
    });
  }

  private async handleIncomingRawConnection(rawChannel: BleConnectionChannel): Promise<void> {
    const channelId = `ch-${rawChannel.address}-${Date.now()}`;
    const channel = new ConcreteBleChannel(channelId, rawChannel);

    let responderState: ResponderHandshakeState | null = null;

    const timeout = setTimeout(() => {
      channel.rawPayloadHandler = null;
      channel.close().catch(() => {});
    }, 10000);

    channel.rawPayloadHandler = async (payloadBytes: Uint8Array) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(payloadBytes));

        if (message.type === 'STEP_1_INITIATE') {
          const step1 = message as HandshakeStep1Message;
          const result = BleHandshakeEngine.processStep1AndCreateStep2(
            step1,
            this.localDid,
            this.localDevicePrivkey,
            this.localDevicePubkeyHex,
          );

          responderState = result.responderState;
          await channel.sendRawHandshake(result.step2);
          return;
        }

        if (message.type === 'STEP_3_CONFIRM' && responderState) {
          const step3 = message as HandshakeStep3Message;
          const session = BleHandshakeEngine.processStep3ForResponder(responderState, step3);

          clearTimeout(timeout);
          channel.rawPayloadHandler = null;
          channel.setSession(session);

          this.activeChannels.set(rawChannel.address, channel);
          channel.onClose(() => {
            this.activeChannels.delete(rawChannel.address);
          });

          this.notifyChannel(channel);
        }
      } catch (err) {
        clearTimeout(timeout);
        channel.rawPayloadHandler = null;
        await channel.close();
      }
    };
  }
}
