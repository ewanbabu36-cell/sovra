/**
 * @file scripts/webrtc-config.ts
 * Sovereign WebRTC STUN/TURN & NAT Traversal Configuration
 * 
 * Provides resilient, production-grade ICE server infrastructure for
 * peer-to-peer WebRTC video calling, audio calling, and 4K live broadcast mesh.
 * Traverses symmetric NATs, carrier-grade NATs (CGNAT), and corporate firewalls
 * across multi-continent geographic deployment zones.
 */

import crypto from 'node:crypto';

export interface SovraIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SovraRtcConfiguration {
  iceServers: SovraIceServer[];
  iceCandidatePoolSize: number;
  iceTransportPolicy?: 'all' | 'relay';
  bundlePolicy?: 'max-bundle' | 'max-compat' | 'balanced';
  rtcpMuxPolicy?: 'require' | 'negotiate';
}

export interface SovraTurnCredentials {
  username: string;
  credential: string;
  ttlSeconds: number;
  expiresAt: number;
}

export const SOVRA_DEFAULT_STUN_SERVERS: string[] = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
  'stun:stun.services.mozilla.com:3478',
];

/**
 * Multi-region geographically distributed Coturn relay endpoints
 */
export const SOVRA_REGIONAL_TURN_SERVERS: Record<string, string[]> = {
  'us-east': [
    'turn:turn-us-east.sovra.network:3478',
    'turn:turn-us-east.sovra.network:443?transport=tcp',
    'turns:turn-us-east.sovra.network:5349?transport=tcp',
  ],
  'eu-central': [
    'turn:turn-eu-central.sovra.network:3478',
    'turn:turn-eu-central.sovra.network:443?transport=tcp',
    'turns:turn-eu-central.sovra.network:5349?transport=tcp',
  ],
  'ap-south': [
    'turn:turn-ap-south.sovra.network:3478',
    'turn:turn-ap-south.sovra.network:443?transport=tcp',
    'turns:turn-ap-south.sovra.network:5349?transport=tcp',
  ],
};

export const SOVRA_COMMUNITY_TURN_SERVERS: SovraIceServer[] = [
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: process.env.SOVRA_TURN_USERNAME || 'openrelayproject',
    credential: process.env.SOVRA_TURN_CREDENTIAL || 'openrelayproject',
  },
];

export const SOVRA_DEFAULT_TURN_SERVERS: SovraIceServer[] =
  process.env.SOVRA_ENABLE_PUBLIC_TURN === 'true' ? [...SOVRA_COMMUNITY_TURN_SERVERS] : [];

/**
 * Generates RFC 5766 REST API ephemeral TURN credentials using HMAC-SHA1
 */
export function generateTurnCredentials(
  userDid?: string,
  secret?: string,
  ttlSeconds = 86400
): SovraTurnCredentials {
  const turnSecret = secret || process.env.SOVRA_TURN_SECRET || process.env.WEBRTC_TURN_SECRET || 'sovra-prod-turn-secret-change-before-apply';
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiresAt}:${userDid || 'sovra-peer'}`;
  const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
  return { username, credential, ttlSeconds, expiresAt };
}

function isZeroDomainWebRtcDefault(): boolean {
  return (
    process.env.SOVRA_NO_DNS !== 'false' &&
    process.env.SOVRA_ALLOW_PUBLIC_STUN !== 'true' &&
    process.env.SOVRA_ENABLE_PUBLIC_TURN !== 'true'
  );
}

export const SOVRA_RTC_CONFIGURATION: SovraRtcConfiguration = {
  iceServers: isZeroDomainWebRtcDefault()
    ? (process.env.SOVRA_STUN_SERVERS
        ? [{ urls: process.env.SOVRA_STUN_SERVERS.split(',').map(s => s.trim()).filter(Boolean) }]
        : [])
    : [
        { urls: SOVRA_DEFAULT_STUN_SERVERS },
        ...SOVRA_DEFAULT_TURN_SERVERS,
      ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

export interface WebRtcConfigOptions {
  userDid?: string;
  region?: string;
  privacyRelay?: boolean;
  zeroCloudMode?: boolean;
}

export function getWebRtcConfiguration(opts?: WebRtcConfigOptions | string): SovraRtcConfiguration {
  const userDid = typeof opts === 'string' ? opts : opts?.userDid;
  const region = typeof opts === 'object' ? opts?.region : undefined;
  const privacyRelay = typeof opts === 'object' ? Boolean(opts?.privacyRelay) : false;
  const zeroDomainActive = process.env.SOVRA_NO_DNS !== 'false';
  const zeroCloud = typeof opts === 'object' && opts?.zeroCloudMode !== undefined
    ? opts.zeroCloudMode
    : (process.env.SOVRA_ZERO_CLOUD_MODE === 'true' || zeroDomainActive);

  const customTurnUrl = process.env.SOVRA_TURN_URL || process.env.SOVRA_TURN_SERVERS;
  const turnSecret = process.env.SOVRA_TURN_SECRET || process.env.WEBRTC_TURN_SECRET;
  const customStunEnv = process.env.SOVRA_STUN_SERVERS || process.env.WEBRTC_STUN_SERVERS;
  const allowPublicStun = process.env.SOVRA_ALLOW_PUBLIC_STUN === 'true' || !zeroCloud;
  const stunUrls = customStunEnv
    ? customStunEnv.split(',').map(s => s.trim()).filter(Boolean)
    : (allowPublicStun ? SOVRA_DEFAULT_STUN_SERVERS : []);

  const creds = generateTurnCredentials(userDid, turnSecret);

  const turnServers: SovraIceServer[] = [];

  if (customTurnUrl) {
    turnServers.push({
      urls: customTurnUrl.split(',').map(s => s.trim()).filter(Boolean),
      username: creds.username,
      credential: creds.credential,
    });
  } else if (!zeroCloud) {
    if (region && SOVRA_REGIONAL_TURN_SERVERS[region.toLowerCase()]) {
      turnServers.push({
        urls: SOVRA_REGIONAL_TURN_SERVERS[region.toLowerCase()],
        username: creds.username,
        credential: creds.credential,
      });
    } else {
      for (const [, urls] of Object.entries(SOVRA_REGIONAL_TURN_SERVERS)) {
        turnServers.push({
          urls,
          username: creds.username,
          credential: creds.credential,
        });
      }
    }
    if (process.env.SOVRA_ENABLE_PUBLIC_TURN === 'true') {
      turnServers.push(...SOVRA_COMMUNITY_TURN_SERVERS);
    }
  }

  const baseStunEntries: SovraIceServer[] = stunUrls.length > 0 ? [{ urls: stunUrls }] : [];
  const iceServers: SovraIceServer[] = privacyRelay && turnServers.length > 0
    ? turnServers
    : [...baseStunEntries, ...turnServers];

  return {
    iceServers,
    iceCandidatePoolSize: 10,
    iceTransportPolicy: privacyRelay && turnServers.length > 0 ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}
