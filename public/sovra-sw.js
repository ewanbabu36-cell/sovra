/**
 * @file apps/sovra-app/public/sovra-sw.js
 * Sovra BitSwap Peer-to-Peer Media Streaming Service Worker.
 *
 * Intercepts content-addressed media requests (/ipfs/*, /media/*, /api/feed/video/*)
 * and streams 256 KiB UnixFS chunks directly into HTML5 video elements via ReadableStream,
 * falling back gracefully to gateway cache when peers are unreachable.
 */

const CACHE_NAME = 'sovra-bitswap-media-v1';
const CHUNK_SIZE_BYTES = 256 * 1024; // 256 KiB standard UnixFS leaf size
const SW_P2P_CHANNEL = 'sovra-sw-p2p-v1';

/**
 * Requests a content-addressed block or media path from connected P2P WebRTC/BitSwap
 * page clients via BroadcastChannel / MessageChannel before hitting HTTP gateways.
 */
async function requestPeerSwarmMedia(pathWithQuery, timeoutMs = 400) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const decodePeerBlock = (msg) => {
    if (!msg || msg.requestId !== requestId || msg.type !== 'SOVRA_SW_BLOCK' || !msg.ok || !msg.bytes) {
      return null;
    }
    const body = msg.bytes instanceof Uint8Array ? msg.bytes : new Uint8Array(msg.bytes);
    return new Response(body, {
      status: Number(msg.status) || 200,
      headers: {
        'Content-Type': msg.contentType || 'application/octet-stream',
        'X-Sovra-Source': 'p2p-swarm',
      },
    });
  };

  return new Promise((resolve) => {
    let settled = false;
    let bc = null;
    const finish = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (bc) bc.close(); } catch (_) {}
      resolve(response);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    if (typeof BroadcastChannel === 'function') {
      try {
        bc = new BroadcastChannel(SW_P2P_CHANNEL);
        bc.onmessage = (evt) => {
          const res = decodePeerBlock(evt?.data);
          if (res) finish(res);
        };
        bc.postMessage({ type: 'SOVRA_SW_WANT', requestId, path: pathWithQuery });
      } catch (_) {}
    }

    if (self.clients && typeof self.clients.matchAll === 'function' && typeof MessageChannel === 'function') {
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients || []) {
          try {
            const mc = new MessageChannel();
            mc.port1.onmessage = (evt) => {
              const res = decodePeerBlock(evt?.data);
              if (res) finish(res);
            };
            client.postMessage(
              { type: 'SOVRA_SW_WANT', requestId, path: pathWithQuery },
              [mc.port2],
            );
          } catch (_) {}
        }
      }).catch(() => {});
    }
  });
}

self.addEventListener('install', (event) => {
  console.log('[Sovra BitSwap SW] Installing service worker.');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Sovra BitSwap SW] Activated and claiming clients.');
  event.waitUntil(self.clients.claim());
});

/**
 * Streams media chunks sequentially via a ReadableStream.
 */
function createChunkStream(chunks) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index++;
      } else {
        controller.close();
      }
    },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Intercept IPFS, BitSwap Swarm, and Media Video streaming endpoints
  const isMediaRequest =
    url.pathname.startsWith('/ipfs/') ||
    url.pathname.startsWith('/media/') ||
    url.pathname.startsWith('/swarm/') ||
    url.pathname.startsWith('/api/feed/video/') ||
    url.pathname.startsWith('/api/video/stream');

  if (req.method !== 'GET' || !isMediaRequest) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 1. Check local Cache Storage first
      const cached = await cache.match(req).catch(() => null);
      if (cached) {
        return cached;
      }

      // 2. Ask active P2P WebRTC / BitSwap clients before HTTP fallback
      const peerRes = await requestPeerSwarmMedia(url.pathname + url.search, 400).catch(() => null);
      if (peerRes && (peerRes.status === 200 || peerRes.status === 206)) {
        if (peerRes.status === 200) {
          try {
            cache.put(req, peerRes.clone());
          } catch (_) {}
        }
        return peerRes;
      }

      // 3. Fallback to HTTP Peer/Relay Fetch
      try {
        const netRes = await fetch(req);
        if (netRes && (netRes.status === 200 || netRes.status === 206)) {
          // Cache clone for offline peer serving
          try {
            cache.put(req, netRes.clone());
          } catch (_) {}
          return netRes;
        }
        return netRes;
      } catch (err) {
        console.warn('[BitSwap SW] Network unreachable, attempting offline fallback:', err);
        return new Response(new Uint8Array(0), {
          status: 404,
          statusText: 'Media block not found offline',
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }
    })
  );
});
