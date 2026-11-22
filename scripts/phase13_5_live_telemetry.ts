import fs from 'node:fs';
import path from 'node:path';

interface NodeStatus {
  port: number;
  moniker: string;
  node_id: string;
  chain_id: string;
  height: number;
  app_hash: string;
  total_supply: string;
  lifetime_mint: string;
  lifetime_burn: string;
  supply_correct: boolean;
}

interface PeerInfo {
  port: number;
  listening: boolean;
  n_peers: number;
  peers: any[];
}

async function fetchJson(url: string, timeoutMs = 2000): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err: any) {
    clearTimeout(id);
    throw err;
  }
}

async function captureTelemetry() {
  console.log('=== PHASE 13.5 LIVE TELEMETRY ACQUISITION ===');
  const ports = [26657, 26667, 26677, 26687];

  // 1. Initial snapshot of all 4 nodes
  const initialSnapshots: Record<number, NodeStatus> = {};
  for (const p of ports) {
    const s = await fetchJson(`http://127.0.0.1:${p}/status`);
    initialSnapshots[p] = {
      port: p,
      moniker: s.moniker,
      node_id: s.node_id,
      chain_id: s.chain_id,
      height: s.height,
      app_hash: s.app_hash,
      total_supply: s.total_supply,
      lifetime_mint: s.lifetime_mint,
      lifetime_burn: s.lifetime_burn,
      supply_correct: s.supply_correct,
    };
  }

  console.log('Initial Snapshot:');
  console.table(Object.values(initialSnapshots));

  // 2. Network info snapshot
  const netInfos: Record<number, PeerInfo> = {};
  for (const p of ports) {
    try {
      const net = await fetchJson(`http://127.0.0.1:${p}/net_info`);
      netInfos[p] = {
        port: p,
        listening: net.result?.listening ?? true,
        n_peers: net.result?.n_peers ?? (net.result?.peers?.length || 0),
        peers: net.result?.peers || [],
      };
    } catch (e: any) {
      netInfos[p] = { port: p, listening: false, n_peers: 0, peers: [] };
    }
  }

  // 3. Multi-block continuous observation (10 sample rounds at 1s intervals)
  const blockProgression: Array<{
    timestamp: number;
    isoTime: string;
    heights: Record<number, number>;
    appHashes: Record<number, string>;
    supplies: Record<number, string>;
    lockstepInSync: boolean;
  }> = [];

  console.log('Collecting 10 consecutive observation intervals...');
  for (let round = 1; round <= 10; round++) {
    const ts = Date.now();
    const heights: Record<number, number> = {};
    const appHashes: Record<number, string> = {};
    const supplies: Record<number, string> = {};

    // Query in parallel
    await Promise.all(
      ports.map(async (p) => {
        try {
          const s = await fetchJson(`http://127.0.0.1:${p}/status`);
          heights[p] = s.height;
          appHashes[p] = s.app_hash;
          supplies[p] = s.total_supply;
        } catch (e: any) {
          heights[p] = -1;
          appHashes[p] = 'ERROR';
          supplies[p] = '0';
        }
      })
    );

    // Check if heights are within +/- 1 block of each other (propagation delay window)
    const hVals = Object.values(heights);
    const minH = Math.min(...hVals);
    const maxH = Math.max(...hVals);
    const lockstepInSync = (maxH - minH) <= 1;

    blockProgression.push({
      timestamp: ts,
      isoTime: new Date(ts).toISOString(),
      heights,
      appHashes,
      supplies,
      lockstepInSync,
    });

    console.log(
      `Round ${round}: Heights=[0:${heights[26657]}, 1:${heights[26667]}, 2:${heights[26677]}, 3:${heights[26687]}] Delta=${maxH - minH} InSync=${lockstepInSync}`
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // 4. Sample latest block data from Node 0
  let sampleBlock: any = null;
  try {
    sampleBlock = await fetchJson(`http://127.0.0.1:26657/block`);
  } catch (e: any) {
    console.warn('Could not fetch sample block:', e.message);
  }

  const evidence = {
    timestamp: Date.now(),
    isoDate: new Date().toISOString(),
    auditTarget: 'SOVRA Phase 13.5 Independent Consensus Certification',
    initialSnapshots,
    netInfos,
    blockProgression,
    sampleBlock,
    summary: {
      allNodesResponding: Object.values(initialSnapshots).length === 4,
      chainIdConsistent: Object.values(initialSnapshots).every(
        (s) => s.chain_id === 'sovra-testnet-0'
      ),
      totalSupplyConsistent: Object.values(initialSnapshots).every(
        (s) => s.total_supply === initialSnapshots[26657].total_supply
      ),
      supplyConservationCorrect: Object.values(initialSnapshots).every(
        (s) => s.supply_correct === true
      ),
      sustainedBlockProduction:
        blockProgression[9].heights[26657] > blockProgression[0].heights[26657],
    },
  };

  const outPath = path.resolve('phase13_5-live-consensus-evidence.json');
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), 'utf-8');
  console.log(`Saved live consensus telemetry evidence to ${outPath}`);
}

captureTelemetry().catch((err) => {
  console.error('Fatal telemetry error:', err);
  process.exit(1);
});
