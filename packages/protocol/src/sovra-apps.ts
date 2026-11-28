import { bytesToHex, canonicalCborEncode, hexToBytes, sha256, signEd25519, verifyEd25519 } from '@sovra/crypto';
import { isValidSovraIdentityId } from '@sovra/identity';
import { Result, err, ok } from '@sovra/shared';
import { UnauthorizedOperationError, InvalidEventError } from './errors.js';

export type SovraAppCapability =
  | 'social.read'
  | 'social.post'
  | 'social.comment'
  | 'social.reaction'
  | 'market.read'
  | 'market.order'
  | 'business.manage'
  | 'messaging.send'
  | 'storage.pin'
  | 'governance.vote';

const ALLOWED_CAPABILITIES = new Set<string>([
  'social.read',
  'social.post',
  'social.comment',
  'social.reaction',
  'market.read',
  'market.order',
  'business.manage',
  'messaging.send',
  'storage.pin',
  'governance.vote',
]);

const FORBIDDEN_KEY_CAPABILITIES = new Set<string>([
  'identity.export_private_key',
  'identity.raw_signing_key',
  'keys.export',
  'keys.admin',
  '*',
]);

export interface AppPermissionManifest {
  readonly version: 1;
  readonly appId: string;
  readonly appName: string;
  readonly appVersion: string;
  readonly minProtocolVersion: string;
  readonly authorIdentityId: string;
  readonly authorPublicKeyHex: string;
  readonly requestedCapabilities: readonly string[];
  readonly artifactCid: string;
  readonly sandboxed: true;
  readonly signatureHex: string;
}

export interface ScopedAppGrant {
  readonly grantId: string;
  readonly appId: string;
  readonly userIdentityId: string;
  readonly userPublicKeyHex: string;
  readonly grantedCapabilities: readonly SovraAppCapability[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly signatureHex: string;
}

const textEncoder = new TextEncoder();

function appDigest(tag: string, data: unknown): Uint8Array {
  const tb = textEncoder.encode(tag);
  const cb = canonicalCborEncode(data);
  const out = new Uint8Array(tb.length + cb.length);
  out.set(tb, 0);
  out.set(cb, tb.length);
  return sha256(out);
}

/**
 * Sandboxed Third-Party Application Authorization Engine (Section 14 RFC SOVRA-APP):
 * - Signed manifests with explicit scoped capabilities
 * - Strict isolation blocking private key access or wildcard grants
 * - User-controlled revocable grants
 */
export class SovraAppPermissionEngine {
  private readonly grants = new Map<string, ScopedAppGrant>();
  private readonly revokedGrantIds = new Set<string>();

  public static createSignedManifest(
    unsigned: Omit<AppPermissionManifest, 'signatureHex'>,
    authorPrivateKey: Uint8Array,
  ): AppPermissionManifest {
    for (const cap of unsigned.requestedCapabilities) {
      if (FORBIDDEN_KEY_CAPABILITIES.has(cap) || !ALLOWED_CAPABILITIES.has(cap)) {
        throw new UnauthorizedOperationError(
          `App capability '${cap}' is forbidden or unrecognized; private identity key access is strictly blocked`,
        );
      }
    }
    const digest = appDigest('SOVRA-APP-MANIFEST-v1', unsigned);
    return {
      ...unsigned,
      signatureHex: bytesToHex(signEd25519(authorPrivateKey, digest)),
    };
  }

  public static verifyManifest(manifest: AppPermissionManifest): boolean {
    if (!manifest || manifest.version !== 1 || manifest.sandboxed !== true) return false;
    if (!isValidSovraIdentityId(manifest.authorIdentityId)) return false;
    for (const cap of manifest.requestedCapabilities) {
      if (FORBIDDEN_KEY_CAPABILITIES.has(cap) || !ALLOWED_CAPABILITIES.has(cap)) return false;
    }
    const { signatureHex, ...unsigned } = manifest;
    const digest = appDigest('SOVRA-APP-MANIFEST-v1', unsigned);
    try {
      return verifyEd25519(hexToBytes(manifest.authorPublicKeyHex), digest, hexToBytes(signatureHex));
    } catch {
      return false;
    }
  }

  public grantToApp(params: {
    manifest: AppPermissionManifest;
    userIdentityId: string;
    userPrivateKey: Uint8Array;
    userPublicKey: Uint8Array;
    approvedCapabilities: readonly SovraAppCapability[];
    ttlSeconds?: number | undefined;
  }): ScopedAppGrant {
    if (!SovraAppPermissionEngine.verifyManifest(params.manifest)) {
      throw new InvalidEventError('Cannot grant permissions to invalid or unsigned app manifest');
    }
    for (const cap of params.approvedCapabilities) {
      if (!params.manifest.requestedCapabilities.includes(cap)) {
        throw new UnauthorizedOperationError(`Capability '${cap}' was not declared in app manifest`);
      }
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + (params.ttlSeconds ?? 30 * 86400);
    const grantBody = {
      appId: params.manifest.appId,
      userIdentityId: params.userIdentityId,
      userPublicKeyHex: bytesToHex(params.userPublicKey),
      grantedCapabilities: [...params.approvedCapabilities].sort(),
      issuedAt,
      expiresAt,
    };
    const digest = appDigest('SOVRA-APP-GRANT-v1', grantBody);
    const grantId = `grant-${bytesToHex(digest).slice(0, 14)}`;
    const signatureHex = bytesToHex(signEd25519(params.userPrivateKey, digest));
    const grant: ScopedAppGrant = {
      grantId,
      ...grantBody,
      signatureHex,
    };
    this.grants.set(grantId, grant);
    return grant;
  }

  public revokeGrant(grantId: string): boolean {
    if (!this.grants.has(grantId)) return false;
    this.revokedGrantIds.add(grantId);
    return true;
  }

  public authorizeAppAction(
    grantId: string,
    requiredCapability: string,
    nowSec = Math.floor(Date.now() / 1000),
  ): Result<true, UnauthorizedOperationError> {
    if (FORBIDDEN_KEY_CAPABILITIES.has(requiredCapability)) {
      return err(new UnauthorizedOperationError('Apps may NEVER access user private identity keys'));
    }
    if (this.revokedGrantIds.has(grantId)) {
      return err(new UnauthorizedOperationError(`App grant '${grantId}' has been revoked`));
    }
    const grant = this.grants.get(grantId);
    if (!grant) {
      return err(new UnauthorizedOperationError(`Unknown app grant '${grantId}'`));
    }
    if (nowSec > grant.expiresAt) {
      return err(new UnauthorizedOperationError(`App grant '${grantId}' expired`));
    }
    const digest = appDigest('SOVRA-APP-GRANT-v1', {
      appId: grant.appId,
      userIdentityId: grant.userIdentityId,
      userPublicKeyHex: grant.userPublicKeyHex,
      grantedCapabilities: grant.grantedCapabilities,
      issuedAt: grant.issuedAt,
      expiresAt: grant.expiresAt,
    });
    if (!verifyEd25519(hexToBytes(grant.userPublicKeyHex), digest, hexToBytes(grant.signatureHex))) {
      return err(new UnauthorizedOperationError('App grant signature verification failed'));
    }
    if (!grant.grantedCapabilities.includes(requiredCapability as SovraAppCapability)) {
      return err(new UnauthorizedOperationError(`App lacks scoped capability '${requiredCapability}'`));
    }
    return ok(true);
  }
}
