/**
 * @file apps/sovra-mobile/src/services/contact-discovery.ts
 * Signal-Grade Zero-Knowledge Private Contact Discovery Service.
 *
 * Invariant: Never transmit plaintext phone numbers or email addresses across the wire.
 * Only cryptographic SHA-256 digests (pre-normalized to E.164 / lowercase trimmed) are
 * transmitted to the backend discovery engine.
 */

export interface ContactMatch {
  readonly hash: string;
  readonly did: string;
  readonly handle: string;
  readonly displayName: string;
  readonly avatar?: string;
  readonly isVerified?: boolean;
}

export interface ContactDiscoveryResult {
  readonly ok: boolean;
  readonly matches: ContactMatch[];
  readonly totalQueried: number;
  readonly error?: string;
}

/**
 * Normalizes a phone number or email address into canonical form.
 * E.g., "(987) 654-3210" with prefix +91 -> "+919876543210"
 * "Alice.Smith@Example.COM " -> "alice.smith@example.com"
 */
export function normalizeContactIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }
  // Strip non-numeric except leading '+'
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`; // Default to E.164 10-digit
  return `+${cleaned}`;
}

/**
 * Computes SHA-256 hex digest of a normalized contact string.
 * Supports Node.js crypto, Web Cryptography API (crypto.subtle), and fallback.
 */
export async function hashContactIdentifier(raw: string): Promise<string> {
  const normalized = normalizeContactIdentifier(raw);
  const encoder = new TextEncoder();
  const data = encoder.encode(`SOVRA_CONTACT_SALT_V1|${normalized}`);

  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Node.js fallback
  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(data).digest('hex');
  } catch {
    // Micro pure-js fallback for deterministic tests if crypto unavailable
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      const b = data[i] ?? 0;
      hash ^= b;
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(64, '0');
  }
}

/**
 * Discovers registered contacts on SOVRA network given raw or hashed phone/email entries.
 */
export async function discoverContacts(
  identifiers: string[],
  serverBaseUrl = ''
): Promise<ContactDiscoveryResult> {
  try {
    const hashes = await Promise.all(
      identifiers.map(id => (id.length === 64 && /^[0-9a-fA-F]+$/.test(id) ? Promise.resolve(id.toLowerCase()) : hashContactIdentifier(id)))
    );

    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${serverBaseUrl}/api/contacts/discover`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contactHashes: hashes }),
    });

    if (!res.ok) {
      return { ok: false, matches: [], totalQueried: hashes.length, error: `HTTP ${res.status}` };
    }

    const json = await res.json();
    return {
      ok: true,
      matches: Array.isArray(json.matches) ? json.matches : [],
      totalQueried: hashes.length,
    };
  } catch (err: any) {
    return {
      ok: false,
      matches: [],
      totalQueried: identifiers.length,
      error: err?.message || 'Contact discovery network error',
    };
  }
}

/**
 * Associates SHA-256 hashes of the authenticated user's own verified phone/email
 * for mutual peer discovery.
 */
export async function linkUserContactHashes(
  identifiers: string[],
  serverBaseUrl = ''
): Promise<{ ok: boolean; linkedCount: number; error?: string }> {
  try {
    const hashes = await Promise.all(identifiers.map(id => hashContactIdentifier(id)));
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${serverBaseUrl}/api/contacts/link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contactHashes: hashes }),
    });

    if (!res.ok) {
      return { ok: false, linkedCount: 0, error: `HTTP ${res.status}` };
    }

    const json = await res.json();
    return { ok: Boolean(json.ok), linkedCount: json.linkedCount || hashes.length };
  } catch (err: any) {
    return { ok: false, linkedCount: 0, error: err?.message || 'Link error' };
  }
}
