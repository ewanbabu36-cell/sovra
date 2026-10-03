/**
 * Deterministic Canonical JSON Serializer (RFC 8785 Compliant)
 * Guarantees that identical payloads always serialize to identical byte arrays
 * regardless of object key insertion order.
 */

export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(item => canonicalizeJson(item)).join(',')}]`;
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>)
    .filter(key => (obj as Record<string, unknown>)[key] !== undefined)
    .sort();
  const pairs = sortedKeys.map(key => {
    const value = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalizeJson(value)}`;
  });

  return `{${pairs.join(',')}}`;
}

export function canonicalizeToBytes(obj: unknown): Uint8Array {
  const json = canonicalizeJson(obj);
  return new TextEncoder().encode(json);
}

export { canonicalizeJson as canonicalJsonSerialize };
