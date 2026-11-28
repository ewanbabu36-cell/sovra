import { bytesToHex, canonicalCborEncode, hexToBytes, sha256, signEd25519, verifyEd25519 } from '@sovra/crypto';
import { Result, err, ok } from '@sovra/shared';

const textEncoder = new TextEncoder();

export interface SignedBootstrapPeerEntry {
  readonly peerId: string;
  readonly operatorId: string;
  readonly networkSubnetOrAsn: string;
  readonly multiaddrs: readonly string[];
  readonly httpUrl?: string | undefined;
  readonly spkiSha256?: string | undefined;
  readonly capabilities: readonly string[];
  readonly protocolVersions: readonly string[];
  readonly publicKeyHex: string;
  readonly signatureHex: string;
}

export interface SignedBootstrapBundle {
  readonly version: 1;
  readonly network_id: string;
  readonly issued_at: number;
  readonly expires_at: number;
  readonly peers: readonly SignedBootstrapPeerEntry[];
  readonly signatures: readonly {
    readonly operatorId: string;
    readonly publicKeyHex: string;
    readonly signatureHex: string;
  }[];
}

function concatDomain(tag: string, payload: unknown): Uint8Array {
  const tagBytes = textEncoder.encode(tag);
  const cborBytes = canonicalCborEncode(payload);
  const out = new Uint8Array(tagBytes.length + cborBytes.length);
  out.set(tagBytes, 0);
  out.set(cborBytes, tagBytes.length);
  return sha256(out);
}

export type BootstrapSignerKey = Uint8Array | { sign(message: Uint8Array): Uint8Array };

function signDigestWithKey(signer: BootstrapSignerKey, digest: Uint8Array): Uint8Array {
  return signer instanceof Uint8Array ? signEd25519(signer, digest) : signer.sign(digest);
}

export function signBootstrapPeerEntry(
  unsigned: Omit<SignedBootstrapPeerEntry, 'signatureHex'>,
  nodeSignerKey: BootstrapSignerKey,
): SignedBootstrapPeerEntry {
  const digest = concatDomain('SOVRA-BOOT-PEER-v1', unsigned);
  return {
    ...unsigned,
    signatureHex: bytesToHex(signDigestWithKey(nodeSignerKey, digest)),
  };
}

export function createSignedBootstrapBundle(params: {
  network_id: string;
  peers: readonly SignedBootstrapPeerEntry[];
  signers: readonly { operatorId: string; publicKeyHex: string; privateKey: BootstrapSignerKey }[];
  issuedAt?: number | undefined;
  ttlSeconds?: number | undefined;
}): SignedBootstrapBundle {
  const issued_at = params.issuedAt ?? Math.floor(Date.now() / 1000);
  const expires_at = issued_at + (params.ttlSeconds ?? 30 * 86400);
  const unsignedBody = {
    version: 1 as const,
    network_id: params.network_id,
    issued_at,
    expires_at,
    peers: params.peers,
  };
  const digest = concatDomain('SOVRA-BOOT-BUNDLE-v1', unsignedBody);
  const signatures = params.signers.map((s) => ({
    operatorId: s.operatorId,
    publicKeyHex: s.publicKeyHex,
    signatureHex: bytesToHex(signDigestWithKey(s.privateKey, digest)),
  }));
  return {
    ...unsignedBody,
    signatures,
  };
}

export function verifySignedBootstrapBundle(
  bundle: SignedBootstrapBundle,
  options: {
    expectedNetworkId?: string | undefined;
    minIndependentOperators?: number | undefined;
    nowSec?: number | undefined;
  } = {},
): Result<{ verifiedOperators: string[]; peerCount: number }, Error> {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (!bundle || bundle.version !== 1 || !bundle.network_id) {
    return err(new Error('Invalid bootstrap bundle format'));
  }
  if (options.expectedNetworkId && bundle.network_id !== options.expectedNetworkId) {
    return err(new Error(`Bootstrap bundle network mismatch: expected '${options.expectedNetworkId}', got '${bundle.network_id}'`));
  }
  if (nowSec > bundle.expires_at) {
    return err(new Error('Bootstrap bundle has expired'));
  }

  // Verify each individual peer record signature
  for (const p of bundle.peers) {
    const { signatureHex, ...unsignedPeer } = p;
    const digest = concatDomain('SOVRA-BOOT-PEER-v1', unsignedPeer);
    if (!verifyEd25519(hexToBytes(p.publicKeyHex), digest, hexToBytes(signatureHex))) {
      return err(new Error(`Invalid peer entry signature for '${p.peerId}'`));
    }
  }

  const unsignedBody = {
    version: bundle.version,
    network_id: bundle.network_id,
    issued_at: bundle.issued_at,
    expires_at: bundle.expires_at,
    peers: bundle.peers,
  };
  const bodyDigest = concatDomain('SOVRA-BOOT-BUNDLE-v1', unsignedBody);
  const verifiedOps = new Set<string>();
  const seenKeys = new Set<string>();

  for (const sig of bundle.signatures) {
    const keyNorm = sig.publicKeyHex.toLowerCase();
    if (seenKeys.has(keyNorm)) continue;
    if (verifyEd25519(hexToBytes(sig.publicKeyHex), bodyDigest, hexToBytes(sig.signatureHex))) {
      seenKeys.add(keyNorm);
      verifiedOps.add(sig.operatorId);
    }
  }

  const minOps = options.minIndependentOperators ?? 1;
  if (verifiedOps.size < minOps) {
    return err(
      new Error(`Insufficient independent bootstrap operators: ${verifiedOps.size} < ${minOps}`),
    );
  }

  const peerOps = new Set(bundle.peers.map((p) => p.operatorId));
  if (peerOps.size < minOps) {
    return err(
      new Error(`Bootstrap peer list lacks independent operator diversity: ${peerOps.size} < ${minOps}`),
    );
  }

  return ok({ verifiedOperators: [...verifiedOps], peerCount: bundle.peers.length });
}

export function parseSignedBootstrapRegistryJson(
  rawJson: string,
  options: {
    expectedNetworkId?: string | undefined;
    minIndependentOperators?: number | undefined;
    nowSec?: number | undefined;
  } = {},
): Result<{ bundle: SignedBootstrapBundle; verifiedOperators: string[]; peerCount: number }, Error> {
  try {
    const parsed = JSON.parse(rawJson) as SignedBootstrapBundle;
    const ver = verifySignedBootstrapBundle(parsed, options);
    if (!ver.ok) return err(ver.error);
    return ok({ bundle: parsed, ...ver.value });
  } catch (e) {
    return err(e instanceof Error ? e : new Error('Invalid bootstrap registry JSON'));
  }
}
