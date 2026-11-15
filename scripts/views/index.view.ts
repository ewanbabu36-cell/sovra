/**
 * @file scripts/views/index.view.ts
 * Main Sovra SPA HTML View Assembler
 * Assembles styles, body layout, and client scripts into production response.
 */

import crypto from 'node:crypto';
import { sovraDb } from '../database-engine.ts';
import { renderGlobalStyles } from './styles.view.ts';
import { renderAppLayout, type AppLayoutContext } from './layout.view.ts';
import { renderClientScripts, type AppScriptContext } from './scripts.view.ts';
import { SOVRA_RTC_CONFIGURATION } from '../webrtc-config.ts';

export interface RenderAppHtmlParams {
  binding: any;
  masterKey: any;
  tcpPort: number;
  nodeUptime: number;
  storageDaemon: any;
  socialGraph: any;
  localFeed: any;
  reelsStore?: any[];
  creatorProfiles?: Record<string, any>;
  bitchatPeersStore?: any[];
  reelCommentsStore?: any[];
  longFormVideosCatalog?: any[];
  youtubeCommentsStore?: Record<string, any[]>;
  getIceServers?: (did?: string) => any[];
}

export function renderAppHtml(params: RenderAppHtmlParams): string {
  const {
    binding,
    masterKey,
    tcpPort,
    nodeUptime,
    storageDaemon,
    socialGraph,
    localFeed,
    reelsStore = sovraDb.getAllReels(),
    creatorProfiles = {},
    bitchatPeersStore = [],
    reelCommentsStore = [],
    longFormVideosCatalog = [],
    youtubeCommentsStore = {},
    getIceServers = () => [],
  } = params;

  const safeVideosCatalog = (longFormVideosCatalog && longFormVideosCatalog.length > 0)
    ? longFormVideosCatalog
    : [{
        id: 'yt-video-1',
        title: 'Decentralized 4K Master Video & BitSwap Swarm Distribution | Sovra Architecture Deep Dive',
        shortHeader: 'Sovra 4K Architecture Deep Dive',
        summary: '• RFC 8216 HLS Master & Variant Playlist architecture breakdown',
        category: 'Technology',
        channelName: 'SOVRA Protocol Lab',
        channelHandle: 'sovralab',
        channelAvatar: 'S',
        channelAvatarBg: '#0284c7',
        channelSubscribers: 1,
        channelSubscribersText: '1 subscriber',
        isSubscribed: true,
        views: 1,
        viewsText: '1 view',
        likes: 1,
        dislikes: 0,
        cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        duration: '14:20',
        durationSeconds: 860,
        publishedAt: 'Official Launch Broadcast',
        description: 'Official introduction to Sovra...',
      }];

  const livePosts = sovraDb.getAllPosts()
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 50);
  const livePeers = sovraDb.getAllPeers().slice(0, 30);
  const liveUsers = sovraDb.getAllUsers().slice(0, 30);
  const liveReels = sovraDb.getAllReels().slice(0, 15);
  let hostUser = sovraDb.findUserByDid(masterKey.did);
  if (hostUser && !hostUser.sessionToken) {
    hostUser.sessionToken = 'stk_' + crypto.randomBytes(24).toString('hex');
    sovraDb.save();
  }
  const hostSessionToken = hostUser?.sessionToken || '';
  const isCreatorModeActive = true;

  const layoutCtx: AppLayoutContext = {
    binding,
    masterKey,
    tcpPort,
    nodeUptime,
    storageDaemon,
    socialGraph,
    localFeed,
    hostUser,
    hostSessionToken,
    livePosts,
    livePeers,
    liveUsers,
    liveReels,
    isCreatorModeActive,
    reelsStore,
    longFormVideosCatalog: safeVideosCatalog,
    youtubeCommentsStore,
    getIceServers,
    SOVRA_RTC_CONFIGURATION,
    contactsStore: (sovraDb.getAllPeers ? sovraDb.getAllPeers() : []),
  };

  const scriptCtx: AppScriptContext = {
    binding,
    masterKey,
    hostUser,
    hostSessionToken,
    livePosts,
    reelsStore,
    creatorProfiles,
    bitchatPeersStore,
    reelCommentsStore,
    longFormVideosCatalog: safeVideosCatalog,
    youtubeCommentsStore,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <title>Sovra — Decentralized Social Platform</title>
  <meta name="theme-color" content="#18191a">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Sovra">
  <meta name="application-name" content="Sovra">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="mask-icon" href="/icon.svg" color="#1877f2">
  <meta name="msapplication-TileImage" content="/icon-512.png">
  <meta name="msapplication-TileColor" content="#18191a">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700;800&family=Roboto+Condensed:wght@700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/sovra.css">
  <script id="sovra-hydrated-state" type="application/json">
${JSON.stringify({
  hostSession: {
    did: masterKey.did,
    handle: hostUser ? hostUser.handle : "@laptop_host",
    token: hostSessionToken,
  },
  knownHandleDids: Object.fromEntries(sovraDb.getAllUsers().map(u => [u.handle.toLowerCase(), u.did])),
  knownUserTokens: Object.fromEntries(sovraDb.getAllUsers().filter(u => u.sessionToken).map(u => [u.did, u.sessionToken])),
  livePosts,
  reelsStore,
  creatorProfiles,
  bitchatPeersStore,
  reelCommentsStore,
  longFormVideosCatalog: safeVideosCatalog,
  youtubeCommentsStore,
})}
  </script>
  <script>
    window.__SOVRA_HYDRATED_STATE__ = JSON.parse(document.getElementById('sovra-hydrated-state').textContent || '{}');
  </script>
  <script src="/assets/sovra.bundle.js" defer></script>
</head>
${renderAppLayout(layoutCtx)}
${renderClientScripts(scriptCtx)}
</body>
</html>`;
}
