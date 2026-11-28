import http from 'node:http';
import crypto from 'node:crypto';
import { ModerationWorker, type ScanJob } from './index.js';

export interface WorkerServerHandle {
  port: number;
  host: string;
  close: () => Promise<void>;
}

function timingSafeSecretEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function startModerationWorkerServer(options?: {
  port?: number;
  host?: string;
  worker?: ModerationWorker;
  serviceSecret?: string;
}): Promise<WorkerServerHandle> {
  const host = options?.host || process.env.HOST || '0.0.0.0';
  const port = options?.port ?? Number(process.env.PORT || 3021);
  const worker = options?.worker || new ModerationWorker();
  const serviceSecret = (options?.serviceSecret ?? process.env.SOVRA_INTERNAL_SERVICE_SECRET ?? '').trim();
  const startedAt = Date.now();
  let scannedTotal = 0;
  let rejectedTotal = 0;

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && (reqUrl.pathname === '/healthz' || reqUrl.pathname === '/readyz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'moderation-worker', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/metrics') {
      const body = [
        '# HELP sovra_moderation_scans_total Total content moderation scans processed',
        '# TYPE sovra_moderation_scans_total counter',
        `sovra_moderation_scans_total ${scannedTotal}`,
        '# HELP sovra_moderation_rejects_total Total moderation scans resulting in REJECT',
        '# TYPE sovra_moderation_rejects_total counter',
        `sovra_moderation_rejects_total ${rejectedTotal}`,
      ].join('\n') + '\n';
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(body);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/scan') {
      if (process.env.NODE_ENV === 'production' && !serviceSecret) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'SOVRA_INTERNAL_SERVICE_SECRET must be configured in production' }));
        return;
      }
      if (serviceSecret) {
        const provided = String(req.headers['x-sovra-service-secret'] || '');
        if (!timingSafeSecretEqual(serviceSecret, provided)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Unauthorized worker call' }));
          return;
        }
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const c of req) {
        total += (c as Buffer).length;
        if (total > 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
          return;
        }
        chunks.push(c as Buffer);
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as any;
        const job: ScanJob = {
          jobId: String(parsed.jobId || `scan_${Date.now()}`),
          contentCid: String(parsed.contentCid || 'unknown'),
          mimeType: String(parsed.mimeType || 'text/plain'),
          textContent: parsed.textContent ? String(parsed.textContent) : undefined,
          data: parsed.dataBase64 ? Buffer.from(String(parsed.dataBase64), 'base64') : undefined,
        };
        const result = await worker.scanContent(job);
        scannedTotal++;
        if (result.ok && result.value.suggestedDecision === 'REJECT') {
          rejectedTotal++;
        }
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
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
  startModerationWorkerServer().then((h) => {
    console.info(`[MODERATION-WORKER] Listening on ${h.host}:${h.port}`);
  }).catch((err) => {
    console.error('[MODERATION-WORKER] Fatal startup error:', err);
    process.exit(1);
  });
}
