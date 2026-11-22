import fs from 'node:fs';
import path from 'node:path';

function unifyConfigsAndState() {
  console.log("=== P2P NETWORK UNIFICATION & CANONICAL STATE RECONCILIATION ===");

  const peerAddresses = [
    "2a806ca82d506a025d580d40600abc77a69e10e7@127.0.0.1:26656",
    "664a83c922035ce28bb723e4e92aed1e60e26ea1@127.0.0.1:26666",
    "cb55be9a3d2afab1c9bcbffb88367bec797d11cb@127.0.0.1:26676",
    "d96f6140a4c4ae797d9e3a5badf467eb756d3d20@127.0.0.1:26686"
  ];

  for (let i = 0; i < 4; i++) {
    const cfgPath = `chain/mytestnet/node${i}/config.json`;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

    // All peers except self
    const peers = peerAddresses.filter((_, idx) => idx !== i);

    cfg.p2p = {
      laddr: `tcp://0.0.0.0:${26656 + i * 10}`,
      external_address: `127.0.0.1:${26656 + i * 10}`,
      pex: true,
      seeds: peers,
      persistent_peers: peers,
      max_peers: 50
    };

    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`Updated config for node${i} with ${peers.length} persistent peers.`);
  }

  // Synchronize Node 0 state from Node 1 (the canonical quorum state)
  const srcDb = path.resolve('chain/mytestnet/node1/data/sovradb');
  const dstDb = path.resolve('chain/mytestnet/node0/data/sovradb');

  console.log(`Synchronizing Node 0 state from ${srcDb} -> ${dstDb}...`);
  if (fs.existsSync(dstDb)) {
    fs.rmSync(dstDb, { recursive: true, force: true });
  }
  fs.mkdirSync(dstDb, { recursive: true });

  for (const f of fs.readdirSync(srcDb)) {
    if (f === 'LOCK') {
      fs.writeFileSync(path.join(dstDb, 'LOCK'), '');
      continue;
    }
    fs.copyFileSync(path.join(srcDb, f), path.join(dstDb, f));
  }
  console.log("Node 0 state synchronized from Node 1 canonical quorum database!");
}

unifyConfigsAndState();
