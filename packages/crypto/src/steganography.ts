/**
 * Sovra Steganography Module - LSB (Least Significant Bit) Hidden Media Vault
 *
 * Conceals secret cryptographic seeds, E2EE private keys, or messages
 * inside innocent media byte buffers without perceptual distortion.
 */

const MAGIC_HEADER = 'SOVRA_STEGO:';

export function embedSteganographicPayload(
  carrierBuffer: Uint8Array,
  secretPayload: string,
  marker: string = MAGIC_HEADER
): Uint8Array {
  const fullPayload = `${marker}${secretPayload.length}:${secretPayload}`;
  const payloadBytes = new TextEncoder().encode(fullPayload);
  const totalBits = payloadBytes.length * 8;

  if (carrierBuffer.length < totalBits) {
    throw new Error(`Carrier buffer too small: requires at least ${totalBits} bytes, got ${carrierBuffer.length}`);
  }

  const output = new Uint8Array(carrierBuffer.length);
  output.set(carrierBuffer);

  let bitIndex = 0;
  for (let i = 0; i < payloadBytes.length; i++) {
    const byte = payloadBytes[i] ?? 0;
    for (let bit = 7; bit >= 0; bit--) {
      const bitVal = (byte >> bit) & 1;
      const currentByte = output[bitIndex] ?? 0;
      output[bitIndex] = (currentByte & 0xfe) | bitVal;
      bitIndex++;
    }
  }

  return output;
}

export function extractSteganographicPayload(
  carrierBuffer: Uint8Array,
  marker: string = MAGIC_HEADER
): string | null {
  if (carrierBuffer.length < marker.length * 8) {
    return null;
  }

  // Extract initial bits to test for magic marker
  const maxReadBits = Math.min(carrierBuffer.length, 32768); // Read up to 4KB of payload
  const extractedBytes: number[] = [];

  for (let i = 0; i + 7 < maxReadBits; i += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      const bitVal = (carrierBuffer[i + bit] ?? 0) & 1;
      byte = (byte << 1) | bitVal;
    }
    extractedBytes.push(byte);
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(extractedBytes));
  if (!text.startsWith(marker)) {
    return null;
  }

  const afterMarker = text.slice(marker.length);
  const colonIdx = afterMarker.indexOf(':');
  if (colonIdx === -1) return null;

  const lengthStr = afterMarker.slice(0, colonIdx);
  const payloadLength = parseInt(lengthStr, 10);
  if (isNaN(payloadLength) || payloadLength <= 0) return null;

  const payloadStart = marker.length + colonIdx + 1;
  const payload = text.slice(payloadStart, payloadStart + payloadLength);
  return payload;
}
