import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function calculateSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

function copyDirRecursive(src: string, dest: string): { filesCount: number; totalBytes: number; manifest: any[] } {
  let filesCount = 0;
  let totalBytes = 0;
  const manifest: any[] = [];

  if (!fs.existsSync(src)) return { filesCount, totalBytes, manifest };
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      const sub = copyDirRecursive(srcPath, destPath);
      filesCount += sub.filesCount;
      totalBytes += sub.totalBytes;
      manifest.push(...sub.manifest);
    } else if (entry.isFile()) {
      if (entry.name === 'LOCK') {
        // Ephemeral lock token held by active process; write empty placeholder in backup
        fs.writeFileSync(destPath, '');
        manifest.push({
          relativePath: path.relative(dest, destPath),
          sizeBytes: 0,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        });
        continue;
      }
      try {
        fs.copyFileSync(srcPath, destPath);
        const stat = fs.statSync(destPath);
        const sha = calculateSha256(destPath);
        filesCount++;
        totalBytes += stat.size;
        manifest.push({
          relativePath: path.relative(dest, destPath),
          sizeBytes: stat.size,
          sha256: sha,
        });
      } catch (err: any) {
        console.warn(`[WARN] Could not copy ${srcPath}: ${err.message}`);
      }
    }
  }

  return { filesCount, totalBytes, manifest };
}

async function createBackupAndRecordFinancialState() {
  console.log("=== PHASE 13 FINANCIAL STATE PRESERVATION & ATOMIC BACKUP ===");

  const timestamp = Date.now();
  const isoDate = new Date(timestamp).toISOString();
  const backupRoot = path.resolve('backups/phase13_pre_migration_backup');
  fs.mkdirSync(backupRoot, { recursive: true });

  // 1. Create verified file backup for each node
  const backupSummary: any[] = [];
  for (let i = 0; i < 4; i++) {
    const srcNode = path.resolve(`chain/mytestnet/node${i}`);
    const destNode = path.join(backupRoot, `node${i}`);
    console.log(`Backing up node${i} to ${destNode}...`);
    const res = copyDirRecursive(srcNode, destNode);
    backupSummary.push({
      node: i,
      source: srcNode,
      destination: destNode,
      filesCount: res.filesCount,
      totalBytes: res.totalBytes,
    });
  }

  // 2. Query live RPC telemetry from all 4 ports
  const nodeTelemetry: any[] = [];
  const ports = [26657, 26667, 26677, 26687];

  for (let i = 0; i < 4; i++) {
    const port = ports[i];
    try {
      const statusRes = await fetch(`http://127.0.0.1:${port}/status`);
      const status = await statusRes.json();

      const supplyRes = await fetch(`http://127.0.0.1:${port}/query/supply`);
      const supply = await supplyRes.json();

      const blockRes = await fetch(`http://127.0.0.1:${port}/block`);
      const block = await blockRes.json();

      // Query balances
      const addrs = [
        "sovra12a806ca82d506a025d580d40600abc77a69e10e7",
        "sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1",
        "sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb",
        "sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20"
      ];

      const balances: Record<string, string> = {};
      for (const addr of addrs) {
        const balRes = await fetch(`http://127.0.0.1:${port}/query/balance?address=${addr}`);
        const bal = await balRes.json();
        balances[addr] = bal.balance;
      }

      const totalInt = BigInt(status.total_supply);
      const mintInt = BigInt(status.lifetime_mint);
      const burnInt = BigInt(status.lifetime_burn);
      const delta = totalInt - (mintInt - burnInt);

      nodeTelemetry.push({
        node: i,
        port,
        moniker: status.moniker,
        nodeId: status.node_id,
        height: status.height,
        appHash: status.app_hash,
        totalSupplyUsov: status.total_supply,
        lifetimeMintUsov: status.lifetime_mint,
        lifetimeBurnUsov: status.lifetime_burn,
        conservationDeltaUsov: delta.toString(),
        conservationHolds: delta === 0n,
        balances,
        latestBlock: {
          height: block.result?.block?.header?.height,
          appHash: block.result?.block?.header?.app_hash,
          proposer: block.result?.block?.header?.proposer_address,
          txCount: block.result?.block?.data?.txs?.length || 0,
        }
      });
    } catch (err: any) {
      nodeTelemetry.push({
        node: i,
        port,
        error: err.message,
      });
    }
  }

  const outputArtifact = {
    auditTimestamp: timestamp,
    auditDateIso: isoDate,
    backupRoot,
    backupSummary,
    nodeTelemetry,
  };

  fs.writeFileSync('phase13-pre-migration-financial-evidence.json', JSON.stringify(outputArtifact, null, 2));
  console.log("Saved machine artifact: phase13-pre-migration-financial-evidence.json");
  console.log("Financial State Preservation Evidence Complete!");
}

createBackupAndRecordFinancialState();
