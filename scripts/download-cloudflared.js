import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

async function downloadCloudflared() {
  const exePath = path.resolve('scripts', 'cloudflared.exe');
  if (fs.existsSync(exePath) && fs.statSync(exePath).size > 10000000) {
    console.log('[Cloudflare] cloudflared.exe already exists, size:', fs.statSync(exePath).size);
    return exePath;
  }

  const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  console.log('[Cloudflare] Downloading cloudflared-windows-amd64.exe from GitHub...');
  
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download cloudflared: ${res.status} ${res.statusText}`);
  }

  const fileStream = fs.createWriteStream(exePath);
  await pipeline(Readable.fromWeb(res.body), fileStream);
  
  const size = fs.statSync(exePath).size;
  console.log(`[Cloudflare] Download complete! Size: ${size} bytes (~${(size / (1024 * 1024)).toFixed(1)} MB)`);
  return exePath;
}

downloadCloudflared().catch(err => {
  console.error('[Cloudflare] Download error:', err);
  process.exit(1);
});
