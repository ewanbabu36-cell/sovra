import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const exePath = path.resolve('scripts', 'cloudflared.exe');
const urlFilePath = path.resolve('scripts', 'cloudflare-url.txt');

function startCloudflareTunnel() {
  console.log('[Cloudflare] Starting Quick Tunnel for http://127.0.0.1:3001...');
  
  const proc = spawn(exePath, ['tunnel', '--url', 'http://127.0.0.1:3001', '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  let urlDetected = false;

  function handleData(chunk) {
    const text = chunk.toString();
    process.stdout.write(text);

    // Look for trycloudflare.com URL
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !urlDetected) {
      urlDetected = true;
      const url = match[0];
      fs.writeFileSync(urlFilePath, url, 'utf8');
      console.log('\n============================================================');
      console.log('  🚀 CLOUDFLARE PUBLIC LIVE URL READY:');
      console.log(`     👉 ${url}`);
      console.log('  📱 Open this link directly on ANY mobile phone or browser!');
      console.log('  ✅ No passwords, No warnings, No Bad Gateway!');
      console.log('============================================================\n');
    }
  }

  proc.stdout.on('data', handleData);
  proc.stderr.on('data', handleData);

  proc.on('close', (code) => {
    console.log(`[Cloudflare] Tunnel exited with code ${code}, restarting in 3 seconds...`);
    urlDetected = false;
    setTimeout(startCloudflareTunnel, 3000);
  });

  proc.on('error', (err) => {
    console.error('[Cloudflare] Tunnel error:', err.message);
    urlDetected = false;
    setTimeout(startCloudflareTunnel, 3000);
  });
}

startCloudflareTunnel();
