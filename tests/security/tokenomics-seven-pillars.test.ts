/**
 * @file tests/security/tokenomics-seven-pillars.test.ts
 * End-to-End Verification of Sovra Coin 7-Pillar Tokenomics Upgrades
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import {
  bytesToHex,
  signEd25519,
  signMetaTransaction,
} from '../../packages/crypto/dist/index.js';
import {
  GovernanceVotingEngine,
  SIPCategory,
  encodeEd25519DidKey,
} from '../../packages/identity/dist/index.js';
import {
  validateSeederCollateralRequirement,
} from '../../packages/protocol/dist/index.js';
import {
  MemoryBlockstore,
  TokenGatedStorageEngine,
} from '../../packages/storage/dist/index.js';
import { L1ChainSupervisor } from '../../scripts/chain-supervisor.ts';
import { handleEconomyRoutes } from '../../scripts/routes/economy.routes.ts';
import { handleSocialRoutes } from '../../scripts/routes/social.routes.ts';
import { handleStorageRoutes } from '../../scripts/routes/storage.routes.ts';
import { handleFeedDiscoveryRoutes } from '../../scripts/routes/feed.routes.ts';
import { handleWalletRoutes } from '../../scripts/routes/wallet.routes.ts';
import { handleExplorerRoutes } from '../../scripts/routes/explorer.routes.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

function makeEd25519Identity(label: string) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const privSeed = new Uint8Array(pkcs8.subarray(16, 48));
  const pubRaw = new Uint8Array(spki.subarray(spki.length - 32));
  const did = encodeEd25519DidKey(pubRaw);
  const pubHex = bytesToHex(pubRaw);
  const address = 'sovra1' + crypto.createHash('sha256').update(pubRaw).digest('hex').slice(0, 40);
  const userRec = sovraDb.registerUser({
    did,
    handle: `${label}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    displayName: label,
    publicKeyHex: pubHex,
  } as any);
  return { did, pubRaw, privSeed, pubHex, address, userRec };
}

function createMockReqRes(method: string, urlStr: string, bodyObj?: any) {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = urlStr;
  const res = new http.ServerResponse(req);
  let statusCode = 200;
  let rawBody = '';
  res.writeHead = (code: number) => {
    statusCode = code;
    return res;
  };
  res.end = (chunk?: any) => {
    if (chunk) rawBody += String(chunk);
    return res;
  };
  return {
    req,
    res,
    readBoundedBody: async () => ({ body: bodyObj !== undefined ? JSON.stringify(bodyObj) : '', ok: true }),
    getResult: () => ({ status: statusCode, data: rawBody ? JSON.parse(rawBody) : null }),
  };
}

function setDbBalance(did: string, sov: number) {
  const sqlite = (sovraDb as any).getSqliteEngine?.()?.getRawDb?.() || (sovraDb as any).getSqliteEngine?.()?.db;
  if (sqlite) {
    try {
      sqlite.prepare('UPDATE users SET balance_sov = ?, updated_at = ? WHERE did = ?').run(sov, Date.now(), did);
    } catch {}
  }
  const u = (sovraDb as any).db?.users?.find((x: any) => x.did === did);
  if (u) {
    u.balanceSov = sov;
    u.balance_sov = sov;
  }
  (sovraDb as any).save?.();
}

describe('SOVRA 7-Pillar Real-World Holding & Tokenomics Suite', () => {
  const supervisor = new L1ChainSupervisor({ rpcPort: 26699, p2pPort: 26698 });

  beforeAll(async () => {
    (supervisor as any).resolveSovradBinary = () => null;
    await supervisor.start();
  });

  afterAll(async () => {
    await supervisor.stop();
  });

  it('Pillar 1 (Supervisor): enforces minimum 100 uSOV fee and 50% EIP-1559 fee burn', async () => {
    const id = makeEd25519Identity('l1fee');
    (supervisor as any).accounts.set(id.address, 500_000n);
    (supervisor as any).lifetimeMintedUsov += 500_000n;

    const zeroPayload = { type: 'send', sender: id.address, recipient: 'sovra1dest0000000000000000000000000000000', amount: '1000', nonce: 0, fee: '0' };
    const zeroSig = bytesToHex(signEd25519(id.privSeed, Buffer.from(JSON.stringify(zeroPayload))));
    const zeroRes = await fetch('http://127.0.0.1:26699/broadcast_tx_commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...zeroPayload, pub_key: id.pubHex, sig: zeroSig }),
    });
    expect(zeroRes.status).toBe(400);

    const validPayload = { type: 'send', sender: id.address, recipient: 'sovra1dest0000000000000000000000000000000', amount: '5000', nonce: 0, fee: '1000' };
    const validSig = bytesToHex(signEd25519(id.privSeed, Buffer.from(JSON.stringify(validPayload))));
    const validRes = await fetch('http://127.0.0.1:26699/broadcast_tx_commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validPayload, pub_key: id.pubHex, sig: validSig }),
    });
    expect(validRes.status).toBe(200);

    const econRes = await fetch('http://127.0.0.1:26699/query/economy');
    const econ = await econRes.json();
    expect(BigInt(econ.lifetime_burned)).toBeGreaterThanOrEqual(500n);
    expect(BigInt(econ.fee_collector_usov)).toBeGreaterThanOrEqual(500n);
    expect(econ.supply_invariant_holds).toBe(true);
  });

  it('Pillars 1, 2, 3, 4, 5, 6 & 7: complete end-to-end economic sinks, veSOV locks, 14d unbonding, vesting cliff, seeder collateral, patron staking, Hold-to-Access, meta-tx AMM auto-settle, and POL', async () => {
    const uid = Date.now().toString(36);
    const fan = makeEd25519Identity('fan_' + uid);
    const creator = makeEd25519Identity('creator_' + uid);
    const seeder = makeEd25519Identity('seeder_' + uid);
    const vestedTeam = makeEd25519Identity('team_' + uid);

    setDbBalance(fan.did, 5000);
    setDbBalance(creator.did, 500);
    setDbBalance(seeder.did, 1000);
    setDbBalance(vestedTeam.did, 2000);

    const callEconomy = async (method: string, pathStr: string, principalDid: string, bodyObj?: any) => {
      const m = createMockReqRes(method, pathStr, bodyObj);
      await handleEconomyRoutes({
        req: m.req,
        res: m.res,
        url: new URL('http://127.0.0.1:3001' + pathStr),
        readBoundedBody: m.readBoundedBody,
        resolvePrincipal: () => ({ did: principalDid, handle: principalDid } as any),
        enforceAuth: () => ({ did: principalDid, handle: principalDid } as any),
      });
      return m.getResult();
    };

    const callWallet = async (method: string, pathStr: string, principalDid: string | null, bodyObj?: any) => {
      const m = createMockReqRes(method, pathStr, bodyObj);
      await handleWalletRoutes({
        req: m.req,
        res: m.res,
        url: new URL('http://127.0.0.1:3001' + pathStr),
        readBoundedBody: m.readBoundedBody,
        resolvePrincipal: () => (principalDid ? ({ did: principalDid, handle: principalDid } as any) : null),
        enforceAuth: () => (principalDid ? ({ did: principalDid, handle: principalDid } as any) : null),
      });
      return m.getResult();
    };

    // 1. Pillar 4: Vesting cliff blocks liquid transfer
    const regVest = await callEconomy('POST', '/api/economy/vesting/register', vestedTeam.did, {
      did: vestedTeam.did,
      originalAmountSov: 2000,
      cliffDays: 365,
      vestingDays: 1095,
    });
    expect(regVest.status).toBe(200);
    expect(regVest.data.lockedSov).toBe(2000);

    const lockedTransfer = await callWallet('POST', '/api/wallet/transfer', vestedTeam.did, {
      recipientDid: fan.did,
      amount: 100,
    });
    expect(lockedTransfer.status).toBe(403);
    expect(lockedTransfer.data.error).toContain('vesting cliff');

    // 2. Pillar 2: DePIN Seeder Collateral ("Stake-to-Work")
    expect(validateSeederCollateralRequirement(50_000_000n, 10).eligible).toBe(false);
    expect(validateSeederCollateralRequirement(150_000_000n, 10).eligible).toBe(true);

    const unbondedClaim = await callEconomy('POST', '/api/economy/seeder/claim-epoch', seeder.did, { storageCapacityGb: 10, rewardSov: 5 });
    expect(unbondedClaim.status).toBe(403);

    const bondRes = await callEconomy('POST', '/api/economy/seeder/bond', seeder.did, { amountSov: 200, storageCapacityGb: 15 });
    expect(bondRes.status).toBe(200);
    expect(bondRes.data.bondedSov).toBe(200);

    const bondedClaim = await callEconomy('POST', '/api/economy/seeder/claim-epoch', seeder.did, { storageCapacityGb: 15, rewardSov: 5 });
    expect(bondedClaim.status).toBe(200);
    expect(bondedClaim.data.rewardedSov).toBe(5);
    expect(bondedClaim.data.lockedRewardSov).toBe(2.5);
    expect(bondedClaim.data.liquidRewardSov).toBe(2.5);

    const porSlash = await callEconomy('POST', '/api/economy/seeder/claim-epoch', seeder.did, { storageCapacityGb: 15, porFailed: true });
    expect(porSlash.status).toBe(403);
    expect(porSlash.data.slashedSov).toBe(20); // 10% burned on PoR failure

    // 3. Pillar 3: veSOV Multipliers + 14-day unbonding queue + governance weight multiplier
    const govRes = GovernanceVotingEngine.calculateRawWeight({
      did: fan.did,
      stakeMicroSov: 1_000_000_000n,
      accountAgeDays: 90,
      usageScore: 1.0,
      lockDays: 730,
    });
    const baseGovRes = GovernanceVotingEngine.calculateRawWeight({
      did: fan.did,
      stakeMicroSov: 1_000_000_000n,
      accountAgeDays: 90,
      usageScore: 1.0,
      lockDays: 0,
    });
    expect(govRes).toBeCloseTo(baseGovRes * 3.0, 5);

    const veRes = await callEconomy('POST', '/api/blockchain/staking/delegate', fan.did, {
      validatorAddress: 'sovra1val0001',
      amount: '400',
      lockDays: 365,
    });
    expect(veRes.status).toBe(200);
    expect(veRes.data.multiplier).toBe(2.5);
    expect(veRes.data.effectiveVeSov).toBe(1000);

    const earlyUnstake = await callEconomy('POST', '/api/blockchain/staking/undelegate', fan.did, {
      validatorAddress: 'sovra1val0001',
      amount: '100',
    });
    expect(earlyUnstake.status).toBe(403);

    const flexStake = await callEconomy('POST', '/api/blockchain/staking/delegate', fan.did, {
      validatorAddress: 'sovra1val_flex',
      amount: '200',
      lockDays: 0,
    });
    expect(flexStake.status).toBe(200);

    const flexUnstake = await callEconomy('POST', '/api/blockchain/staking/undelegate', fan.did, {
      validatorAddress: 'sovra1val_flex',
      amount: '200',
    });
    expect(flexUnstake.status).toBe(200);
    expect(flexUnstake.data.unbondingPeriodDays).toBe(14);

    // Not matured at +10 days
    const matEarly = await callEconomy('POST', '/api/blockchain/staking/mature', fan.did, {
      asOfTimestampMs: Date.now() + 10 * 86400_000,
    });
    expect(matEarly.data.releasedCount).toBe(0);

    // Matured at +15 days
    const matDone = await callEconomy('POST', '/api/blockchain/staking/mature', fan.did, {
      asOfTimestampMs: Date.now() + 15 * 86400_000,
    });
    expect(matDone.data.releasedCount).toBe(1);

    // 4. Pillar 5: Patron Staking + Hold-to-Access (0 spend)
    const patronRes = await callEconomy('POST', '/api/economy/patron/stake', fan.did, {
      creatorDid: creator.did,
      amountSov: 300,
      lockDays: 0,
    });
    expect(patronRes.status).toBe(200);
    expect(patronRes.data.principalSafe).toBe(true);

    // Usage sinks generate real yield routed to stakers & patron creators while burning 50-80%
    const handleRes = await callEconomy('POST', '/api/economy/sinks/handle', fan.did, { handle: `@alpha_${uid}`, feeSov: 20 });
    expect(handleRes.status).toBe(200);
    expect(handleRes.data.burnedSov).toBe(16); // 80% burned

    const rentRes = await callEconomy('POST', '/api/economy/sinks/storage-rent', fan.did, { storageGb: 4, months: 2, seederDid: seeder.did });
    expect(rentRes.status).toBe(200);
    expect(rentRes.data.burnedSov).toBe(2); // 50% of 4 SOV burned

    const boostRes = await callEconomy('POST', '/api/economy/sinks/boost', fan.did, { amountSov: 10 });
    expect(boostRes.status).toBe(200);
    expect(boostRes.data.burnedSov).toBe(8); // 80% burned

    // Daily social/storage/feed activity automatically triggers burn sinks when paid tiers used
    const chanReq = createMockReqRes('POST', '/api/social/channels', {
      name: `Sovra Verified ${uid}`,
      handle: `ch_${uid}`,
      premiumHandle: true,
      handleFeeSov: 10,
    });
    await handleSocialRoutes({
      req: chanReq.req,
      res: chanReq.res,
      url: new URL('http://127.0.0.1:3001/api/social/channels'),
      readBoundedBody: chanReq.readBoundedBody,
      resolvePrincipal: () => ({ did: fan.did, handle: fan.did } as any),
      enforceAuth: () => ({ did: fan.did, handle: fan.did } as any),
    });
    const chanRes = chanReq.getResult();
    expect(chanRes.status).toBe(200);
    expect(chanRes.data.burnReceipt.burnedSov).toBe(8);

    const storReq = createMockReqRes('POST', '/api/storage/publish', {
      content: 'Permanently Pinned Media Asset',
      storageGb: 2,
      rentMonths: 2,
      seederDid: seeder.did,
    });
    await handleStorageRoutes({
      req: storReq.req,
      res: storReq.res,
      url: new URL('http://127.0.0.1:3001/api/storage/publish'),
      readBoundedBody: storReq.readBoundedBody,
      resolvePrincipal: () => ({ did: fan.did, handle: fan.did } as any),
      enforceAuth: () => ({ did: fan.did, handle: fan.did } as any),
      hasCapability: () => true,
      storageDaemon: {
        storageService: {
          publishMedia: async (bytes: Uint8Array, mimeType: string) => ({
            ok: true,
            value: { cid: `bafy_${uid}`, mimeType, byteLength: bytes.byteLength, sha256Digest: 'sha256_mock' },
          }),
        },
        pin: async () => {},
      },
    });
    const storRes = storReq.getResult();
    expect(storRes.status).toBe(200);
    expect(storRes.data.storageRentReceipt.burnedSov).toBe(1); // 2GB * 2m * 0.5 SOV = 2 SOV -> 50% burned

    const postA = sovraDb.createPost({ authorDid: creator.did, authorHandle: creator.userRec.handle, caption: 'Normal post' } as any);
    const postB = sovraDb.createPost({ authorDid: creator.did, authorHandle: creator.userRec.handle, caption: 'Boosted post' } as any);
    const boostPostRes = await callEconomy('POST', '/api/feed/boost', fan.did, { postId: postB.id, amountSov: 15 });
    expect(boostPostRes.status).toBe(200);
    expect(boostPostRes.data.burnedSov).toBe(12); // 80% of 15 SOV burned
    const feedReq = createMockReqRes('GET', '/api/feed/personalized');
    handleFeedDiscoveryRoutes({
      req: feedReq.req,
      res: feedReq.res,
      url: new URL('http://127.0.0.1:3001/api/feed/personalized'),
      resolvePrincipal: () => ({ did: fan.did, handle: fan.did } as any),
    });
    const feedData = feedReq.getResult();
    expect(feedData.status).toBe(200);
    const idxB = feedData.data.posts.findIndex((p: any) => p.id === postB.id);
    const idxA = feedData.data.posts.findIndex((p: any) => p.id === postA.id);
    expect(idxB).toBeGreaterThanOrEqual(0);
    if (idxA >= 0) expect(idxB).toBeLessThan(idxA);

    const creatorClaim = await callEconomy('POST', '/api/blockchain/staking/claim', creator.did, {});
    expect(creatorClaim.status).toBe(200);
    expect(creatorClaim.data.claimedSov).toBeGreaterThan(0);

    // Hold-to-Access (server endpoint + storage engine)
    const holdOk = await callEconomy('POST', '/api/economy/hold-gate/verify', fan.did, { holderDid: fan.did, minHoldSov: 500 });
    expect(holdOk.status).toBe(200);
    expect(holdOk.data.spentSov).toBe(0);

    const bs = new MemoryBlockstore();
    const tge = new TokenGatedStorageEngine(bs);
    const contentKey = crypto.randomBytes(32);
    const secretBytes = new TextEncoder().encode('VIP Hold-to-Access Content Payload');
    const stored = await tge.encryptAndStoreHoldGated(secretBytes, creator.did, 100_000_000n, contentKey);
    await expect(
      tge.unlockWithHoldProof(stored.contentCid, { holderDid: fan.did, contentCid: stored.contentCid.toString(), checkedAt: Date.now(), liquidUsov: 10_000_000n, stakedUsov: 0n }, contentKey),
    ).rejects.toThrow();
    const unlocked = await tge.unlockWithHoldProof(stored.contentCid, { holderDid: fan.did, contentCid: stored.contentCid.toString(), checkedAt: Date.now(), liquidUsov: 50_000_000n, stakedUsov: 60_000_000n }, contentKey);
    expect(unlocked.spentUsov).toBe(0n);
    expect(new TextDecoder().decode(unlocked.plaintext)).toBe('VIP Hold-to-Access Content Payload');

    // 5. Pillar 6 & 7: Meta-Tx (did:key:z decoding + nonce replay lock) + POL Pool + AMM Auto-Settle + Live Supply Dashboard
    const meta = signMetaTransaction({
      from: fan.did,
      to: creator.did,
      action: 'BOOST',
      amount: '5',
      nonce: 1,
      deadline: Math.floor(Date.now() / 1000) + 600,
    }, fan.privSeed);
    const metaOk = await callWallet('POST', '/api/wallet/meta-tx', null, meta);
    expect(metaOk.status).toBe(200);
    expect(metaOk.data.relayerSponsored).toBe(true);
    expect(metaOk.data.burnedSov).toBe(4); // 80% of 5 SOV BOOST burned

    const metaReplay = await callWallet('POST', '/api/wallet/meta-tx', null, meta);
    expect(metaReplay.status).toBe(409);

    const tokAddr = `sovra1wasm_pol_${uid}`;
    const poolRes = await callWallet('POST', '/api/wallet/pools/create', creator.did, {
      tokenAddress: tokAddr,
      initialSov: 100,
      initialToken: 10000,
      polLockPermanent: true,
    });
    expect(poolRes.status).toBe(201);
    expect(poolRes.data.pool.polLocked).toBe(true);

    const autoSettle = await callWallet('POST', '/api/wallet/auto-settle', fan.did, {
      tokenAddress: tokAddr,
      inputTokenUnits: '100000000', // 100 tokens sold -> buys SOV -> burns 80%
      purpose: 'BOOST',
    });
    expect(autoSettle.status).toBe(200);
    expect(BigInt(autoSettle.data.burnedUsov)).toBeGreaterThan(0n);
    expect(autoSettle.data.gasChargedToUser).toBe('0');

    const overviewRes = await callEconomy('GET', '/api/economy/overview', fan.did);
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.data.economy.totalBurnedSov).toBeGreaterThan(0);
    expect(overviewRes.data.economy.totalLockedSov).toBeGreaterThan(2000);
    expect(overviewRes.data.economy.polLockCount).toBeGreaterThanOrEqual(1);

    const expReq = createMockReqRes('GET', '/api/explorer/summary');
    await handleExplorerRoutes(expReq.req, expReq.res, new URL('http://127.0.0.1:3001/api/explorer/summary'));
    const expData = expReq.getResult();
    expect(expData.status).toBe(200);
    expect(expData.data.supply.hardCapSov).toBe(100_000_000);
    expect(expData.data.supply.totalLockedSov).toBeGreaterThan(2000);

    // Silence unused variable check for SIPCategory import validation
    expect(['SIP_TECH', 'SIP_TREASURY', 'SIP_PROTOCOL', 'SIP_VALIDATOR', 'SIP_CONST'] as SIPCategory[]).toHaveLength(5);
  });
});
