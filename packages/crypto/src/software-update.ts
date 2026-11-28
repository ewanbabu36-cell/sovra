import {
  sha256,
  signEd25519,
  verifyEd25519,
  bytesToHex,
  hexToBytes,
} from './primitives.js';

export interface ReleaseSignerSignature {
  readonly signerPubKeyHex: string;
  readonly signatureHex: string;
}

export interface ReleaseMirrorDescriptor {
  readonly operatorId: string;
  readonly uri: string;
  readonly priority?: number | undefined;
}

export interface SignedBuilderAttestation {
  readonly builderPubKeyHex: string;
  readonly sourceCommitHex: string;
  readonly buildRecipeHashHex: string;
  readonly artifactSha256Hex: string;
  readonly byteLength: number;
  readonly builtAt: number;
  readonly signatureHex: string;
}

export interface ReproducibleBuildProvenance {
  readonly sourceCommitHex: string;
  readonly buildRecipeHashHex: string;
  readonly builderAttestations?: readonly (SignedBuilderAttestation | string)[] | undefined;
}

export interface SignedReleaseManifest {
  readonly version: string;
  readonly minCompatibleVersion: string;
  readonly protocolVersion: number;
  readonly platform: 'android-apk' | 'ios-ipa' | 'desktop-win' | 'desktop-linux' | 'desktop-mac' | 'node-daemon';
  readonly artifactCid: string;
  readonly artifactSha256Hex: string;
  readonly byteLength: number;
  readonly releaseNotes?: string | undefined;
  readonly issuedAt: number;
  readonly signerThreshold: number;
  readonly reproducibleBuild?: ReproducibleBuildProvenance | undefined;
  readonly mirrors?: readonly ReleaseMirrorDescriptor[] | undefined;
  readonly signatures: readonly ReleaseSignerSignature[];
}

export interface ReleaseVerificationPolicy {
  readonly trustedSignerPubKeysHex: readonly string[];
  readonly revokedSignerPubKeysHex?: readonly string[] | undefined;
  readonly trustedBuilderPubKeysHex?: readonly string[] | undefined;
  readonly revokedBuilderPubKeysHex?: readonly string[] | undefined;
  readonly minimumBuilderAttestations?: number | undefined;
  readonly currentVersion: string;
  readonly currentProtocolVersion?: number | undefined;
  readonly minimumThreshold?: number | undefined;
}

export interface ReleaseVerificationResult {
  readonly valid: boolean;
  readonly validSigners: readonly string[];
  readonly validBuilders?: readonly string[] | undefined;
  readonly reason?: string | undefined;
}

/**
 * Compares numeric dotted semver strings (e.g. "1.4.2" vs "1.3.9").
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map(n => parseInt(n, 10));
  const pb = b.replace(/^v/i, '').split('.').map(n => parseInt(n, 10));
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) {
    throw new Error(`Invalid semver format: '${a}' vs '${b}'`);
  }
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function buildCanonicalReleasePayload(
  manifest: Omit<SignedReleaseManifest, 'signatures'>,
): Uint8Array {
  const obj: Record<string, unknown> = {
    artifactCid: manifest.artifactCid,
    artifactSha256Hex: manifest.artifactSha256Hex.toLowerCase(),
    byteLength: manifest.byteLength,
    issuedAt: manifest.issuedAt,
    minCompatibleVersion: manifest.minCompatibleVersion,
    ...(manifest.mirrors !== undefined ? { mirrors: manifest.mirrors } : {}),
    platform: manifest.platform,
    protocolVersion: manifest.protocolVersion,
    releaseNotes: manifest.releaseNotes ?? '',
    ...(manifest.reproducibleBuild !== undefined ? { reproducibleBuild: manifest.reproducibleBuild } : {}),
    signerThreshold: manifest.signerThreshold,
    version: manifest.version,
  };
  return sha256(new TextEncoder().encode(JSON.stringify(obj)));
}

/**
 * Signs a canonical release manifest with one maintainer Ed25519 private key.
 * Multiple independent signers call this to assemble an M-of-N threshold release (zero founder SPOF).
 */
export function signReleaseManifest(
  manifest: Omit<SignedReleaseManifest, 'signatures'>,
  signerPrivateKey: Uint8Array,
  signerPublicKey: Uint8Array,
): ReleaseSignerSignature {
  const digest = buildCanonicalReleasePayload(manifest);
  const sig = signEd25519(signerPrivateKey, digest);
  return {
    signerPubKeyHex: bytesToHex(signerPublicKey).toLowerCase(),
    signatureHex: bytesToHex(sig),
  };
}

function buildBuilderAttestationPayload(
  params: Omit<SignedBuilderAttestation, 'signatureHex'>,
): Uint8Array {
  const canonical = JSON.stringify({
    artifactSha256Hex: params.artifactSha256Hex.toLowerCase(),
    buildRecipeHashHex: params.buildRecipeHashHex.toLowerCase(),
    builderPubKeyHex: params.builderPubKeyHex.toLowerCase(),
    builtAt: params.builtAt,
    byteLength: params.byteLength,
    sourceCommitHex: params.sourceCommitHex.toLowerCase(),
  });
  return sha256(new TextEncoder().encode(`SOVRA-BUILD-ATTEST-v1:${canonical}`));
}

/**
 * Cryptographically signs a reproducible-build attestation binding source commit,
 * build recipe hash, output SHA-256, and byte length to an independent builder Ed25519 key.
 */
export function signBuilderAttestation(
  params: Omit<SignedBuilderAttestation, 'builderPubKeyHex' | 'signatureHex'>,
  builderPrivateKey: Uint8Array,
  builderPublicKey: Uint8Array,
): SignedBuilderAttestation {
  const unsigned = {
    ...params,
    builderPubKeyHex: bytesToHex(builderPublicKey).toLowerCase(),
  };
  const digest = buildBuilderAttestationPayload(unsigned);
  return {
    ...unsigned,
    signatureHex: bytesToHex(signEd25519(builderPrivateKey, digest)),
  };
}

/**
 * Verifies cryptographic Ed25519 builder provenance attestations against a release manifest.
 * Plain string metadata entries are explicitly ignored and never counted as verified provenance.
 */
export function verifyBuilderProvenanceAttestations(
  manifest: Pick<SignedReleaseManifest, 'artifactSha256Hex' | 'byteLength' | 'reproducibleBuild'>,
  policy?: Pick<
    ReleaseVerificationPolicy,
    'trustedBuilderPubKeysHex' | 'revokedBuilderPubKeysHex' | 'minimumBuilderAttestations'
  >,
): { valid: boolean; validBuilders: readonly string[]; reason?: string } {
  const minBuilders = policy?.minimumBuilderAttestations ?? 0;
  const prov = manifest.reproducibleBuild;
  const rawAttestations = prov?.builderAttestations ?? [];
  const trustedBuilders = policy?.trustedBuilderPubKeysHex?.length
    ? new Set(policy.trustedBuilderPubKeysHex.map(k => k.toLowerCase()))
    : null;
  const revokedBuilders = new Set((policy?.revokedBuilderPubKeysHex ?? []).map(k => k.toLowerCase()));

  const validBuilders = new Set<string>();
  for (const entry of rawAttestations) {
    if (!entry || typeof entry === 'string') {
      continue; // Metadata-only string attestations never count as cryptographic provenance
    }
    if (!prov) {
      return { valid: false, validBuilders: [], reason: 'Builder attestation present without reproducibleBuild metadata' };
    }
    const pubHex = String(entry.builderPubKeyHex || '').toLowerCase();
    if (!pubHex || !entry.signatureHex) {
      return { valid: false, validBuilders: [], reason: 'Malformed builder attestation missing key or signature' };
    }
    if (entry.artifactSha256Hex.toLowerCase() !== manifest.artifactSha256Hex.toLowerCase()) {
      return { valid: false, validBuilders: [], reason: 'Builder attestation artifact SHA-256 mismatch' };
    }
    if (entry.byteLength !== manifest.byteLength) {
      return { valid: false, validBuilders: [], reason: 'Builder attestation byteLength mismatch' };
    }
    if (
      entry.sourceCommitHex.toLowerCase() !== prov.sourceCommitHex.toLowerCase() ||
      entry.buildRecipeHashHex.toLowerCase() !== prov.buildRecipeHashHex.toLowerCase()
    ) {
      return { valid: false, validBuilders: [], reason: 'Builder attestation sourceCommitHex or buildRecipeHashHex mismatch' };
    }
    try {
      const pubBytes = hexToBytes(pubHex);
      const sigBytes = hexToBytes(entry.signatureHex);
      const digest = buildBuilderAttestationPayload(entry);
      if (pubBytes.length !== 32 || sigBytes.length !== 64 || !verifyEd25519(pubBytes, digest, sigBytes)) {
        return { valid: false, validBuilders: [], reason: `Invalid Ed25519 builder attestation signature for ${pubHex}` };
      }
    } catch {
      return { valid: false, validBuilders: [], reason: `Malformed hex in builder attestation for ${pubHex}` };
    }
    if (revokedBuilders.has(pubHex)) {
      continue;
    }
    if (trustedBuilders && !trustedBuilders.has(pubHex)) {
      continue;
    }
    validBuilders.add(pubHex);
  }

  if (minBuilders > 0 && validBuilders.size < minBuilders) {
    return {
      valid: false,
      validBuilders: Array.from(validBuilders),
      reason: `Insufficient verified reproducible-build attestations: ${validBuilders.size}/${minBuilders} required (metadata strings excluded)`,
    };
  }

  return { valid: true, validBuilders: Array.from(validBuilders) };
}

/**
 * Verifies a decentralized M-of-N signed software update manifest AND optional downloaded artifact bytes:
 * 1. Prevents downgrade / rollback attacks (manifest.version < currentVersion -> rejected).
 * 2. Enforces protocol compatibility bounds (minCompatibleVersion <= currentVersion).
 * 3. Rejects revoked/compromised signer keys cleanly without breaking surviving quorum signers.
 * 4. Requires M distinct valid Ed25519 signatures from trusted community maintainer keys.
 * 5. Verifies cryptographic reproducible-build attestations when present or required by policy.
 * 6. If artifactBytes is supplied, verifies SHA-256 digest and byteLength match bit-for-bit.
 */
export function verifySignedSoftwareRelease(
  manifest: SignedReleaseManifest,
  policy: ReleaseVerificationPolicy,
  artifactBytes?: Uint8Array,
): ReleaseVerificationResult {
  try {
    if (!manifest || !manifest.version || !manifest.artifactSha256Hex || !manifest.artifactCid) {
      return { valid: false, validSigners: [], validBuilders: [], reason: 'Malformed release manifest metadata' };
    }

    // 1. Rollback / downgrade prevention & forward compatibility gate
    if (compareSemver(manifest.version, policy.currentVersion) <= 0) {
      return {
        valid: false,
        validSigners: [],
        validBuilders: [],
        reason: `Downgrade or replay rejected: update ${manifest.version} <= installed ${policy.currentVersion}`,
      };
    }
    if (compareSemver(policy.currentVersion, manifest.minCompatibleVersion) < 0) {
      return {
        valid: false,
        validSigners: [],
        validBuilders: [],
        reason: `Version incompatibility: current ${policy.currentVersion} < required min ${manifest.minCompatibleVersion}`,
      };
    }
    if (
      policy.currentProtocolVersion !== undefined &&
      manifest.protocolVersion < policy.currentProtocolVersion
    ) {
      return {
        valid: false,
        validSigners: [],
        validBuilders: [],
        reason: `Protocol downgrade rejected: ${manifest.protocolVersion} < ${policy.currentProtocolVersion}`,
      };
    }

    // 2. Determine required M-of-N threshold (enforcing non-single-key quorum if policy requires >= 2)
    const minReq = policy.minimumThreshold ?? 2;
    const effectiveThreshold = Math.max(minReq, manifest.signerThreshold);
    const trustedSet = new Set(policy.trustedSignerPubKeysHex.map(k => k.toLowerCase()));
    const revokedSet = new Set((policy.revokedSignerPubKeysHex ?? []).map(k => k.toLowerCase()));

    const digest = buildCanonicalReleasePayload(manifest);
    const verifiedSigners = new Set<string>();

    for (const s of manifest.signatures ?? []) {
      const pubHex = String(s.signerPubKeyHex || '').toLowerCase();
      if (!pubHex || revokedSet.has(pubHex) || !trustedSet.has(pubHex) || verifiedSigners.has(pubHex)) {
        continue;
      }
      try {
        const pubBytes = hexToBytes(pubHex);
        const sigBytes = hexToBytes(s.signatureHex);
        if (pubBytes.length === 32 && sigBytes.length === 64 && verifyEd25519(pubBytes, digest, sigBytes)) {
          verifiedSigners.add(pubHex);
        }
      } catch {}
    }

    if (verifiedSigners.size < effectiveThreshold) {
      return {
        valid: false,
        validSigners: Array.from(verifiedSigners),
        validBuilders: [],
        reason: `Insufficient valid maintainer quorum: ${verifiedSigners.size}/${effectiveThreshold} required`,
      };
    }

    // 3. Reproducible-build cryptographic provenance attestation check
    const provCheck = verifyBuilderProvenanceAttestations(manifest, policy);
    if (!provCheck.valid) {
      return {
        valid: false,
        validSigners: Array.from(verifiedSigners),
        validBuilders: provCheck.validBuilders,
        reason: provCheck.reason,
      };
    }

    // 4. Bit-for-bit P2P artifact verification
    if (artifactBytes) {
      if (artifactBytes.length !== manifest.byteLength) {
        return {
          valid: false,
          validSigners: Array.from(verifiedSigners),
          validBuilders: provCheck.validBuilders,
          reason: `Artifact byte length mismatch: expected ${manifest.byteLength}, got ${artifactBytes.length}`,
        };
      }
      const computedSha = bytesToHex(sha256(artifactBytes)).toLowerCase();
      if (computedSha !== manifest.artifactSha256Hex.toLowerCase()) {
        return {
          valid: false,
          validSigners: Array.from(verifiedSigners),
          validBuilders: provCheck.validBuilders,
          reason: `Artifact SHA-256 tamper mismatch: expected ${manifest.artifactSha256Hex}, got ${computedSha}`,
        };
      }
    }

    return {
      valid: true,
      validSigners: Array.from(verifiedSigners),
      validBuilders: provCheck.validBuilders,
    };
  } catch (e) {
    return {
      valid: false,
      validSigners: [],
      validBuilders: [],
      reason: e instanceof Error ? e.message : 'Release verification failed',
    };
  }
}

export function verifyIndependentUpdateMirrors(
  manifest: SignedReleaseManifest,
  minIndependentOperators = 2,
): { valid: boolean; distinctOperators: string[]; reason?: string | undefined } {
  const mirrors = manifest.mirrors ?? [];
  const ops = new Set<string>();
  for (const m of mirrors) {
    if (!m.operatorId || !m.uri || (!m.uri.startsWith('ipns://') && !m.uri.startsWith('ipfs://') && !m.uri.startsWith('sovra://') && !m.uri.startsWith('https://') && !m.uri.startsWith('http://'))) {
      return { valid: false, distinctOperators: [], reason: `Malformed mirror descriptor '${m.uri}'` };
    }
    ops.add(m.operatorId.toLowerCase());
  }
  if (ops.size < minIndependentOperators) {
    return {
      valid: false,
      distinctOperators: [...ops],
      reason: `Insufficient independent release mirrors: ${ops.size} < ${minIndependentOperators}`,
    };
  }
  return { valid: true, distinctOperators: [...ops] };
}

export interface SignedReleaseSignerRotation {
  readonly version: 1;
  readonly revokedPubKeysHex: readonly string[];
  readonly addedPubKeysHex: readonly string[];
  readonly issuedAt: number;
  readonly sequence: number;
  readonly signatures: readonly ReleaseSignerSignature[];
}

export function createReleaseSignerRotation(
  params: Omit<SignedReleaseSignerRotation, 'version' | 'signatures'>,
  approvingSigners: readonly { privateKey: Uint8Array; publicKey: Uint8Array }[],
): SignedReleaseSignerRotation {
  const canonical = JSON.stringify({
    version: 1,
    addedPubKeysHex: [...params.addedPubKeysHex].map((k) => k.toLowerCase()).sort(),
    issuedAt: params.issuedAt,
    revokedPubKeysHex: [...params.revokedPubKeysHex].map((k) => k.toLowerCase()).sort(),
    sequence: params.sequence,
  });
  const digest = sha256(new TextEncoder().encode(`SOVRA-REL-KEYROT-v1:${canonical}`));
  return {
    version: 1,
    ...params,
    signatures: approvingSigners.map((s) => ({
      signerPubKeyHex: bytesToHex(s.publicKey).toLowerCase(),
      signatureHex: bytesToHex(signEd25519(s.privateKey, digest)),
    })),
  };
}

/**
 * Allows surviving M-of-N maintainers to revoke compromised release keys and rotate replacements
 * WITHOUT founder-only authority (IA-01 Section 8).
 */
export function verifyAndApplyReleaseSignerRotation(
  rotation: SignedReleaseSignerRotation,
  currentTrustedPubKeysHex: readonly string[],
  threshold: number,
): { valid: boolean; nextTrustedPubKeysHex: string[]; reason?: string | undefined } {
  const trustedSet = new Set(currentTrustedPubKeysHex.map((k) => k.toLowerCase()));
  const revokedTargetSet = new Set(rotation.revokedPubKeysHex.map((k) => k.toLowerCase()));
  const canonical = JSON.stringify({
    version: 1,
    addedPubKeysHex: [...rotation.addedPubKeysHex].map((k) => k.toLowerCase()).sort(),
    issuedAt: rotation.issuedAt,
    revokedPubKeysHex: [...revokedTargetSet].sort(),
    sequence: rotation.sequence,
  });
  const digest = sha256(new TextEncoder().encode(`SOVRA-REL-KEYROT-v1:${canonical}`));

  // Compromised keys being revoked CANNOT vote to approve their own replacement quorum
  const validNonRevokedApprovers = new Set<string>();
  for (const s of rotation.signatures) {
    const pk = s.signerPubKeyHex.toLowerCase();
    if (!trustedSet.has(pk) || revokedTargetSet.has(pk) || validNonRevokedApprovers.has(pk)) continue;
    try {
      if (verifyEd25519(hexToBytes(pk), digest, hexToBytes(s.signatureHex))) {
        validNonRevokedApprovers.add(pk);
      }
    } catch {}
  }

  if (validNonRevokedApprovers.size < threshold) {
    return {
      valid: false,
      nextTrustedPubKeysHex: [...trustedSet],
      reason: `Signer rotation failed quorum: ${validNonRevokedApprovers.size}/${threshold}`,
    };
  }

  for (const rk of revokedTargetSet) trustedSet.delete(rk);
  for (const ak of rotation.addedPubKeysHex) trustedSet.add(ak.toLowerCase());
  return { valid: true, nextTrustedPubKeysHex: [...trustedSet] };
}
