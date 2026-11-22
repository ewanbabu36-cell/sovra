import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

interface NodeProc {
  id: number;
  home: string;
  rpc: string;
  proc: ChildProcess;
}

const NODES = [
  { id: 0, rpcPort: 26657, p2pPort: 26656, home: 'chain/mytestnet/node0' },
  { id: 1, rpcPort: 26667, p2pPort: 26666, home: 'chain/mytestnet/node1' },
  { id: 2, rpcPort: 26677, p2pPort: 26676, home: 'chain/mytestnet/node2' },
  { id: 3, rpcPort: 26687, p2pPort: 26686, home: 'chain/mytestnet/node3' },
];

async function main() {
  console.log('--- STARTING 4-NODE SOVRA CLUSTER TEST ---');
  const procs: NodeProc[] = [];

  for (const n of NODES) {
    const binary = path.resolve('chain/sovrad.exe');
    const child = spawn(binary, [
      'start',
      `--home=${n.home}`,
      '--passphrase=sovra-testnet-secret',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (d) => {
      const line = d.toString().trim();
      if (line.includes('[BLOCK') || line.includes('Resumed chain') || line.includes('Round')) {
        console.log(`[Node ${n.id}] ${line}`);
      }
    });

    child.stderr?.on('data', (d) => {
      const line = d.toString().trim();
      if (line.includes('ERROR') || line.includes('failed')) {
        console.warn(`[Node ${n.id} ERR] ${line}`);
      }
    });

    procs.push({ id: n.id, home: n.home, rpc: `http://127.0.0.1:${n.rpcPort}`, proc: child });
  }

  console.log('All 4 nodes spawned. Waiting 8 seconds for P2P handshake and block production...');
  await new Promise((r) => setTimeout(r, 8000));

  console.log('\n--- QUERYING CLUSTER STATUS ---');
  for (const n of NODES) {
    try {
      const res = await fetch(`http://127.0.0.1:${n.rpcPort}/status`);
      const s = await res.json();
      console.log(`Node ${n.id} (RPC ${n.rpcPort}): Moniker=${s.moniker}, Height=${s.height}, AppHash=${s.app_hash}, Supply=${s.total_supply}`);
    } catch (err: any) {
      console.error(`Node ${n.id} failed to respond: ${err.message}`);
    }
  }

  console.log('\n--- QUERYING P2P NET_INFO ---');
  for (const n of NODES) {
    try {
      const res = await fetch(`http://127.0.0.1:${n.rpcPort}/net_info`);
      const info: any = await res.json();
      const result = info.result || info;
      const peerCount = result.peers?.length || result.n_peers || 0;
      console.log(`Node ${n.id}: Peer Count = ${peerCount}, Listeners = ${JSON.stringify(result.listeners)}`);
    } catch (err: any) {
      console.error(`Node ${n.id} net_info error: ${err.message}`);
    }
  }

  console.log('\nTerminating processes...');
  for (const p of procs) {
    p.proc.kill('SIGTERM');
  }
  await new Promise((r) => setTimeout(r, 1000));
  console.log('Cluster test finished.');
}

main().catch(console.error);
