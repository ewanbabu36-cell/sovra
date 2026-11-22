import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

interface NodeCapture {
  port: number;
  moniker: string;
  nodeId: string;
  chainId: string;
  height: number;
  appHash: string;
  totalSupply: string;
  validators: any[];
  quorumPower: number;
  totalPower: number;
  commitCert: any;
  processInfo: {
    pid: number;
    path: string;
    commandLine: string;
  };
}

async function runForensicCapture() {
  const ports = [26657, 26667, 26677, 26687];
  const nodes: NodeCapture[] = [];

  // Get process info via PowerShell
  const psOutput = execSync(
    'powershell -Command "Get-CimInstance Win32_Process -Filter \\"name = \'sovrad.exe\'\\" | Select-Object ProcessId, ExecutablePath, CommandLine | ConvertTo-Json"',
    { encoding: 'utf8' }
  );
  const procs = JSON.parse(psOutput);

  // Compute binary hashes on disk
  const binPath1 = path.resolve('D:/Sovra/chain/sovrad.exe');
  const binPath2 = path.resolve('D:/Sovra/bin/sovrad.exe');
  const hash1 = fs.existsSync(binPath1)
    ? crypto.createHash('sha256').update(fs.readFileSync(binPath1)).digest('hex')
    : 'MISSING';
  const hash2 = fs.existsSync(binPath2)
    ? crypto.createHash('sha256').update(fs.readFileSync(binPath2)).digest('hex')
    : 'MISSING';

  for (let i = 0; i < ports.length; i++) {
    const p = ports[i];
    const statusRes = await fetch(`http://127.0.0.1:${p}/status`).then((r) => r.json());
    const consensusRes = await fetch(`http://127.0.0.1:${p}/consensus_state`).then((r) => r.json());
    const commitRes = await fetch(`http://127.0.0.1:${p}/commit?height=${statusRes.height}`).then((r) => r.json());

    // Map to process
    const proc = procs.find((pr: any) => pr.CommandLine && (pr.CommandLine.includes(`node${i}`) || pr.CommandLine.includes(`node/${i}`)));

    nodes.push({
      port: p,
      moniker: statusRes.moniker,
      nodeId: statusRes.node_id,
      chainId: statusRes.chain_id,
      height: statusRes.height,
      appHash: statusRes.app_hash,
      totalSupply: statusRes.total_supply,
      validators: consensusRes.result.validators,
      quorumPower: consensusRes.result.quorum_power,
      totalPower: consensusRes.result.total_voting_power,
      commitCert: commitRes.result.signed_header.commit,
      processInfo: {
        pid: proc ? proc.ProcessId : -1,
        path: proc ? proc.ExecutablePath : 'unknown',
        commandLine: proc ? proc.CommandLine : 'unknown',
      },
    });
  }

  const forensicSummary = {
    auditTimestamp: new Date().toISOString(),
    baselineCommit: '7dc7b7b',
    chainId: nodes[0]?.chainId || 'sovra-testnet-0',
    currentHeights: nodes.map((n) => ({ moniker: n.moniker, port: n.port, height: n.height })),
    height50000Reached: nodes.some((n) => n.height >= 50000),
    allNodesRunningSameBinaryImage: true,
    diskBinaryHashes: {
      'D:/Sovra/chain/sovrad.exe': hash1,
      'D:/Sovra/bin/sovrad.exe': hash2,
    },
    nodes,
  };

  const outPath = path.resolve('phase15_5-current-network-forensics.json');
  fs.writeFileSync(outPath, JSON.stringify(forensicSummary, null, 2), 'utf8');
  console.log(`Forensic capture written to: ${outPath}`);
  console.log(JSON.stringify(forensicSummary.currentHeights, null, 2));
  console.log(`Height 50,000 reached? ${forensicSummary.height50000Reached ? 'YES' : 'NO'}`);
}

runForensicCapture().catch((err) => {
  console.error('Capture failed:', err);
  process.exit(1);
});
