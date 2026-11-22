import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const binPath = fs.existsSync(path.resolve('D:/Sovra/chain/sovrad_v15_5.exe'))
  ? path.resolve('D:/Sovra/chain/sovrad_v15_5.exe')
  : path.resolve('D:/Sovra/chain/sovrad.exe');
const passphrase = 'sovra-validator-secure-rotated-2026';
const baseDir = path.resolve('D:/Sovra/chain/recovery-testnet');
const logsDir = path.join(baseDir, 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

console.log(`Starting 4 recovery nodes using binary: ${binPath}`);

for (let i = 0; i < 4; i++) {
  const homeDir = path.join(baseDir, `node${i}`);
  const outLog = fs.openSync(path.join(logsDir, `node${i}.log`), 'a');
  const errLog = fs.openSync(path.join(logsDir, `node${i}.err.log`), 'a');

  const child = spawn(
    binPath,
    ['start', '--home', homeDir, `--passphrase=${passphrase}`],
    {
      detached: true,
      stdio: ['ignore', outLog, errLog],
      env: {
        ...process.env,
        SOVRA_KEY_PASSPHRASE: passphrase,
      },
    }
  );

  child.unref();
  console.log(`Started node${i} (PID: ${child.pid}) with home ${homeDir}`);
}

console.log('All 4 recovery nodes spawned.');
