import http from 'node:http';
import crypto from 'node:crypto';
import { SearchWorker, type SearchQuery } from './index.js';

export interface SearchWorkerServerHandle {
  port: number;
  host: string;
  close: () => Promise<void>;
}

function timingSafeSecretEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function startSearchWorkerServer(options?: {
  port?: number;
  host?: string;
  worker?: SearchWorker;
  serviceSecret?: string;
}): Promise<SearchWorkerServerHandle> {
  const host = options?.host || process.env.HOST || '0.0.0.0';
  const port = options?.port ?? Number(process.env.PORT || 3022);
  const worker = options?.worker || new SearchWorker();
  const serviceSecret = (options?.serviceSecret ?? process.env.SOVRA_INTERNAL_SERVICE_SECRET ?? '').trim();
  const startedAt = Date.now();
  let queriesTotal = 0;

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && (reqUrl.pathname === '/healthz' || reqUrl.pathname === '/readyz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'search-worker', indexedDocs: worker.size(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/metrics') {
      const body = [
        '# HELP sovra_search_indexed_documents Current count of indexed search documents',
        '# TYPE sovra_search_indexed_documents gauge',
        `sovra_search_indexed_documents ${worker.size()}`,
        '# HELP sovra_search_queries_total Total search queries executed',
        '# TYPE sovra_search_queries_total counter',
        `sovra_search_queries_total ${queriesTotal}`,
      ].join('\n') + '\n';
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(body);
      return;
    }

    const requireSecret = (): boolean => {
      if (process.env.NODE_ENV === 'production' && !serviceSecret) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'SOVRA_INTERNAL_SERVICE_SECRET must be configured in production' }));
        return false;
      }
      if (serviceSecret) {
        const provided = String(req.headers['x-sovra-service-secret'] || '');
        if (!timingSafeSecretEqual(serviceSecret, provided)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Unauthorized search worker call' }));
          return false;
        }
      }
      return true;
    };

    if (req.method === 'POST' && (reqUrl.pathname === '/index' || reqUrl.pathname === '/search')) {
      if (!requireSecret()) return;
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const c of req) {
        total += (c as Buffer).length;
        if (total > 512 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
          return;
        }
        chunks.push(c as Buffer);
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as any;
        if (reqUrl.pathname === '/index') {
          if (parsed.type === 'PROFILE' || parsed.handle) {
            worker.indexProfile({
              did: String(parsed.did || parsed.id || ''),
              handle: String(parsed.handle || 'user'),
              displayName: String(parsed.displayName || parsed.title || 'User'),
              bio: parsed.bio ? String(parsed.bio) : undefined,
            });
          } else {
            worker.indexPost({
              id: String(parsed.id || `post_${Date.now()}`),
              authorDid: String(parsed.authorDid || 'did:sov:anon'),
              caption: String(parsed.caption || parsed.text || ''),
              tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : undefined,
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, indexedDocs: worker.size() }));
          return;
        }

        const q: SearchQuery = {
          query: String(parsed.query || ''),
          tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : undefined,
          type: parsed.type,
          limit: typeof parsed.limit === 'number' ? parsed.limit : undefined,
        };
        const result = await worker.search(q);
        queriesTotal++;
        res.writeHead(result.ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.ok ? { ok: true, result: result.value } : { ok: false, error: result.error.message }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON body' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    port: actualPort,
    host,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const isEntrypoint = !process.env.VITEST && Boolean(process.argv[1] && process.argv[1].endsWith('server.js'));
if (isEntrypoint) {
  startSearchWorkerServer().then((h) => {
    console.info(`[SEARCH-WORKER] Listening on ${h.host}:${h.port}`);
  }).catch((err) => {
    console.error('[SEARCH-WORKER] Fatal startup error:', err);
    process.exit(1);
  });
}
