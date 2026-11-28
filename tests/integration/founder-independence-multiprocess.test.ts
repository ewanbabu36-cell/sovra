import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  generateEd25519KeyPair,
} from '@sovra/crypto';
import {
  SovraIdentityModule,
  encodeSovraIdentityId,
} from '@sovra/identity';
import {
  createAndSignSovraSpecEvent,
  verifySovraSpecEvent,
} from '@sovra/protocol';
import { CID } from '@sovra/storage';

interface WorkerHandle {
  proc: ChildProcess;
  ready: {
    peerId: string;
    did: string;
    multiaddr: string;
    relayMultiaddr: string;
    httpUrl: string;
    p2pPort: number;
    httpPort: number;
  };
  dataDir: string;
}

const WORKER_SCRIPT = `
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { startVolunteerNodeDaemon } from ${JSON.stringify(pathToFileURL(path.resolve(process.cwd(), 'scripts/volunteer-node.ts')).href)};
import { CID } from ${JSON.stringify(pathToFileURL(path.resolve(process.cwd(), 'packages/storage/dist/index.js')).href)};
import { verifySovraSpecEvent } from ${JSON.stringify(pathToFileURL(path.resolve(process.cwd(), 'packages/protocol/dist/index.js')).href)};
import { hexToBytes } from ${JSON.stringify(pathToFileURL(path.resolve(process.cwd(), 'packages/crypto/dist/index.js')).href)};

const dataDir = process.env.WORKER_DATA_DIR;
const role = process.env.WORKER_ROLE || 'full';
const bootstrapPeers = process.env.WORKER_BOOTSTRAP_PEERS
  ? process.env.WORKER_BOOTSTRAP_PEERS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

const verifiedEvents = new Map();
const node = await startVolunteerNodeDaemon({
  role,
  dataDir,
  p2pPort: 0,
  p2pHost: '127.0.0.1',
  httpPort: 0,
  publicIp: '127.0.0.1',
  bootstrapPeers,
  enableStorage: true,
  enableDnsFallback: false,
  enableMdns: false,
});

node.p2pNode.reqResp.registerHandler('/sovra/event/1.0.0', async (_from, bytes) => {
  const req = JSON.parse(new TextDecoder().decode(bytes));
  if (req.op === 'publish' && req.event && req.signerPubHex) {
    const check = verifySovraSpecEvent(req.event, hexToBytes(req.signerPubHex));
    if (!check.ok) return new TextEncoder().encode(JSON.stringify({ ok: false, error: check.error?.message }));
    verifiedEvents.set(req.event.event_id, req.event);
    return new TextEncoder().encode(JSON.stringify({ ok: true, eventId: req.event.event_id }));
  }
  if (req.op === 'get' && req.eventId) {
    return new TextEncoder().encode(JSON.stringify({ ok: true, event: verifiedEvents.get(req.eventId) ?? null }));
  }
  return new TextEncoder().encode(JSON.stringify({ ok: false }));
});

console.log(JSON.stringify({
  type: 'READY',
  peerId: node.peerId,
  did: node.did,
  multiaddr: node.multiaddr,
  relayMultiaddr: node.relayMultiaddr,
  httpUrl: node.httpUrl,
  p2pPort: node.p2pPort,
  httpPort: node.httpPort,
}));

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  try {
    const cmd = JSON.parse(line);
    if (cmd.op === 'publishMedia') {
      const bytes = Buffer.from(cmd.base64, 'base64');
      const cid = CID.create('raw', bytes);
      await node.storageDaemon.blockstore.put(cid, bytes);
      await node.storageDaemon.pin(cid, { creatorDid: node.did, targetReplicationFactor: 2 });
      const rep = await node.storageDaemon.verifyReplicas();
      console.log(JSON.stringify({ id: cmd.id, ok: true, cid: cid.toString(), repairs: rep.ok ? rep.value.repairsTriggered : 0 }));
    } else if (cmd.op === 'retrieveMedia') {
      const cid = CID.parse(cmd.cid);
      const res = await node.storageDaemon.retrieveContent(cid);
      console.log(JSON.stringify({ id: cmd.id, ok: res.ok, base64: res.ok ? Buffer.from(res.value).toString('base64') : null, error: res.ok ? null : res.error?.message }));
    } else if (cmd.op === 'dial') {
      const ok = await node.dialSeedPeer(cmd.multiaddr);
      console.log(JSON.stringify({ id: cmd.id, ok }));
    } else if (cmd.op === 'pex') {
      const count = await node.p2pNode.requestPeerExchange(cmd.peerId);
      console.log(JSON.stringify({ id: cmd.id, ok: true, learned: count, peerBook: node.getPeerBook().map(p => p.peerId) }));
    } else if (cmd.op === 'publishEvent') {
      const r = await node.p2pNode.reqResp.sendRequest(
        cmd.targetPeerId,
        '/sovra/event/1.0.0',
        new TextEncoder().encode(JSON.stringify({ op: 'publish', event: cmd.event, signerPubHex: cmd.signerPubHex })),
      );
      console.log(JSON.stringify({ id: cmd.id, ok: r.ok, body: r.ok ? JSON.parse(new TextDecoder().decode(r.value)) : null }));
    } else if (cmd.op === 'peersJson') {
      const pFile = path.join(dataDir, 'peers.json');
      const peers = fs.existsSync(pFile) ? JSON.parse(fs.readFileSync(pFile, 'utf8')) : [];
      console.log(JSON.stringify({ id: cmd.id, ok: true, count: peers.length, peerIds: peers.map(p => p.peerId), multiaddrs: peers.map(p => p.multiaddr) }));
    } else if (cmd.op === 'stop') {
      await node.stop();
      console.log(JSON.stringify({ id: cmd.id, ok: true }));
      process.exit(0);
    }
  } catch (err) {
    console.log(JSON.stringify({ id: 0, ok: false, error: err?.message || String(err) }));
  }
});
`;

async function spawnWorker(
  workerScriptPath: string,
  dataDir: string,
  role: string,
  bootstrapPeers: string[],
  procsToKill: ChildProcess[],
): Promise<WorkerHandle> {
  const proc = spawn(
    process.execPath,
    ['--experimental-strip-types', workerScriptPath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SOVRA_NO_DNS: 'true',
        WORKER_DATA_DIR: dataDir,
        WORKER_ROLE: role,
        WORKER_BOOTSTRAP_PEERS: bootstrapPeers.join(','),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  procsToKill.push(proc);

  const ready = await new Promise<WorkerHandle['ready']>((resolve, reject) => {
    let buf = '';
    let stderrBuf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Worker (${role}) READY timeout. stderr=${stderrBuf.slice(-500)}`));
      }
    }, 15000);
    proc.stdout.on('data', chunk => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'READY' && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(msg);
          }
        } catch {}
      }
    });
    proc.stderr.on('data', chunk => {
      stderrBuf += chunk.toString('utf8');
    });
    proc.on('exit', code => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`Worker exited early with code ${code}: ${stderrBuf.trim()}`));
      }
    });
  });

  return { proc, ready, dataDir };
}

async function rpcWorker(worker: WorkerHandle, cmd: Record<string, unknown>): Promise<any> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`Worker RPC timeout: ${String(cmd.op)}`)), 12000);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id === id) {
            clearTimeout(timer);
            worker.proc.stdout?.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch {}
      }
    };
    worker.proc.stdout?.on('data', onData);
    worker.proc.stdin?.write(`${JSON.stringify({ ...cmd, id })}\n`);
  });
}

describe('Stage 4 — Multi-Process Pre-Coupled Founder Disappearance & Independent Survival', () => {
  const procs: ChildProcess[] = [];
  const tmpDirs: string[] = [];

  afterEach(async () => {
    const exitWaits: Promise<void>[] = [];
    while (procs.length > 0) {
      const p = procs.pop()!;
      if (p.exitCode === null && !p.killed) {
        exitWaits.push(new Promise<void>(resolve => {
          const t = setTimeout(resolve, 1500);
          p.once('exit', () => { clearTimeout(t); resolve(); });
        }));
        try {
          p.kill('SIGKILL');
        } catch {}
      }
    }
    await Promise.allSettled(exitWaits);
    while (tmpDirs.length > 0) {
      try {
        fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
    }
  });

  it('survives permanent SIGKILL + disk deletion of pre-coupled founder process across independent OS processes', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-stage4-mp-'));
    tmpDirs.push(tmpRoot);
    const workerScriptPath = path.join(tmpRoot, 'node-worker.ts');
    fs.writeFileSync(workerScriptPath, WORKER_SCRIPT, 'utf8');

    const founderDir = path.join(tmpRoot, 'founder');
    const coopADir = path.join(tmpRoot, 'coop-a');
    const coopBDir = path.join(tmpRoot, 'coop-b');
    const joinerDir = path.join(tmpRoot, 'joiner');

    // 1. Boot Process 1: Founder node (initial bootstrap, HTTP seed API, and storage creator)
    const founder = await spawnWorker(workerScriptPath, founderDir, 'seed', [], procs);

    // 2. Boot Processes 2 & 3 ONLY pointed to Founder initial seed (genuine pre-shutdown coupling)
    const coopA = await spawnWorker(workerScriptPath, coopADir, 'full', [founder.ready.multiaddr], procs);
    const coopB = await spawnWorker(workerScriptPath, coopBDir, 'full', [founder.ready.multiaddr], procs);

    // Announce & exchange peers via PEX through Founder so CoopA learns CoopB in persisted peers.json
    expect((await rpcWorker(coopA, { op: 'pex', peerId: founder.ready.peerId })).ok).toBe(true);
    expect((await rpcWorker(coopB, { op: 'pex', peerId: founder.ready.peerId })).ok).toBe(true);
    expect((await rpcWorker(coopA, { op: 'pex', peerId: founder.ready.peerId })).peerBook).toContain(coopB.ready.peerId);
    expect((await rpcWorker(coopB, { op: 'dial', multiaddr: coopA.ready.multiaddr })).ok).toBe(true);

    // Verify Founder publishes content and pushes BitSwap replica onto CoopA before disappearing
    const contentText = 'Stage-4 Pre-Coupled Founder Content Surviving Permanent Teardown';
    const pubRes = await rpcWorker(founder, {
      op: 'publishMedia',
      base64: Buffer.from(contentText, 'utf8').toString('base64'),
    });
    expect(pubRes.ok).toBe(true);
    const sharedCid = pubRes.cid as string;
    expect(() => CID.parse(sharedCid)).not.toThrow();

    // Poll CoopA BitSwap receipt, then pin locally on CoopA/CoopB
    const waitStart = Date.now();
    let gotBeforeKill = false;
    while (Date.now() - waitStart < 6000) {
      const checkA = await rpcWorker(coopA, { op: 'retrieveMedia', cid: sharedCid });
      if (checkA.ok) {
        gotBeforeKill = true;
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    expect(gotBeforeKill).toBe(true);

    // 3. PERMANENTLY DESTROY FOUNDER PROCESS & FOUNDER DISK STATE
    const exitPromise = new Promise<void>(resolve => founder.proc.once('exit', () => resolve()));
    founder.proc.kill('SIGKILL');
    await exitPromise;
    expect(founder.proc.exitCode !== null || founder.proc.killed).toBe(true);
    fs.rmSync(founderDir, { recursive: true, force: true });
    expect(fs.existsSync(founderDir)).toBe(false);

    // Also verify Founder HTTP seed endpoint is completely unreachable
    await expect(fetch(`${founder.ready.httpUrl}/api/seeds`)).rejects.toThrow();

    // 4. Verify surviving CoopB discovers persisted CoopA after a fresh restart with ZERO founder/CLI bootstrap args
    const coopBStopExit = new Promise<void>(resolve => coopB.proc.once('exit', () => resolve()));
    await rpcWorker(coopB, { op: 'stop' });
    await coopBStopExit;

    const coopBRestarted = await spawnWorker(workerScriptPath, coopBDir, 'full', [], procs);
    const bPeers = await rpcWorker(coopBRestarted, { op: 'peersJson' });
    expect(bPeers.peerIds).toContain(coopA.ready.peerId);
    expect((await rpcWorker(coopBRestarted, { op: 'dial', multiaddr: coopA.ready.multiaddr })).ok).toBe(true);

    // 5. Boot Process 4 (brand-new Fresh Joiner) using ONLY surviving community address (no founder, no DNS)
    const joiner = await spawnWorker(workerScriptPath, joinerDir, 'full', [coopBRestarted.ready.multiaddr], procs);
    const pexFromCommunity = await rpcWorker(joiner, { op: 'pex', peerId: coopBRestarted.ready.peerId });
    expect(pexFromCommunity.peerBook).toContain(coopA.ready.peerId);

    // Fresh Joiner dials CoopA directly & retrieves Founder's original content CID via BitSwap after Founder is dead
    expect((await rpcWorker(joiner, { op: 'dial', multiaddr: coopA.ready.multiaddr })).ok).toBe(true);
    const recoveredMedia = await rpcWorker(joiner, { op: 'retrieveMedia', cid: sharedCid });
    expect(recoveredMedia.ok).toBe(true);
    expect(Buffer.from(recoveredMedia.base64, 'base64').toString('utf8')).toBe(contentText);

    // Fresh Joiner publishes signed SOVRA-EVT CBOR event verified by surviving CoopA
    const idMod = new SovraIdentityModule();
    const idObj = idMod.create(['social']);
    const devKeys = generateEd25519KeyPair();
    const evt = createAndSignSovraSpecEvent(
      {
        identity_id: encodeSovraIdentityId(Buffer.from(idObj.signing_public_key, 'hex')),
        device_id: 'joiner-dev-1',
        event_type: 'social.post',
        payload: { text: 'Published across real OS processes with founder terminated' },
        sequence: 1,
      },
      devKeys.privateKey,
    );
    expect(verifySovraSpecEvent(evt, devKeys.publicKey).ok).toBe(true);

    const evtPub = await rpcWorker(joiner, {
      op: 'publishEvent',
      targetPeerId: coopA.ready.peerId,
      event: evt,
      signerPubHex: Buffer.from(devKeys.publicKey).toString('hex'),
    });
    expect(evtPub.ok).toBe(true);
    expect(evtPub.body?.ok).toBe(true);
    expect(evtPub.body?.eventId).toBe(evt.event_id);
  }, 45000);
});
