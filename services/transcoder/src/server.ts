import http from 'node:http';
import crypto from 'node:crypto';
import { TranscoderWorker, type TranscodeJob } from './index.js';

export interface TranscoderWorkerServerHandle {
  port: number;
  host: string;
  close: () => Promise<void>;
}

function timingSafeSecretEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function startTranscoderWorkerServer(options?: {
  port?: number;
  host?: string;
  worker?: TranscoderWorker;
  serviceSecret?: string;
}): Promise<TranscoderWorkerServerHandle> {
  const host = options?.host || process.env.HOST || '0.0.0.0';
  const port = options?.port ?? Number(process.env.PORT || 3023);
  const worker = options?.worker || new TranscoderWorker();
  const serviceSecret = (options?.serviceSecret ?? process.env.SOVRA_INTERNAL_SERVICE_SECRET ?? '').trim();
  const startedAt = Date.now();
  let jobsCompleted = 0;

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && (reqUrl.pathname === '/healthz' || reqUrl.pathname === '/readyz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'transcoder-worker', jobsCompleted, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/metrics') {
      const body = [
        '# HELP sovra_transcoder_jobs_completed_total Total multi-resolution HLS transcode jobs completed',
        '# TYPE sovra_transcoder_jobs_completed_total counter',
        `sovra_transcoder_jobs_completed_total ${jobsCompleted}`,
      ].join('\n') + '\n';
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(body);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/transcode') {
      if (process.env.NODE_ENV === 'production' && !serviceSecret) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'SOVRA_INTERNAL_SERVICE_SECRET must be configured in production' }));
        return;
      }
      if (serviceSecret) {
        const provided = String(req.headers['x-sovra-service-secret'] || '');
        if (!timingSafeSecretEqual(serviceSecret, provided)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Unauthorized transcoder worker call' }));
          return;
        }
      }

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
        const job: TranscodeJob = {
          jobId: String(parsed.jobId || `job_${Date.now()}`),
          sourceCid: String(parsed.sourceCid || 'bafybeisource'),
          targetResolutions: Array.isArray(parsed.targetResolutions) && parsed.targetResolutions.length > 0
            ? parsed.targetResolutions
            : ['360p', '720p', '1080p'],
          segmentDurationSeconds: Number(parsed.segmentDurationSeconds || 4),
        };
        const result = await worker.transcode(job);
        if (result.ok) jobsCompleted++;
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
  startTranscoderWorkerServer().then((h) => {
    console.info(`[TRANSCODER-WORKER] Listening on ${h.host}:${h.port}`);
  }).catch((err) => {
    console.error('[TRANSCODER-WORKER] Fatal startup error:', err);
    process.exit(1);
  });
}
