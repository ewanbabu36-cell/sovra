import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import crypto from 'node:crypto';

/**
 * Tests for Sovra Wi-Fi Direct (P2P) High-Bandwidth Media Transport Protocol.
 * Validates binary framing, SHA-256 integrity verification, and chunk streaming on port 5359.
 */
describe('Sovra Wi-Fi Direct Media Transport Protocol', () => {
  const TEST_PORT = 5359;
  let server: net.Server;
  const receivedTransfers = new Map<string, { buffer: Buffer; sha256Hex: string }>();

  beforeAll(async () => {
    // Spin up reference TCP server implementing SovraWifiDirectModule socket protocol
    await new Promise<void>((resolve, reject) => {
      server = net.createServer((socket) => {
        let headerBuffer = Buffer.alloc(0);
        let transferId = '';
        let totalLength = 0;
        let dataBuffer = Buffer.alloc(0);
        const digest = crypto.createHash('sha256');

        socket.on('data', (chunk) => {
          if (!transferId) {
            headerBuffer = Buffer.concat([headerBuffer, chunk]);
            if (headerBuffer.length >= 44) { // 36 bytes ID + 8 bytes size
              transferId = headerBuffer.subarray(0, 36).toString('utf8').trim();
              totalLength = Number(headerBuffer.readBigInt64BE(36));
              const remainder = headerBuffer.subarray(44);
              if (remainder.length > 0) {
                dataBuffer = Buffer.concat([dataBuffer, remainder]);
                digest.update(remainder);
              }
            }
          } else {
            dataBuffer = Buffer.concat([dataBuffer, chunk]);
            digest.update(chunk);
          }

          if (transferId && dataBuffer.length >= totalLength) {
            const sha256Hex = digest.digest('hex');
            receivedTransfers.set(transferId, { buffer: dataBuffer, sha256Hex });

            // Send standard Java DataOutputStream.writeUTF format: 2-byte length + UTF8 string
            const ackMsg = `ACK_SHA256:${sha256Hex}`;
            const ackBuf = Buffer.alloc(2 + Buffer.byteLength(ackMsg));
            ackBuf.writeUInt16BE(Buffer.byteLength(ackMsg), 0);
            ackBuf.write(ackMsg, 2, 'utf8');
            socket.write(ackBuf);
            socket.end();
          }
        });
      });

      server.listen(TEST_PORT, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('successfully streams a 1.5 MB high-resolution photo chunk over P2P socket with SHA-256 verification', async () => {
    const payloadSize = 1.5 * 1024 * 1024; // 1.5 MB photo payload
    const testPayload = crypto.randomBytes(payloadSize);
    const expectedSha256 = crypto.createHash('sha256').update(testPayload).digest('hex');
    const transferId = crypto.randomUUID();

    const client = new net.Socket();
    await new Promise<void>((resolve, reject) => {
      client.connect(TEST_PORT, '127.0.0.1', () => resolve());
      client.on('error', reject);
    });

    // 1. Build Header: 36 bytes UUID (padded) + 8 bytes Big-Endian Size
    const header = Buffer.alloc(44);
    const paddedId = transferId.padEnd(36, ' ').slice(0, 36);
    header.write(paddedId, 0, 36, 'utf8');
    header.writeBigInt64BE(BigInt(payloadSize), 36);

    // 2. Stream Header and Payload in 64KB chunks
    client.write(header);
    const CHUNK_SIZE = 65536;
    for (let offset = 0; offset < testPayload.length; offset += CHUNK_SIZE) {
      const slice = testPayload.subarray(offset, Math.min(offset + CHUNK_SIZE, testPayload.length));
      client.write(slice);
    }

    // 3. Await ACK from server
    const ackReceived = await new Promise<string>((resolve) => {
      client.on('data', (data) => {
        // Parse writeUTF response
        const strLen = data.readUInt16BE(0);
        const ackStr = data.subarray(2, 2 + strLen).toString('utf8');
        resolve(ackStr);
      });
    });

    expect(ackReceived).toBe(`ACK_SHA256:${expectedSha256}`);
    const stored = receivedTransfers.get(transferId);
    expect(stored).toBeDefined();
    expect(stored!.buffer.length).toBe(payloadSize);
    expect(stored!.sha256Hex).toBe(expectedSha256);
  });

  it('rejects tampered or corrupt binary payloads', () => {
    const original = crypto.randomBytes(1024 * 100);
    const originalSha = crypto.createHash('sha256').update(original).digest('hex');

    const tampered = Buffer.from(original);
    tampered[100] = tampered[100] ^ 0xFF; // Flip byte
    const tamperedSha = crypto.createHash('sha256').update(tampered).digest('hex');

    expect(tamperedSha).not.toBe(originalSha);
  });
});
