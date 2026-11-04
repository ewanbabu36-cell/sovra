/**
 * SOVRA ANYCAST GEO-DISTRIBUTED EDGE CDN WORKER
 * Compatible with Cloudflare Workers, Fastly Compute@Edge, and V8 Edge Isolates.
 * Provides microsecond static caching, WebSocket signal pass-through, and Geo-steering.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. WebSocket & Real-time P2P Signaling Pass-Through (Do not cache)
    if (
      request.headers.get('Upgrade') === 'websocket' ||
      url.pathname.startsWith('/p2p-signal') ||
      url.pathname.startsWith('/api/chat/stream') ||
      url.pathname.startsWith('/api/spaces/live')
    ) {
      return fetch(request);
    }

    // 2. Compute Edge Region from incoming Geo Headers
    const clientCountry = request.headers.get('cf-ipcountry') || request.headers.get('x-country-code') || 'US';
    const clientRay = request.headers.get('cf-ray') || 'local-edge-isolate';
    let edgeRegion = 'us-east-virginia';

    if (['JP', 'KR', 'TW'].includes(clientCountry)) edgeRegion = 'asia-northeast-tokyo';
    else if (['SG', 'IN', 'ID', 'TH', 'MY', 'VN'].includes(clientCountry)) edgeRegion = 'asia-southeast-singapore';
    else if (['DE', 'FR', 'NL', 'GB', 'CH', 'SE'].includes(clientCountry)) edgeRegion = 'europe-west-frankfurt';
    else if (['BR', 'AR', 'CL'].includes(clientCountry)) edgeRegion = 'southamerica-east-saopaulo';

    // 3. Static Assets & Well-Known Edge Caching (Cache-First)
    const isStaticAsset =
      url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/.well-known/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.webmanifest');

    if (isStaticAsset && request.method === 'GET') {
      const cache = caches.default;
      let response = await cache.match(request);

      if (!response) {
        response = await fetch(request);
        if (response.status === 200) {
          const headers = new Headers(response.headers);
          headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
          headers.set('X-Sovra-Edge-Region', edgeRegion);
          headers.set('X-Sovra-Edge-Cache', 'MISS');
          headers.set('X-Edge-Ray', clientRay);

          const cachedResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });

          ctx.waitUntil(cache.put(request, cachedResponse.clone()));
          return cachedResponse;
        }
      } else {
        const headers = new Headers(response.headers);
        headers.set('X-Sovra-Edge-Cache', 'HIT');
        headers.set('X-Sovra-Edge-Region', edgeRegion);
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
    }

    // 4. Dynamic API Requests: Append Geo Latency metadata headers
    const originResponse = await fetch(request);
    const newHeaders = new Headers(originResponse.headers);
    newHeaders.set('X-Sovra-Edge-Region', edgeRegion);
    newHeaders.set('X-Sovra-Edge-Cache', 'BYPASS');

    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: newHeaders,
    });
  },
};
