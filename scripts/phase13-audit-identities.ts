import fs from 'node:fs';
import crypto from 'node:crypto';

function auditIdentities() {
  const nodes = [0, 1, 2, 3];
  const identities: any[] = [];
  const genesisHashes: any[] = [];

  for (const i of nodes) {
    const keyPath = `chain/mytestnet/node${i}/validator-${i}.key.json`;
    const genPath = `chain/mytestnet/node${i}/genesis.json`;
    const cfgPath = `chain/mytestnet/node${i}/config.json`;

    const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    const genData = JSON.parse(fs.readFileSync(genPath, 'utf8'));
    const cfgData = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

    const genBuf = fs.readFileSync(genPath);
    const genHash = crypto.createHash('sha256').update(genBuf).digest('hex');
    genesisHashes.push({ node: i, hash: genHash });

    // Derive node_id from pub_key
    const pubKeyBytes = Buffer.from(keyData.pub_key, 'hex');
    const derivedNodeId = crypto.createHash('sha256').update(pubKeyBytes).digest('hex').substring(0, 40);

    // Get validator in genesis
    const genVal = genData.validators.find((v: any) => v.name === `validator-${i}`);

    identities.push({
      node: i,
      moniker: cfgData.moniker,
      address: keyData.address,
      pubKey: keyData.pub_key,
      privKeyLen: keyData.priv_key?.length || keyData.private_key?.length,
      derivedNodeId,
      cfgNodeId: cfgData.node_id,
      genNodeId: genVal?.node_id,
      genPubKey: genVal?.pub_key,
      votingPower: genVal?.voting_power,
      chainID: genData.chain_id
    });
  }

  console.log("=== CRYPTOGRAPHIC IDENTITY AUDIT ===");
  console.log(JSON.stringify(identities, null, 2));

  console.log("\n=== GENESIS HASH AUDIT ===");
  console.log(JSON.stringify(genesisHashes, null, 2));

  // Check uniqueness
  const pubKeys = new Set(identities.map(id => id.pubKey));
  const addresses = new Set(identities.map(id => id.address));
  const nodeIds = new Set(identities.map(id => id.derivedNodeId));

  console.log("\nUniqueness Check:");
  console.log(`4 unique pubkeys: ${pubKeys.size === 4}`);
  console.log(`4 unique addresses: ${addresses.size === 4}`);
  console.log(`4 unique node IDs: ${nodeIds.size === 4}`);
  console.log(`All genesis hashes match: ${genesisHashes.every(g => g.hash === genesisHashes[0].hash)}`);
}

auditIdentities();
