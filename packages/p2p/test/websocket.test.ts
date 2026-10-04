import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketTransport } from '../src/websocket.js';
import {
  SecureTransportHandshake,
  HandshakeMessage1,
  HandshakeMessage2,
  HandshakeMessage3,
} from '../src/transport.js';
import { generateEd25519KeyPair } from '@sovra/crypto';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
} from '@sovra/identity';
import { createPeerIdentityBinding } from '../src/identity.js';

describe('WebSocket Transport Suite', () => {
  let transportServer: WebSocketTransport | null = null;

  afterEach(async () => {
    if (transportServer) {
      await transportServer.close();
      transportServer = null;
    }
  });

  it('establishes WebSocket duplex connection and sends bidirectional binary data', async () => {
    transportServer = new WebSocketTransport();
    const testPort = 19485;

    let serverReceivedData: Uint8Array | null = null;
    transportServer.listen(testPort, '127.0.0.1', (serverStream) => {
      serverStream.on('data', (data) => {
        serverReceivedData = data;
        const reply = Buffer.concat([Buffer.from('ACK:'), data]);
        serverStream.write(reply);
      });
    });

    const clientTransport = new WebSocketTransport();
    const clientStream = await clientTransport.dial(`ws://127.0.0.1:${testPort}/p2p`);

    let clientReceivedData: Uint8Array | null = null;
    const clientDone = new Promise<void>((resolve) => {
      clientStream.on('data', (data) => {
        clientReceivedData = data;
        clientStream.end();
        resolve();
      });
    });

    const testMessage = Buffer.from('Hello P2P over WebSocket!');
    clientStream.write(testMessage);

    await clientDone;

    expect(serverReceivedData).not.toBeNull();
    expect(Buffer.from(serverReceivedData!).toString('utf8')).toBe('Hello P2P over WebSocket!');
    expect(clientReceivedData).not.toBeNull();
    expect(Buffer.from(clientReceivedData!).toString('utf8')).toBe('ACK:Hello P2P over WebSocket!');
  });

  it('handles multi-frame and larger binary payloads (>65KB) correctly', async () => {
    transportServer = new WebSocketTransport();
    const testPort = 19486;

    const largePayload = Buffer.alloc(70000);
    for (let i = 0; i < largePayload.length; i++) {
      largePayload[i] = (i * 13) % 256;
    }

    let receivedBytes = Buffer.alloc(0);
    const serverDone = new Promise<void>((resolve) => {
      transportServer!.listen(testPort, '127.0.0.1', (serverStream) => {
        serverStream.on('data', (data) => {
          receivedBytes = Buffer.concat([receivedBytes, data]);
          if (receivedBytes.length >= largePayload.length) {
            serverStream.end();
            resolve();
          }
        });
      });
    });

    const clientTransport = new WebSocketTransport();
    const clientStream = await clientTransport.dial(`ws://127.0.0.1:${testPort}/p2p`);
    clientStream.write(largePayload);

    await serverDone;
    clientStream.end();

    expect(receivedBytes.length).toBe(largePayload.length);
    expect(receivedBytes.equals(largePayload)).toBe(true);
  });

  it('runs authenticated Noise_XX handshake over WebSocket transport stream', async () => {
    const aliceMaster = SovraIdentityKey.generate();
    const alicePair = generateEd25519KeyPair();
    const aliceDevice = new SovraDeviceKey(
      'alice-ws-dev',
      'Alice WS Device',
      aliceMaster.did,
      alicePair.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const aliceDelegation = createDeviceDelegation(
      aliceMaster,
      aliceDevice,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const aliceBinding = createPeerIdentityBinding(aliceDevice, aliceMaster.did, aliceDelegation);

    const bobMaster = SovraIdentityKey.generate();
    const bobPair = generateEd25519KeyPair();
    const bobDevice = new SovraDeviceKey(
      'bob-ws-dev',
      'Bob WS Device',
      bobMaster.did,
      bobPair.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const bobDelegation = createDeviceDelegation(
      bobMaster,
      bobDevice,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const bobBinding = createPeerIdentityBinding(bobDevice, bobMaster.did, bobDelegation);

    transportServer = new WebSocketTransport();
    const testPort = 19487;

    const handshakeDone = new Promise<void>((resolve, reject) => {
      transportServer!.listen(testPort, '127.0.0.1', (serverStream) => {
        let bobState: any = null;
        let bobEphemeralKey: Uint8Array | null = null;

        serverStream.on('data', (chunk) => {
          try {
            if (!bobState) {
              const msg1: HandshakeMessage1 = {
                rawBytes: chunk,
                ephemeralPublicKeyHex: Buffer.from(chunk.subarray(0, 32)).toString('hex'),
              };
              const bobResp = SecureTransportHandshake.respond(msg1, bobDevice, bobBinding);
              bobState = bobResp.symmetricState;
              bobEphemeralKey = bobResp.ephemeralKeyPair.privateKey;
              serverStream.write(bobResp.message2.rawBytes);
            } else {
              const msg3: HandshakeMessage3 = { rawBytes: chunk };
              const bobFinal = SecureTransportHandshake.finalizeResponder(
                msg3,
                bobState,
                bobEphemeralKey!,
              );
              expect(bobFinal.channel.remotePeerId).toBe(aliceBinding.peerId);
              serverStream.end();
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    const clientTransport = new WebSocketTransport();
    const clientStream = await clientTransport.dial(`ws://127.0.0.1:${testPort}/p2p`);

    // 1. Alice initiates
    const aliceInit = SecureTransportHandshake.initiate();

    clientStream.on('data', (chunk) => {
      const msg2: HandshakeMessage2 = { rawBytes: chunk };
      const aliceFinal = SecureTransportHandshake.processMessage2AndCreateMessage3(
        msg2,
        aliceInit.symmetricState,
        aliceInit.ephemeralKeyPair.privateKey,
        aliceDevice,
        aliceBinding,
      );
      expect(aliceFinal.channel.remotePeerId).toBe(bobBinding.peerId);
      // Send message 3 to Bob
      clientStream.write(aliceFinal.message3.rawBytes);
    });

    clientStream.write(aliceInit.message1.rawBytes);

    await handshakeDone;
    clientStream.end();
  });
});
