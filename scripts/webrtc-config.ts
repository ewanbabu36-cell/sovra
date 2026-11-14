/**
 * @file scripts/webrtc-config.ts
 * Sovereign WebRTC STUN/TURN & NAT Traversal Configuration
 * 
 * Provides resilient, production-grade ICE server infrastructure for
 * peer-to-peer WebRTC video calling, audio calling, and 4K live broadcast mesh.
 * Traverses symmetric NATs, carrier-grade NATs (CGNAT), and corporate firewalls.
 */

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

export const SOVRA_DEFAULT_STUN_SERVERS: string[] = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
  'stun:stun.services.mozilla.com:3478',
];

export const SOVRA_DEFAULT_TURN_SERVERS: SovraIceServer[] = [
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: process.env.SOVRA_TURN_USERNAME || 'openrelayproject',
    credential: process.env.SOVRA_TURN_CREDENTIAL || 'openrelayproject',
  },
];

export const SOVRA_RTC_CONFIGURATION: SovraRtcConfiguration = {
  iceServers: [
    { urls: SOVRA_DEFAULT_STUN_SERVERS },
    ...SOVRA_DEFAULT_TURN_SERVERS,
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

export function getWebRtcConfiguration(): SovraRtcConfiguration {
  const customTurnUrl = process.env.SOVRA_TURN_URL;
  if (customTurnUrl) {
    return {
      ...SOVRA_RTC_CONFIGURATION,
      iceServers: [
        { urls: SOVRA_DEFAULT_STUN_SERVERS },
        {
          urls: customTurnUrl,
          username: process.env.SOVRA_TURN_USERNAME,
          credential: process.env.SOVRA_TURN_CREDENTIAL,
        },
      ],
    };
  }
  return SOVRA_RTC_CONFIGURATION;
}
