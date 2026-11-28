import { Result, ok, err } from '@sovra/shared';
import { PeerAuthenticationError } from './errors.js';
import { SignedPeerRecord, verifySignedPeerRecord } from './identity.js';

export const QR_PEER_PEX_PREFIX = 'sovra://peer-pex/v1';

function toBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * Encodes a cryptographically signed peer advertisement into a compact offline QR URI
 * (`sovra://peer-pex/v1?p=<base64url>`).
 */
export function encodeSignedPeerQrUri(record: SignedPeerRecord): string {
  if (!verifySignedPeerRecord(record)) {
    throw new PeerAuthenticationError('Cannot encode invalid or unsigned peer record into QR URI');
  }
  const raw = new TextEncoder().encode(JSON.stringify(record));
  return `${QR_PEER_PEX_PREFIX}?p=${toBase64Url(raw)}`;
}

/**
 * Parses and cryptographically verifies a scanned Sovra P2P peer QR payload.
 * Rejects invalid formats, forged PeerIDs, tampered multiaddrs, expired adverts, and replay nonces.
 */
export function decodeAndVerifyPeerQrUri(
  qrPayload: string,
  seenNonces?: Set<string>,
  nowSec = Math.floor(Date.now() / 1000),
): Result<SignedPeerRecord> {
  try {
    const trimmed = String(qrPayload || '').trim();
    if (!trimmed) {
      return err(new PeerAuthenticationError('Empty QR peer payload'));
    }

    let parsed: unknown;
    if (trimmed.startsWith(QR_PEER_PEX_PREFIX)) {
      const qIndex = trimmed.indexOf('?');
      if (qIndex < 0) {
        return err(new PeerAuthenticationError('Missing query payload in QR peer URI'));
      }
      const params = new URLSearchParams(trimmed.slice(qIndex + 1));
      const encoded = params.get('p');
      if (!encoded) {
        return err(new PeerAuthenticationError('Missing `p` parameter in QR peer URI'));
      }
      const jsonStr = new TextDecoder().decode(fromBase64Url(encoded));
      parsed = JSON.parse(jsonStr);
    } else if (trimmed.startsWith('{')) {
      parsed = JSON.parse(trimmed);
    } else {
      return err(new PeerAuthenticationError('Unsupported QR peer URI format'));
    }

    const rec = parsed as SignedPeerRecord;
    if (!verifySignedPeerRecord(rec, seenNonces, nowSec)) {
      return err(
        new PeerAuthenticationError('QR peer payload failed Ed25519 signature or expiry verification'),
      );
    }

    return ok(rec);
  } catch (e) {
    return err(
      new PeerAuthenticationError(
        `Invalid QR peer payload: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
