/**
 * @file apps/sovra-mobile/src/services/release-updater.ts
 * Zero-Domain / Zero-Cloud Sovereign Release Updater.
 *
 * Fetches signed release manifests from active peer/relay mirrors (`/api/releases/latest`),
 * enforces M-of-N community maintainer signatures + mirror operator independence + anti-downgrade
 * policy via `@sovra/crypto`, and bit-for-bit verifies downloaded binary artifacts before install.
 */

import {
  verifySignedSoftwareRelease,
  verifyIndependentUpdateMirrors,
  type SignedReleaseManifest,
  type ReleaseVerificationPolicy,
} from '@sovra/crypto';
import { multiRelayManager } from './multi-relay-manager.js';

export type ReleaseFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface VerifiedReleaseDownload {
  readonly manifest: SignedReleaseManifest;
  readonly artifactBytes: Uint8Array;
  readonly validSigners: readonly string[];
  readonly validBuilders: readonly string[];
  readonly distinctOperators: readonly string[];
  readonly mirrorUri: string;
}

export interface VerifyAndDownloadOptions {
  readonly policy: ReleaseVerificationPolicy;
  readonly manifest?: SignedReleaseManifest;
  readonly mirrorBaseUrls?: readonly string[];
  readonly minIndependentOperators?: number;
  readonly fetcher?: ReleaseFetcher;
}

function defaultMirrorBases(): string[] {
  const candidates = [
    ...multiRelayManager.getAllRelays().map((r) => r.url),
    multiRelayManager.getActiveBaseUrl(),
  ];
  const deduped: string[] = [];
  for (const raw of candidates) {
    const clean = String(raw || '').trim().replace(/\/+$/, '');
    if (clean && !deduped.includes(clean)) {
      deduped.push(clean);
    }
  }
  return deduped;
}

function resolveArtifactFetchCandidates(
  manifest: SignedReleaseManifest,
  mirrorBaseUrls: readonly string[],
): Array<{ operatorId: string; url: string }> {
  const urls: Array<{ operatorId: string; url: string }> = [];
  const seen = new Set<string>();
  const addUrl = (operatorId: string, url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push({ operatorId, url });
    }
  };

  for (const m of manifest.mirrors ?? []) {
    const uri = String(m.uri || '').trim();
    if (/^https?:\/\//i.test(uri)) {
      addUrl(m.operatorId, uri);
    } else if (/^ipfs:\/\//i.test(uri)) {
      const cidPath = uri.replace(/^ipfs:\/\//i, '');
      for (const base of mirrorBaseUrls) {
        addUrl(m.operatorId, `${base}/ipfs/${cidPath}`);
      }
    } else if (uri.startsWith('/')) {
      for (const base of mirrorBaseUrls) {
        addUrl(m.operatorId, `${base}${uri}`);
      }
    }
  }

  for (const base of mirrorBaseUrls) {
    addUrl('active-relay', `${base}/api/releases/${encodeURIComponent(manifest.version)}/artifact`);
  }
  return urls;
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Triggers OS-level verified APK installation inside Android APK (defense-in-depth native SHA-256 check)
 * or saves the verified binary via browser download fallback.
 */
export function installVerifiedAndroidUpdate(download: VerifiedReleaseDownload): {
  launched: boolean;
  method: 'android-intent' | 'permission-required' | 'blob-download' | 'unsupported';
  reason?: string;
} {
  if (typeof window === 'undefined') {
    return { launched: false, method: 'unsupported', reason: 'No browser/WebView runtime' };
  }
  const updater = (window as any).SovraUpdaterNative;
  if (updater && typeof updater.verifyAndInstallApkBase64 === 'function') {
    try {
      const resRaw = updater.verifyAndInstallApkBase64(
        uint8ToBase64(download.artifactBytes),
        download.manifest.artifactSha256Hex,
      );
      const parsed = JSON.parse(String(resRaw || '{}'));
      if (parsed.permissionRequired) {
        return {
          launched: false,
          method: 'permission-required',
          reason: 'Enable Install Unknown Apps permission for Sovra and retry',
        };
      }
      if (!parsed.ok) {
        return { launched: false, method: 'unsupported', reason: parsed.error || 'Native APK install failed' };
      }
      return { launched: true, method: 'android-intent' };
    } catch (err) {
      return {
        launched: false,
        method: 'unsupported',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      const copy = new Uint8Array(download.artifactBytes.length);
      copy.set(download.artifactBytes);
      const blob = new Blob([copy.buffer], { type: 'application/vnd.android.package-archive' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `sovra-${download.manifest.version}-${download.manifest.platform}.apk`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
      return { launched: true, method: 'blob-download' };
    } catch {}
  }
  return { launched: false, method: 'unsupported', reason: 'SovraUpdaterNative bridge unavailable' };
}

/**
 * Queries peer/relay mirrors for `/api/releases/latest` without any hardcoded central CDN or domain.
 */
export async function fetchManifestFromMirrors(
  mirrorBaseUrls?: readonly string[],
  fetcher: ReleaseFetcher = (input, init) => multiRelayManager.nativeFetch(input, init),
): Promise<{ manifest: SignedReleaseManifest; sourceMirror: string }> {
  const bases = (mirrorBaseUrls && mirrorBaseUrls.length > 0 ? [...mirrorBaseUrls] : defaultMirrorBases())
    .map((u) => String(u || '').trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (bases.length === 0) {
    throw new Error('ERR_NO_RELEASE_MIRRORS: No volunteer relay/mirror URLs configured');
  }

  const errors: string[] = [];
  for (const base of bases) {
    const url = `${base}/api/releases/latest`;
    try {
      const res = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!res.ok) {
        errors.push(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as SignedReleaseManifest | { manifest?: SignedReleaseManifest };
      const manifest = (data && typeof data === 'object' && 'manifest' in data && data.manifest)
        ? data.manifest
        : (data as SignedReleaseManifest);
      if (!manifest || !manifest.version || !manifest.artifactSha256Hex) {
        errors.push(`${url} -> malformed manifest`);
        continue;
      }
      return { manifest, sourceMirror: base };
    } catch (err) {
      errors.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`ERR_NO_RELEASE_MANIFEST: Failed across ${bases.length} mirrors (${errors.join('; ')})`);
}

/**
 * Verifies mirror operator independence, validates M-of-N maintainer signatures & semver rules BEFORE
 * fetching bytes, then downloads artifact bytes from working mirrors and verifies SHA-256 bit-for-bit.
 */
export async function verifyAndDownloadUpdate(
  options: VerifyAndDownloadOptions,
): Promise<VerifiedReleaseDownload> {
  const fetcher: ReleaseFetcher =
    options.fetcher ?? ((input, init) => multiRelayManager.nativeFetch(input, init));
  const bases = options.mirrorBaseUrls && options.mirrorBaseUrls.length > 0
    ? options.mirrorBaseUrls.map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean)
    : defaultMirrorBases();

  const manifest = options.manifest ?? (await fetchManifestFromMirrors(bases, fetcher)).manifest;

  const minOps = options.minIndependentOperators ?? 2;
  const mirrorCheck = verifyIndependentUpdateMirrors(manifest, minOps);
  if (!mirrorCheck.valid) {
    throw new Error(`ERR_RELEASE_MIRROR_QUORUM: ${mirrorCheck.reason ?? 'Insufficient mirrors'}`);
  }

  const preCheck = verifySignedSoftwareRelease(manifest, options.policy);
  if (!preCheck.valid) {
    throw new Error(`ERR_RELEASE_SIGNATURE_REJECTED: ${preCheck.reason ?? 'Verification failed'}`);
  }

  const candidates = resolveArtifactFetchCandidates(manifest, bases);
  if (candidates.length === 0) {
    throw new Error('ERR_NO_FETCHABLE_ARTIFACT_MIRROR: No HTTP/IPFS gateway candidate resolved');
  }

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const res = await fetcher(candidate.url, { method: 'GET' });
      if (!res.ok) {
        failures.push(`${candidate.url} -> HTTP ${res.status}`);
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const fullCheck = verifySignedSoftwareRelease(manifest, options.policy, buf);
      if (!fullCheck.valid) {
        failures.push(`${candidate.url} -> ${fullCheck.reason ?? 'digest mismatch'}`);
        continue;
      }
      return {
        manifest,
        artifactBytes: buf,
        validSigners: fullCheck.validSigners,
        validBuilders: fullCheck.validBuilders ?? [],
        distinctOperators: mirrorCheck.distinctOperators,
        mirrorUri: candidate.url,
      };
    } catch (err) {
      failures.push(`${candidate.url} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`ERR_RELEASE_DOWNLOAD_VERIFICATION_FAILED: ${failures.join('; ')}`);
}
