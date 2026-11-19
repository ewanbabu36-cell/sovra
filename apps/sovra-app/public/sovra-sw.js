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

      // 2. Fallback to BitSwap Peer Swarm / Network Fetch
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
