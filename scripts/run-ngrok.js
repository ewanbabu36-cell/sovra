import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const exePath = path.resolve('scripts', 'ngrok.exe');
const urlFilePath = path.resolve('scripts', 'ngrok-url.txt');

function startNgrokTunnel() {
  console.log('[ngrok] Starting tunnel for http://localhost:3001...');

  const proc = spawn(exePath, ['http', '3001', '--log=stdout'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  let urlDetected = false;

  function handleData(chunk) {
    const text = chunk.toString();
    
    // Look for ngrok URL
    const match = text.match(/url=(https:\/\/[a-zA-Z0-9-]+\.ngrok-free\.dev)/);
    if (match && !urlDetected) {
      urlDetected = true;
      const url = match[1];
      try {
        fs.writeFileSync(urlFilePath, url, 'utf8');
      } catch (_) {}
      console.log('\n============================================================');
      console.log('  🚀 NGROK PUBLIC LIVE URL READY:');
      console.log(`     👉 ${url}`);
      console.log('============================================================\n');
    }

    if (text.includes('ERR_NGROK')) {
      console.error(text);
    }
  }

  proc.stdout.on('data', handleData);
  proc.stderr.on('data', handleData);

  proc.on('close', (code) => {
    console.log(`[ngrok] Tunnel closed with code ${code}, restarting in 3 seconds...`);
    urlDetected = false;
    setTimeout(startNgrokTunnel, 3000);
  });

  proc.on('error', (err) => {
    console.error('[ngrok] Tunnel error:', err.message);
    urlDetected = false;
    setTimeout(startNgrokTunnel, 3000);
  });
}

startNgrokTunnel();
