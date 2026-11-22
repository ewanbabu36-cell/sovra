import fs from 'node:fs';
import path from 'node:path';

function getDirSize(dir: string): number {
  let size = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) size += getDirSize(full);
    else size += fs.statSync(full).size;
  }
  return size;
}

for (let i = 0; i < 4; i++) {
  const d = `chain/mytestnet/node${i}/data`;
  console.log(`Node ${i} data size: ${(getDirSize(d) / (1024 * 1024)).toFixed(2)} MB`);
}
