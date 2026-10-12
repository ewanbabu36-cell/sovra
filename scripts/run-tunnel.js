import { spawn } from 'node:child_process';

function startTunnel() {
  console.log('[Tunnel] Starting persistent localtunnel on port 3001...');
  const proc = spawn('npx.cmd', ['--yes', 'localtunnel', '--port', '3001', '--subdomain', 'sovra-mesh-live'], {
    stdio: 'inherit',
    shell: true,
  });

  proc.on('close', (code) => {
    console.log(`[Tunnel] Process closed with code ${code}, restarting in 2 seconds...`);
    setTimeout(startTunnel, 2000);
  });

  proc.on('error', (err) => {
    console.error('[Tunnel] Error:', err.message);
    setTimeout(startTunnel, 2000);
  });
}

startTunnel();
