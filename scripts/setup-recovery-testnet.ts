import * as fs from 'fs';
import * as path from 'path';

interface ValidatorInfo {
  name: string;
  address: string;
  pubKey: string;
  nodeId: string;
  rpcPort: number;
  p2pPort: number;
}

const validators: ValidatorInfo[] = [
  {
    name: 'validator-0',
    address: 'sovra1e4654fa45393171840964bce0716ea8d9742f6b8',
    pubKey: '9c7965188c69a5b8c69ff94e6ee6ff65b8d30bf8a9c5b75368ddbc9afae80e8d',
    nodeId: 'e4654fa45393171840964bce0716ea8d9742f6b8',
    rpcPort: 26757,
    p2pPort: 26756,
  },
  {
    name: 'validator-1',
    address: 'sovra1f7878b4c2f9e783c95feda305f1a7cbd30ed5df3',
    pubKey: '407e7d2d35ee9f071fdc74b50389d6ce6e1eb59713246209b6e13ca4fe9a405c',
    nodeId: 'f7878b4c2f9e783c95feda305f1a7cbd30ed5df3',
    rpcPort: 26767,
    p2pPort: 26766,
  },
  {
    name: 'validator-2',
    address: 'sovra13c97b27b53207767d67495900c3ab9d88a09e311',
    pubKey: '15c2de73d9195ad0b1866d1799f6bdcd25d8614afc08b84a12e93e18fafb56af',
    nodeId: '3c97b27b53207767d67495900c3ab9d88a09e311',
    rpcPort: 26777,
    p2pPort: 26776,
  },
  {
    name: 'validator-3',
    address: 'sovra1162e4bf6312e39ee210a94309cf3911f52798e90',
    pubKey: '2e428524e705d2face294d429286b94f96f46cda8db83e7a7182750dc7ab0053',
    nodeId: '162e4bf6312e39ee210a94309cf3911f52798e90',
    rpcPort: 26787,
    p2pPort: 26786,
  },
];

const chainId = 'sovra-recovery-1';
const baseDir = path.resolve('D:/Sovra/chain/recovery-testnet');
const rotatedKeystoresDir = path.resolve('D:/Sovra/chain/rotated_keystores');

// Construct genesis.json
const genesis = {
  chain_id: chainId,
  genesis_time: 1792070000,
  accounts: {
    [validators[0].address]: '7500000000000',
    [validators[1].address]: '7500000000000',
    [validators[2].address]: '7500000000000',
    [validators[3].address]: '7500000000000',
  },
  validators: validators.map((v) => ({
    name: v.name,
    address: v.address,
    pub_key: v.pubKey,
    voting_power: 25,
    node_id: v.nodeId,
    p2p_addr: `${v.nodeId}@127.0.0.1:${v.p2pPort}`,
  })),
  seed_nodes: [
    `${validators[0].nodeId}@127.0.0.1:${validators[0].p2pPort}`,
  ],
};

function setup() {
  console.log(`Setting up recovery testnet cluster in ${baseDir}...`);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  for (let i = 0; i < validators.length; i++) {
    const val = validators[i];
    const nodeDir = path.join(baseDir, `node${i}`);
    const keyringDir = path.join(nodeDir, 'keyring');
    fs.mkdirSync(keyringDir, { recursive: true });

    // Copy keystore
    const srcKs = path.join(rotatedKeystoresDir, `${val.name}.keystore`);
    const dstKs = path.join(keyringDir, `${val.name}.keystore`);
    fs.copyFileSync(srcKs, dstKs);

    // Other peers for p2p
    const otherPeers = validators
      .filter((_, idx) => idx !== i)
      .map((p) => `${p.nodeId}@127.0.0.1:${p.p2pPort}`);

    // Config
    const config = {
      moniker: val.name,
      chain_id: chainId,
      rpc_port: val.rpcPort,
      rpc_laddr: `tcp://0.0.0.0:${val.rpcPort}`,
      p2p_port: val.p2pPort,
      key_name: val.name,
      node_address: val.address,
      node_id: val.nodeId,
      p2p: {
        laddr: `tcp://0.0.0.0:${val.p2pPort}`,
        external_address: `127.0.0.1:${val.p2pPort}`,
        pex: true,
        seeds: otherPeers,
        persistent_peers: otherPeers,
        max_peers: 50,
      },
    };

    fs.writeFileSync(path.join(nodeDir, 'config.json'), JSON.stringify(config, null, 2));
    fs.writeFileSync(path.join(nodeDir, 'genesis.json'), JSON.stringify(genesis, null, 2));
    console.log(`Node ${i} (${val.name}) configured at ${nodeDir}`);
  }

  console.log('Recovery testnet cluster scaffolded successfully.');
}

setup();
