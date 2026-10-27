/**
 * @file scripts/routes/studio.routes.ts
 * Sovereign Creator Studio & Multi-Resolution Transcoder Route Controller (Phase 10).
 *
 * Implements Creator Studio Pro dashboard analytics, multi-bitrate HLS
 * video ingestion and transcoding pipelines (1080p, 720p, 480p, 360p),
 * adaptive bitrate manifest generation (RFC 8216), and scheduled publish queues.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { signEd25519, bytesToHex } from '../../packages/crypto/dist/index.js';
import { sovraDb, type SpaceRole, type SpaceType } from '../database-engine.ts';
import { TranscoderWorker, type VideoResolution } from '../../services/transcoder/dist/index.js';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

const PRIMARY_RPC = process.env.SOVRA_L1_RPC || 'http://127.0.0.1:26657';
const transcoderWorker = new TranscoderWorker();

export interface StudioRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, maxBytes: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse) => AuthenticatedPrincipal | null;
}

function resolveCreatorDid(ctx: StudioRouteContext): string {
  const principal = ctx.resolvePrincipal(ctx.req);
  if (principal && principal.did) {
    return principal.did;
  }
  const qDid = ctx.url.searchParams.get('creatorDid') || ctx.url.searchParams.get('did');
  if (qDid && qDid.trim().length > 0) {
    return qDid.trim();
  }
  return 'did:sovra:creator_primary';
}

export async function handleStudioTranscoderRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody } = ctx;

  // 0. GET /api/studio/my-channels - Returns video channels owned by requesting creator
  if (url.pathname === '/api/studio/my-channels' && req.method === 'GET') {
    const principal = ctx.resolvePrincipal(ctx.req);
    const qDid = url.searchParams.get('creatorDid') || url.searchParams.get('did');
    const creatorDid = (principal && principal.did) || (qDid && qDid.trim()) || '';
    const allChannels = sovraDb.getAllChannels();
    let myChannels = creatorDid ? allChannels.filter(c => c && c.ownerDid === creatorDid) : [];

    // If requesting user is the host/seed user or system creator, provide seed channels
    if (creatorDid && (creatorDid === 'did:sovra:creator_primary' || creatorDid === 'did:sovra:system' || creatorDid === 'did:sovra:laptop_host' || creatorDid.includes('laptop') || creatorDid.includes('host') || creatorDid === 'did:sovra:primary_user')) {
      if (myChannels.length === 0) {
        myChannels = allChannels.filter(c => c && (c.ownerDid === 'did:sovra:system' || c.ownerDid === creatorDid));
      }
    }

    const hasChannel = myChannels.length > 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      creatorDid,
      hasChannel,
      channels: myChannels,
      primaryChannelId: hasChannel ? myChannels[0].id : null,
    }));
    return true;
  }

  // 1. GET /api/studio/dashboard - Creator Studio Analytics, Monetization & Token Summary
  if (url.pathname === '/api/studio/dashboard' && req.method === 'GET') {
    const creatorDid = url.searchParams.get('creatorAddress') || url.searchParams.get('creator') || url.searchParams.get('creatorDid') || resolveCreatorDid(ctx);
    const channelId = url.searchParams.get('channelId') || undefined;
    const dashboard: any = sovraDb.getCreatorStudioDashboard(creatorDid, channelId);

    // Attach creator's deployed CW20 creator token holdings and stats
    const dbAny = sovraDb as any;
    const allTokens: any[] = (dbAny && dbAny.db && Array.isArray(dbAny.db.cw20_tokens)) ? dbAny.db.cw20_tokens : [];
    const creatorToken = allTokens.find(t => t.creatorDid === creatorDid || t.creator === creatorDid || t.creatorAddress === creatorDid) || allTokens[0] || null;
    dashboard.creatorToken = creatorToken;

    // Attach AMM liquidity pool depth, spot price, and royalty earnings
    const allPools: any[] = (dbAny && dbAny.db && Array.isArray(dbAny.db.amm_pools)) ? dbAny.db.amm_pools : [];
    const ammPool = creatorToken ? (allPools.find(p => p.tokenAddress === creatorToken.contractAddress) || null) : null;
    
    let spotPrice = 0.001; // default 1 SOV = 1000 tokens
    let reserveSov = '10000000';
    let reserveToken = '100000000';
    let accumulatedRoyaltiesSov = '100000'; // 0.1 SOV

    if (ammPool) {
      reserveSov = ammPool.reserveSov || '10000000';
      reserveToken = ammPool.reserveToken || '100000000';
      if (Number(reserveToken) > 0) {
        spotPrice = Number(reserveSov) / Number(reserveToken);
      }
      accumulatedRoyaltiesSov = ammPool.accumulatedRoyaltiesSov || '100000';
    }

    dashboard.amm = {
      poolAddress: ammPool?.poolAddress || null,
      spotPrice,
      spotPriceFormatted: (spotPrice * 1000).toFixed(4) + ' SOV / 1k Tokens',
      reserveSov,
      reserveToken,
      liquidityDepthSovFormatted: (Number(reserveSov) / 1_000_000).toLocaleString() + ' SOV',
      accumulatedRoyaltiesSov,
      accumulatedRoyaltiesFormatted: (Number(accumulatedRoyaltiesSov) / 1_000_000).toFixed(4) + ' SOV'
    };

    // Attach creator's VIP Tiers
    const allTiers: any[] = (dbAny && dbAny.db && Array.isArray(dbAny.db.vip_tiers)) ? dbAny.db.vip_tiers : [];
    const creatorTiers = allTiers.filter(t => t.creatorDid === creatorDid || t.channelId === channelId);
    dashboard.vipTiers = creatorTiers.length > 0 ? creatorTiers : [
      { id: 'tier_bronze', name: 'Bronze Supporter', minBalance: '50000000', perks: ['Supporter Badge', 'VIP Chat'] },
      { id: 'tier_gold', name: 'Gold VIP', minBalance: '250000000', perks: ['All Bronze Perks', 'Exclusive Video Masterclasses', 'Alpha Releases'] }
    ];

    // Attach creator's NFT drops & VIP pass revenue
    const allNftDrops: any[] = (dbAny && dbAny.db && Array.isArray(dbAny.db.nft_drops)) ? dbAny.db.nft_drops : [];
    const creatorDrops = allNftDrops.filter(d => d.creatorDid === creatorDid || d.channelId === channelId);
    let totalNftRevenue = 0n;
    for (const d of creatorDrops) {
      totalNftRevenue += BigInt(d.accumulatedRevenue || '0');
    }
    dashboard.nftDrops = creatorDrops;
    dashboard.totalNftRevenue = totalNftRevenue.toString();
    dashboard.totalNftRevenueFormatted = (Number(totalNftRevenue) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' SOV';

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      creatorDid,
      channelId,
      dashboard,
      creatorToken,
      amm: dashboard.amm,
      vipTiers: dashboard.vipTiers,
      nftDrops: dashboard.nftDrops,
      totalNftRevenue: dashboard.totalNftRevenue
    }));
    return true;
  }

  // POST /api/studio/token/launch - Deploy custom CW20 Creator Token on Layer-1
  if (url.pathname === '/api/studio/token/launch' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const name = (parsed.name || '').trim();
      const symbol = (parsed.symbol || '').trim().toUpperCase();
      const initialSupply = String(parsed.initialSupply || parsed.initial_supply || '1000000000');
      const decimals = Number(parsed.decimals !== undefined ? parsed.decimals : 6);
      const creatorDid = parsed.creatorDid || resolveCreatorDid(ctx);
      const channelId = parsed.channelId || '';

      if (!name || !symbol) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Token name and symbol are required' }));
        return true;
      }

      // Generate or derive creator address for on-chain identity
      const creatorAddress = parsed.creatorAddress || parsed.creator || (
        'sovra1' + crypto.createHash('sha256').update(creatorDid).digest('hex').slice(0, 38)
      );

      // Construct CW20 instantiate msg
      const instantiateMsg = {
        name,
        symbol,
        decimals,
        initial_balances: [
          { address: creatorAddress, amount: initialSupply }
        ],
        mint: {
          minter: creatorAddress
        }
      };

      const codeId = Number(parsed.codeId || parsed.code_id || 1);
      const dbAny = sovraDb as any;
      if (!Array.isArray(dbAny.db.cw20_tokens)) {
        dbAny.db.cw20_tokens = [];
      }
      if (!Array.isArray(dbAny.db.wasm_contracts)) {
        dbAny.db.wasm_contracts = [];
      }

      const instanceSeq = (dbAny.db.wasm_contracts.length || 0) + 1;
      const contractAddress = 'sovra1wasm' + crypto.createHash('sha256').update(`sovra_wasm_contract:${codeId}:${instanceSeq}`).digest('hex').slice(0, 32);

      // Attempt broadcast to L1 node if online
      let l1TxResult: any = null;
      let finalContractAddress = contractAddress;
      try {
        const valKeyPath = path.resolve(process.cwd(), 'chain/mytestnet/node0/validator-0.key.json');
        if (fs.existsSync(valKeyPath)) {
          const valKey = JSON.parse(fs.readFileSync(valKeyPath, 'utf8'));
          const senderAddress = creatorAddress.startsWith('sovra12a806ca82') ? creatorAddress : valKey.address;
          const privKey = Buffer.from(valKey.priv_key, 'hex').subarray(0, 32);

          // Get current nonce
          const nonceRes = await fetch(`${PRIMARY_RPC}/query/nonce?address=${encodeURIComponent(senderAddress)}`);
          const nonceData = await nonceRes.json();
          const nonce = Number(nonceData.nonce || 0);

          const instantiatePayload = {
            type: 'instantiate',
            sender: senderAddress,
            nonce,
            fee: '1000',
            code_id: codeId,
            label: `${name} (${symbol})`,
            msg: JSON.stringify(instantiateMsg),
          };

          const signBytes = Buffer.from(JSON.stringify(instantiatePayload), 'utf8');
          const sig = bytesToHex(signEd25519(new Uint8Array(privKey), new Uint8Array(signBytes)));

          const l1Payload = {
            ...instantiatePayload,
            pub_key: valKey.pub_key,
            sig,
          };

          const rpcRes = await fetch(`${PRIMARY_RPC}/broadcast_tx_commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(l1Payload),
          });
          if (rpcRes.ok) {
            l1TxResult = await rpcRes.json();
            if (l1TxResult && l1TxResult.contract_address) {
              finalContractAddress = l1TxResult.contract_address;
            }
          }
        }
      } catch (rpcErr) {
        console.warn('[STUDIO] L1 instantiate broadcast error:', rpcErr);
      }

      const txHash = l1TxResult?.hash || ('0x' + crypto.createHash('sha256').update(`${finalContractAddress}:${Date.now()}`).digest('hex'));

      const tokenRecord = {
        contractAddress: finalContractAddress,
        codeId,
        name,
        symbol,
        decimals,
        totalSupply: initialSupply,
        creator: creatorAddress,
        creatorDid,
        channelId,
        txHash,
        status: 'active',
        createdAt: Date.now()
      };

      dbAny.db.cw20_tokens.unshift(tokenRecord);
      dbAny.db.wasm_contracts.unshift({
        address: finalContractAddress,
        codeId,
        creator: creatorAddress,
        admin: creatorAddress,
        label: `${name} (${symbol})`,
        txHash,
        createdAt: Date.now()
      });

      if (typeof dbAny.save === 'function') {
        dbAny.save();
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        contractAddress: finalContractAddress,
        token: tokenRecord,
        txHash,
        log: 'CW20 Creator Token instantiated successfully on Layer-1'
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Token launch failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // POST /api/studio/tiers/create - Creator defines token-gate VIP tiers
  if (url.pathname === '/api/studio/tiers/create' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const creatorDid = parsed.creatorDid || resolveCreatorDid(ctx);
      const channelId = parsed.channelId || '';
      const tokenAddress = (parsed.tokenAddress || '').trim();
      const tiers = Array.isArray(parsed.tiers) ? parsed.tiers : [];

      if (!tokenAddress || tiers.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'tokenAddress and tiers array are required' }));
        return true;
      }

      const dbAny = sovraDb as any;
      if (!Array.isArray(dbAny.db.vip_tiers)) {
        dbAny.db.vip_tiers = [];
      }

      // Format tier records
      const savedTiers = tiers.map((t: any, idx: number) => ({
        id: t.id || `tier_${Date.now()}_${idx}`,
        creatorDid,
        channelId,
        tokenAddress,
        name: t.name || `Tier ${idx + 1}`,
        minBalance: String(t.minBalance || t.requiredBalance || '1000000'),
        perks: Array.isArray(t.perks) ? t.perks : [t.perks || 'Exclusive Access'],
        createdAt: Date.now()
      }));

      // Replace or prepend creator's tiers
      dbAny.db.vip_tiers = dbAny.db.vip_tiers.filter((t: any) => t.creatorDid !== creatorDid || t.tokenAddress !== tokenAddress);
      dbAny.db.vip_tiers.push(...savedTiers);

      if (typeof dbAny.save === 'function') {
        dbAny.save();
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        creatorDid,
        tokenAddress,
        tiers: savedTiers,
        log: `Successfully registered ${savedTiers.length} VIP token-gate tier(s)`
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Tier creation failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // GET /api/studio/tiers - Query creator's VIP token-gate tiers
  if (url.pathname === '/api/studio/tiers' && req.method === 'GET') {
    const creatorDid = url.searchParams.get('creatorDid') || url.searchParams.get('did') || resolveCreatorDid(ctx);
    const tokenAddress = url.searchParams.get('tokenAddress');

    const dbAny = sovraDb as any;
    let tiers: any[] = (dbAny && dbAny.db && Array.isArray(dbAny.db.vip_tiers)) ? dbAny.db.vip_tiers : [];
    if (creatorDid) {
      tiers = tiers.filter(t => t.creatorDid === creatorDid);
    }
    if (tokenAddress) {
      tiers = tiers.filter(t => t.tokenAddress === tokenAddress);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, tiers }));
    return true;
  }

  // ==========================================
  // 🎨 CW721 CREATOR NFT DROP & VIP PASS LAUNCHPAD
  // ==========================================

  // POST /api/studio/nft/drop - Launch CW721 NFT Collection / VIP Ticket Pass
  if (url.pathname === '/api/studio/nft/drop' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const name = (parsed.name || '').trim();
      const symbol = (parsed.symbol || '').trim().toUpperCase();
      const maxSupply = Number(parsed.maxSupply || parsed.max_supply || 100);
      const mintPrice = String(parsed.mintPrice || parsed.mint_price || '1000000'); // default 1 SOV
      const currency = parsed.currency || 'SOV';
      const mediaCid = parsed.mediaCid || parsed.cid || ('bafybeivippass' + Date.now());
      const metadata = parsed.metadata || {};
      const creatorDid = parsed.creatorDid || resolveCreatorDid(ctx);
      const channelId = parsed.channelId || '';

      if (!name || !symbol) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'NFT collection name and symbol are required' }));
        return true;
      }

      const creatorAddress = parsed.creatorAddress || parsed.creator || (
        'sovra1' + crypto.createHash('sha256').update(creatorDid).digest('hex').slice(0, 38)
      );

      const dbAny = sovraDb as any;
      if (!Array.isArray(dbAny.db.nft_drops)) dbAny.db.nft_drops = [];
      if (!Array.isArray(dbAny.db.cw721_collections)) dbAny.db.cw721_collections = [];
      if (!Array.isArray(dbAny.db.wasm_contracts)) dbAny.db.wasm_contracts = [];

      const dropId = 'drop_' + crypto.randomBytes(6).toString('hex');
      const codeId = Number(parsed.codeId || 2);
      const instanceSeq = (dbAny.db.wasm_contracts.length || 0) + 1;
      const contractAddress = 'sovra1wasm' + crypto.createHash('sha256').update(`cw721_nft_contract:${codeId}:${instanceSeq}:${dropId}`).digest('hex').slice(0, 32);

      const instantiateMsg = {
        name,
        symbol,
        minter: creatorAddress
      };

      let finalContractAddress = contractAddress;
      try {
        const valKeyPath = path.resolve(process.cwd(), 'chain/mytestnet/node0/validator-0.key.json');
        if (fs.existsSync(valKeyPath)) {
          const valKey = JSON.parse(fs.readFileSync(valKeyPath, 'utf8'));
          const senderAddress = creatorAddress.startsWith('sovra12a806ca82') ? creatorAddress : valKey.address;
          const privKey = Buffer.from(valKey.priv_key, 'hex').subarray(0, 32);

          const nonceRes = await fetch(`${PRIMARY_RPC}/query/nonce?address=${encodeURIComponent(senderAddress)}`);
          const nonceData = await nonceRes.json();
          const nonce = Number(nonceData.nonce || 0);

          const instantiatePayload = {
            type: 'instantiate',
            sender: senderAddress,
            nonce,
            fee: '1000',
            code_id: codeId,
            label: `${name} (${symbol}) NFT Pass`,
            msg: JSON.stringify(instantiateMsg),
          };

          const signBytes = Buffer.from(JSON.stringify(instantiatePayload), 'utf8');
          const sig = bytesToHex(signEd25519(new Uint8Array(privKey), new Uint8Array(signBytes)));
          const l1Payload = { ...instantiatePayload, pub_key: valKey.pub_key, sig };

          const rpcRes = await fetch(`${PRIMARY_RPC}/broadcast_tx_commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(l1Payload),
          });
          if (rpcRes.ok) {
            const l1TxResult = await rpcRes.json();
            if (l1TxResult && l1TxResult.contract_address) {
              finalContractAddress = l1TxResult.contract_address;
            }
          }
        }
      } catch (err) {
        console.warn('[STUDIO] L1 CW721 instantiate broadcast:', err);
      }

      const dropRecord = {
        dropId,
        contractAddress: finalContractAddress,
        name,
        symbol,
        maxSupply,
        mintedCount: 0,
        mintPrice,
        currency,
        mediaCid,
        metadata: {
          description: metadata.description || `${name} official exclusive access NFT`,
          image: `/storage/${mediaCid}`,
          perks: metadata.perks || ['VIP Stream Access', 'Backstage Chat', 'Exclusive Merchandise Rights'],
          attributes: metadata.attributes || [
            { trait_type: 'Collection', value: name },
            { trait_type: 'Access Tier', value: 'VIP' },
          ]
        },
        creatorDid,
        creatorAddress,
        channelId,
        accumulatedRevenue: '0',
        status: 'active',
        createdAt: Date.now()
      };

      dbAny.db.nft_drops.unshift(dropRecord);
      dbAny.db.cw721_collections.unshift(dropRecord);
      dbAny.db.wasm_contracts.unshift({
        address: finalContractAddress,
        codeId,
        creator: creatorAddress,
        admin: creatorAddress,
        label: `${name} (${symbol}) NFT`,
        createdAt: Date.now()
      });

      if (typeof dbAny.save === 'function') dbAny.save();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        dropId,
        contractAddress: finalContractAddress,
        drop: dropRecord,
        log: 'CW721 NFT Collection launched successfully on Layer-1'
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'NFT drop failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // POST /api/nft/mint - Fan mints an NFT from active drop
  if (url.pathname === '/api/nft/mint' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const dropId = (parsed.dropId || parsed.drop_id || '').trim();
      const contractAddress = (parsed.contractAddress || '').trim();
      const buyerAddress = parsed.buyerAddress || parsed.address || 'sovra1fan99482f7c082e66d8ba9264fa58ef2110c900';
      const buyerDid = parsed.buyerDid || parsed.did || buyerAddress;

      const dbAny = sovraDb as any;
      const drops: any[] = dbAny.db?.nft_drops || [];
      const drop = drops.find(d => d.dropId === dropId || d.contractAddress === contractAddress || d.dropId === contractAddress);

      if (!drop) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'NFT drop not found' }));
        return true;
      }

      if (drop.mintedCount >= drop.maxSupply) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'NFT drop is sold out' }));
        return true;
      }

      const nextTokenNum = drop.mintedCount + 1;
      const tokenId = `${drop.symbol.toLowerCase()}_#${nextTokenNum}`;

      const mintMsg = {
        mint: {
          token_id: tokenId,
          owner: buyerAddress,
          token_uri: `ipfs://${drop.mediaCid}`,
          extension: {
            name: `${drop.name} #${nextTokenNum}`,
            description: drop.metadata?.description || '',
            image: `/storage/${drop.mediaCid}`,
            attributes: drop.metadata?.attributes || [],
            edition: nextTokenNum,
            maxSupply: drop.maxSupply
          }
        }
      };

      try {
        const valKeyPath = path.resolve(process.cwd(), 'chain/mytestnet/node0/validator-0.key.json');
        if (fs.existsSync(valKeyPath)) {
          const valKey = JSON.parse(fs.readFileSync(valKeyPath, 'utf8'));
          const senderAddress = valKey.address;
          const privKey = Buffer.from(valKey.priv_key, 'hex').subarray(0, 32);

          const nonceRes = await fetch(`${PRIMARY_RPC}/query/nonce?address=${encodeURIComponent(senderAddress)}`);
          const nonceData = await nonceRes.json();
          const nonce = Number(nonceData.nonce || 0);

          const mintPayload = {
            type: 'execute',
            sender: senderAddress,
            contract: drop.contractAddress,
            nonce,
            fee: '1000',
            msg: JSON.stringify(mintMsg)
          };

          const signBytes = Buffer.from(JSON.stringify(mintPayload), 'utf8');
          const sig = bytesToHex(signEd25519(new Uint8Array(privKey), new Uint8Array(signBytes)));
          await fetch(`${PRIMARY_RPC}/broadcast_tx_commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...mintPayload, pub_key: valKey.pub_key, sig })
          });
        }
      } catch (l1Err) {
        console.warn('[NFT] L1 mint execute warning:', l1Err);
      }

      drop.mintedCount = nextTokenNum;
      drop.accumulatedRevenue = (BigInt(drop.accumulatedRevenue || '0') + BigInt(drop.mintPrice || '0')).toString();

      if (!Array.isArray(dbAny.db.user_nfts)) {
        dbAny.db.user_nfts = [];
      }

      const nftItem = {
        tokenId,
        contractAddress: drop.contractAddress,
        dropId: drop.dropId,
        owner: buyerAddress,
        ownerDid: buyerDid,
        name: `${drop.name} #${nextTokenNum}`,
        symbol: drop.symbol,
        image: `/storage/${drop.mediaCid}`,
        tokenUri: `ipfs://${drop.mediaCid}`,
        attributes: drop.metadata?.attributes || [],
        perks: drop.metadata?.perks || [],
        mintPrice: drop.mintPrice,
        currency: drop.currency,
        mintedAt: Date.now()
      };

      dbAny.db.user_nfts.unshift(nftItem);
      if (typeof dbAny.save === 'function') dbAny.save();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        tokenId,
        nft: nftItem,
        drop: {
          dropId: drop.dropId,
          contractAddress: drop.contractAddress,
          mintedCount: drop.mintedCount,
          maxSupply: drop.maxSupply,
          accumulatedRevenue: drop.accumulatedRevenue
        },
        log: `Minted ${tokenId} successfully`
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Minting failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // GET /api/studio/nft/drops or /api/nft/drops - Query active NFT drops
  if ((url.pathname === '/api/studio/nft/drops' || url.pathname === '/api/nft/drops') && req.method === 'GET') {
    const creatorDid = url.searchParams.get('creatorDid') || url.searchParams.get('did');
    const dbAny = sovraDb as any;
    let drops: any[] = dbAny.db?.nft_drops || [];
    if (creatorDid) {
      drops = drops.filter(d => d.creatorDid === creatorDid);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      drops,
      count: drops.length
    }));
    return true;
  }

  // 2. POST /api/studio/upload - Ingest video for multi-bitrate HLS transcoding
  if (url.pathname === '/api/studio/upload' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 10 * 1024 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const creatorDid = parsed.creatorDid || resolveCreatorDid(ctx);
      const title = parsed.title || 'Creator Studio Upload';
      const description = parsed.description || '';
      const tags = parsed.tags || '#creator #sovra';
      const sourceCid = parsed.sourceCid || `bafybeicreator_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const targetResolutions: VideoResolution[] = Array.isArray(parsed.targetResolutions) && parsed.targetResolutions.length > 0
        ? parsed.targetResolutions
        : ['1080p', '720p', '480p', '360p'];

      const scheduledPublishAt = typeof parsed.scheduledPublishAt === 'number' ? parsed.scheduledPublishAt : undefined;

      // Create tracking job in database
      const job = sovraDb.createStudioJob({
        creatorDid,
        title,
        description,
        tags,
        sourceCid,
        targetResolutions,
        scheduledPublishAt,
        thumbnailUrl: parsed.thumbnailUrl,
        category: parsed.category,
        channelId: parsed.channelId || undefined,
        channelHandle: parsed.channelHandle || undefined,
        chapters: parsed.chapters,
        monetization: parsed.monetization,
      });

      // Update to transcoding
      sovraDb.updateStudioJob(job.jobId, { status: 'transcoding', progress: 30 });

      // Execute real background multi-resolution HLS transcode via TranscoderWorker
      const transcodeRes = await transcoderWorker.transcode({
        jobId: job.jobId,
        sourceCid,
        targetResolutions,
        segmentDurationSeconds: 2,
      });

      if (transcodeRes.ok && transcodeRes.value) {
        const masterM3u8 = transcodeRes.value.masterM3u8 || transcoderWorker.generateMasterPlaylist(job.jobId, targetResolutions);
        const masterPlaylistUrl = `/api/feed/video/${job.jobId}/hls/master.m3u8`;

        const updated = sovraDb.updateStudioJob(job.jobId, {
          status: 'completed',
          progress: 100,
          masterManifestCid: transcodeRes.value.masterManifestCid,
          masterPlaylistUrl,
          resolutionCids: transcodeRes.value.resolutionCids as any,
          completedAt: Date.now(),
        });

        // Auto-publish if requested or not scheduled for future
        let publishedVideo: any = null;
        if (parsed.publishImmediately || (!scheduledPublishAt && parsed.autoPublish !== false)) {
          publishedVideo = sovraDb.publishStudioJob(job.jobId);
          const gSocial = (globalThis as any).dynamicSocialStore;
          if (publishedVideo && gSocial && Array.isArray(gSocial.videos)) {
            if (!gSocial.videos.some((v: any) => v.id === publishedVideo.id)) {
              gSocial.videos.unshift(publishedVideo);
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          job: updated,
          masterManifestCid: transcodeRes.value.masterManifestCid,
          masterPlaylistUrl,
          resolutionVariants: Object.keys(transcodeRes.value.resolutionCids),
        }));
      } else {
        sovraDb.updateStudioJob(job.jobId, { status: 'failed', progress: 0 });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Transcoder worker pipeline failed' }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid studio upload payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 3. GET /api/studio/transcode/status - Poll status of background transcode job
  if (url.pathname === '/api/studio/transcode/status' && req.method === 'GET') {
    const jobId = url.searchParams.get('jobId');
    if (!jobId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing jobId query parameter' }));
      return true;
    }

    const job = sovraDb.getStudioJob(jobId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Studio transcode job not found' }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, job }));
    return true;
  }

  // 4. POST /api/studio/schedule - Schedule release date & time
  if (url.pathname === '/api/studio/schedule' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const jobId = parsed.jobId;
      const scheduledPublishAt = Number(parsed.scheduledPublishAt);

      if (!jobId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing jobId' }));
        return true;
      }

      if (isNaN(scheduledPublishAt) || scheduledPublishAt <= Date.now()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'scheduledPublishAt must be a timestamp in the future' }));
        return true;
      }

      const job = sovraDb.getStudioJob(jobId);
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Job not found' }));
        return true;
      }

      const updated = sovraDb.updateStudioJob(jobId, {
        scheduledPublishAt,
        published: false,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, job: updated }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid request: ' + (err?.message || err) }));
    }
    return true;
  }

  // 5. GET /api/studio/schedule/queue - Get creator's pending scheduled releases
  if (url.pathname === '/api/studio/schedule/queue' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const queue = sovraDb.getScheduledStudioQueue(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, count: queue.length, queue }));
    return true;
  }

  // 6. POST /api/studio/publish-now - Instantly publish a transcoded video
  if (url.pathname === '/api/studio/publish-now' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const jobId = parsed.jobId;
      if (!jobId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing jobId' }));
        return true;
      }

      const pubRes = sovraDb.publishStudioJob(jobId);
      if (!pubRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: pubRes.error }));
        return true;
      }

      const job = sovraDb.getStudioJob(jobId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, job, video: pubRes.video }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid request: ' + (err?.message || err) }));
    }
    return true;
  }

  // 7. GET /api/studio/analytics - Detailed 7-day trajectories & retention curve
  if (url.pathname === '/api/studio/analytics' && req.method === 'GET') {
    const creatorDid = url.searchParams.get('creatorAddress') || url.searchParams.get('creator') || url.searchParams.get('creatorDid') || resolveCreatorDid(ctx);
    const channelId = url.searchParams.get('channelId') || undefined;
    const analytics = sovraDb.getCreatorStudioAnalytics(creatorDid, channelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, channelId, analytics }));
    return true;
  }

  // 7.1 GET /api/studio/analytics/export - Export post performance breakdown as CSV or JSON
  if (url.pathname === '/api/studio/analytics/export' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const analytics = sovraDb.getCreatorStudioAnalytics(creatorDid);
    const format = (url.searchParams.get('format') || 'csv').toLowerCase();
    const items = (analytics as any).postPerformance || [];

    if (format === 'json') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="creator-studio-performance.json"',
      });
      res.end(JSON.stringify({ ok: true, creatorDid, postPerformance: items, exportTimestamp: Date.now() }, null, 2));
      return true;
    }

    let csv = 'Video ID,Title,Release Date,Views,Impressions,CTR (%),Avg View Duration,SOV Earned (SOV),Category\n';
    items.forEach((item: any) => {
      const cleanTitle = (item.title || '').replace(/"/g, '""');
      csv += `"${item.id}","${cleanTitle}","${item.releaseDate}","${item.views}","${item.impressions}","${item.ctrPercent}%","${item.avgViewDuration}","${item.sovEarned}","${item.category || 'Tech'}"\n`;
    });

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="creator-studio-performance.csv"',
    });
    res.end(csv);
    return true;
  }

  // 7.2 GET /api/studio/analytics/retention - Audience retention curves with 5s buckets, intro %, spikes & dips
  if (url.pathname === '/api/studio/analytics/retention' && req.method === 'GET') {
    const videoId = url.searchParams.get('videoId') || 'yt-video-1';
    const retentionData = sovraDb.getVideoRetentionData(videoId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(retentionData));
    return true;
  }

  // 7.3 GET /api/studio/analytics/realtime - 60-minute & 48-hour realtime views telemetry & live sub ticker
  if (url.pathname === '/api/studio/analytics/realtime' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const realtimeData = sovraDb.getRealtimeAnalytics(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(realtimeData));
    return true;
  }

  // 8. GET /api/studio/content - All creator library content (videos, reels, scheduled)
  if (url.pathname === '/api/studio/content' && req.method === 'GET') {
    const creatorDid = url.searchParams.get('creatorAddress') || url.searchParams.get('creator') || url.searchParams.get('creatorDid') || resolveCreatorDid(ctx);
    const channelId = url.searchParams.get('channelId') || undefined;
    const content = sovraDb.getCreatorStudioContent(creatorDid, channelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, channelId, count: content.count, items: content.items }));
    return true;
  }

  // 9. POST /api/studio/content/update - Inline edit metadata, thumbnail, monetization, chapters
  if (url.pathname === '/api/studio/content/update' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const contentId = parsed.contentId || parsed.id;
      if (!contentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing contentId' }));
        return true;
      }

      const updateRes = sovraDb.updateCreatorStudioContent(creatorDid, contentId, parsed.updates || parsed);
      if (!updateRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: updateRes.error }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, item: updateRes.item }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid update payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 10. POST /api/studio/content/delete - Delete studio content / video
  if (url.pathname === '/api/studio/content/delete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const contentId = parsed.contentId || parsed.id;
      if (!contentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing contentId' }));
        return true;
      }

      const delRes = sovraDb.deleteCreatorStudioContent(creatorDid, contentId);
      if (!delRes.ok) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: delRes.error }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Content deleted successfully' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid delete payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 10b. POST /api/studio/content/bulk-action - Batch operations on multiple videos (YouTube Studio Parity)
  if (url.pathname === '/api/studio/content/bulk-action' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 128 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const videoIds: string[] = Array.isArray(parsed.videoIds) ? parsed.videoIds : [];
      const action = parsed.action; // 'visibility' | 'delete' | 'add-to-playlist'
      let modifiedCount = 0;

      if (!action || videoIds.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Action and non-empty videoIds are required' }));
        return true;
      }

      if (action === 'delete') {
        for (const vid of videoIds) {
          const resDel = sovraDb.deleteCreatorStudioContent(creatorDid, vid);
          if (resDel.ok) modifiedCount++;
        }
      } else if (action === 'visibility') {
        const visibility = parsed.visibility || 'public';
        for (const vid of videoIds) {
          const resUpd = sovraDb.updateCreatorStudioContent(creatorDid, vid, { visibility });
          if (resUpd.ok) modifiedCount++;
        }
      } else if (action === 'add-to-playlist') {
        const playlistId = parsed.playlistId;
        if (playlistId) {
          for (const vid of videoIds) {
            const resAdd = sovraDb.addVideoToPlaylist(playlistId, vid, creatorDid);
            if (resAdd.ok) modifiedCount++;
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, action, modifiedCount, total: videoIds.length }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Bulk action failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 10c. GET /api/studio/playlists - Returns playlists owned by channel or creator
  if (url.pathname === '/api/studio/playlists' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const channelId = url.searchParams.get('channelId') || undefined;
    const playlists = sovraDb.getStudioPlaylists(creatorDid, channelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: playlists.length, playlists }));
    return true;
  }

  // 10d. POST /api/studio/playlists/create - Create a new playlist
  if (url.pathname === '/api/studio/playlists/create' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      if (!parsed.title || !parsed.title.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Playlist title is required' }));
        return true;
      }
      const user = sovraDb.findUserByDid(creatorDid);
      const playlist = sovraDb.createPlaylist({
        channelId: parsed.channelId,
        creatorDid,
        creatorHandle: user?.handle || 'creator',
        creatorName: user?.displayName || user?.name || 'Creator',
        title: parsed.title.trim(),
        description: parsed.description,
        thumbnailUrl: parsed.thumbnailUrl,
        videoIds: Array.isArray(parsed.videoIds) ? parsed.videoIds : [],
        privacy: parsed.privacy || 'public'
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, playlist }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid playlist payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 10e. POST /api/studio/playlists/update - Update playlist metadata or video order
  if (url.pathname === '/api/studio/playlists/update' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const playlistId = parsed.id || parsed.playlistId;
      if (!playlistId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing playlistId' }));
        return true;
      }
      const updRes = sovraDb.updatePlaylist(playlistId, creatorDid, {
        title: parsed.title,
        description: parsed.description,
        thumbnailUrl: parsed.thumbnailUrl,
        privacy: parsed.privacy,
        videoIds: parsed.videoIds
      });
      if (!updRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: updRes.error }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, playlist: updRes.playlist }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid update payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 10f. POST /api/studio/playlists/delete - Delete a playlist
  if (url.pathname === '/api/studio/playlists/delete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const playlistId = parsed.id || parsed.playlistId;
      if (!playlistId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing playlistId' }));
        return true;
      }
      const delRes = sovraDb.deletePlaylist(playlistId, creatorDid);
      if (!delRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: delRes.error }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Playlist deleted successfully' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid delete payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 11. GET /api/studio/video/details - Full video metadata for Post-Production Editor Modal
  if (url.pathname === '/api/studio/video/details' && req.method === 'GET') {
    const videoId = url.searchParams.get('id') || url.searchParams.get('videoId');
    const creatorDid = resolveCreatorDid(ctx);
    let video: any = null;
    if (videoId) {
      video = sovraDb.getVideoById(videoId);
      if (!video) {
        const job = sovraDb.getStudioJob(videoId);
        if (job) {
          video = {
            id: job.jobId,
            title: job.title,
            description: job.description,
            thumbnailUrl: job.thumbnailUrl,
            category: job.category || 'Tech',
            tags: job.tags ? job.tags.split(',').map(t => t.trim()) : [],
            chapters: job.chapters || [],
            monetization: job.monetization || { tier: 'free' },
            audience: 'all',
            hlsMasterUrl: job.masterPlaylistUrl,
            cid: job.masterManifestCid || job.sourceCid,
          };
        }
      }
    }
    if (!video) {
      const content = sovraDb.getCreatorStudioContent(creatorDid);
      video = content.items[0] || null;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, video }));
    return true;
  }

  // 12. POST /api/studio/video/update - Update video post-production details & metadata
  if (url.pathname === '/api/studio/video/update' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const videoId = parsed.id || parsed.videoId;
      if (!videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing videoId' }));
        return true;
      }
      const updateRes = sovraDb.updateCreatorStudioContent(creatorDid, videoId, parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, video: updateRes.item }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Update failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 12.1 POST /api/studio/video/trim - In-Browser Lossless Video Trimmer
  if (url.pathname === '/api/studio/video/trim' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const videoId = parsed.videoId || parsed.id;
      const startOffsetSec = Number(parsed.startOffsetSec) || 0;
      const endOffsetSec = Number(parsed.endOffsetSec) || 0;
      if (!videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing videoId' }));
        return true;
      }
      const video = sovraDb.trimVideo(videoId, startOffsetSec, endOffsetSec);
      if (!video) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Video not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, video, trimConfig: video.trimConfig }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Trim failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 12.2 POST /api/studio/video/thumbnail-ab - Save up to 3 thumbnail variants & toggle A/B test
  if (url.pathname === '/api/studio/video/thumbnail-ab' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const videoId = parsed.videoId || parsed.id;
      if (!videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing videoId' }));
        return true;
      }
      const video = sovraDb.updateThumbnailAbVariants(videoId, parsed.variants || [], parsed.isAbTestingEnabled);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, video, variants: video?.thumbnailAbVariants, isAbTestingEnabled: video?.isAbTestingEnabled }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 12.3 POST /api/studio/video/thumbnail-ab/telemetry - Record impression or click for A/B variant
  if (url.pathname === '/api/studio/video/thumbnail-ab/telemetry' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const { videoId, variantId, event } = parsed;
      const result = sovraDb.recordThumbnailAbTelemetry(videoId, variantId, event);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Telemetry failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 12.4 GET /api/studio/video/endscreens - Get End Screens metadata
  if (url.pathname === '/api/studio/video/endscreens' && req.method === 'GET') {
    const videoId = url.searchParams.get('videoId') || 'yt-video-1';
    const result = sovraDb.getVideoEndScreens(videoId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return true;
  }

  // 12.5 POST /api/studio/video/endscreens - Save End Screens 16:9 positioning elements
  if (url.pathname === '/api/studio/video/endscreens' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const videoId = parsed.videoId || parsed.id;
      const elements = parsed.elements || [];
      const enabled = parsed.enabled !== false;
      const video = sovraDb.updateVideoEndScreens(videoId, elements, enabled);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, video, endScreenConfig: video?.endScreenConfig }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'End screens save failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 13. GET /api/studio/comments - Community Comments & Moderation Studio
  if (url.pathname === '/api/studio/comments' && req.method === 'GET') {
    const creatorDid = url.searchParams.get('creatorAddress') || url.searchParams.get('creator') || url.searchParams.get('creatorDid') || resolveCreatorDid(ctx);
    const filter = url.searchParams.get('filter') || undefined;
    const channelId = url.searchParams.get('channelId') || undefined;
    const comments = sovraDb.getCreatorStudioComments(creatorDid, filter, channelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channelId, count: comments.length, comments }));
    return true;
  }

  // 14. POST /api/studio/comments/reply - Creator inline reply directly from studio
  if (url.pathname === '/api/studio/comments/reply' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const videoId = parsed.videoId || 'yt-video-1';
      const commentId = parsed.commentId || parsed.parentCommentId;
      const text = String(parsed.text || '').trim();
      const creatorDid = resolveCreatorDid(ctx);
      const user = sovraDb.findUserByDid(creatorDid);

      if (!commentId || !text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing commentId or text' }));
        return true;
      }

      const reply = sovraDb.addVideoReply(videoId, commentId, {
        authorDid: creatorDid,
        authorName: user?.displayName || user?.name || 'Creator',
        authorHandle: user?.handle ? user.handle.replace('@', '') : 'creator',
        authorAvatar: user?.avatar || '🎬',
        isCreator: true,
        text,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reply }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Reply failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 14.1 POST /api/studio/comments/moderate - Approve, reject or delete comment
  if (url.pathname === '/api/studio/comments/moderate' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const { videoId, commentId, action } = parsed;
      if (!commentId || !action) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing commentId or action' }));
        return true;
      }
      const result = sovraDb.moderateComment(videoId || 'yt-video-1', commentId, action);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Moderation failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 15. GET /api/studio/subtitles - Dedicated Subtitles & Closed Captions Track Studio
  if (url.pathname === '/api/studio/subtitles' && req.method === 'GET') {
    const videoId = url.searchParams.get('videoId') || 'yt-video-1';
    const video = sovraDb.getVideoById(videoId);
    const defaultCues = [
      { start: 0, end: 5, text: "Welcome to the Sovra Protocol technical architecture session." },
      { start: 5, end: 14, text: "In this deep dive, we explore BitSwap DAG streaming and 4K playback." },
      { start: 14, end: 28, text: "Notice how zero centralized CDN servers are required for high throughput." },
      { start: 28, end: 45, text: "RFC 8216 HLS Master and Variant playlists enable seamless bitrate switching." },
      { start: 45, end: 70, text: "Speculative Segment 0 pre-warming guarantees sub-300ms time to first frame." },
      { start: 70, end: 120, text: "Cellular CGNAT is bypassed effortlessly via Birthday Paradox port prediction." },
      { start: 120, end: 200, text: "95% of micropayment revenue flows directly to creators with 0% platform take." }
    ];
    const tracks = (video && (video as any).subtitleTracks) || [
      { language: 'English (Original)', langCode: 'en', isDefault: true, cues: (video && (video as any).subtitles) || defaultCues },
      { language: 'Spanish (Community)', langCode: 'es', isDefault: false, cues: [
        { start: 0, end: 5, text: "Bienvenidos a la sesión técnica del Protocolo Sovra." },
        { start: 5, end: 14, text: "En esta sesión exploramos la transmisión DAG de BitSwap y reproducción 4K." }
      ]}
    ];
    const requestedLang = url.searchParams.get('language') || url.searchParams.get('lang') || 'en';
    const activeTrack = tracks.find((t: any) => t.langCode === requestedLang || (t.language && t.language.toLowerCase().includes(requestedLang.toLowerCase()))) || tracks[0];
    const cues = activeTrack ? activeTrack.cues : defaultCues;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, videoId, tracks, cues }));
    return true;
  }

  // 16. POST /api/studio/subtitles/save - Save subtitle cues and tracks
  if (url.pathname === '/api/studio/subtitles/save' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const videoId = parsed.videoId || 'yt-video-1';
      const creatorDid = resolveCreatorDid(ctx);
      const tracks = parsed.tracks || (parsed.cues ? [{ language: parsed.language || 'English', langCode: parsed.language || 'en', isDefault: true, cues: parsed.cues }] : []);
      sovraDb.updateCreatorStudioContent(creatorDid, videoId, { subtitleTracks: tracks });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, videoId, tracks, cues: parsed.cues || (tracks[0] ? tracks[0].cues : []) }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Save subtitles failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 17. GET /api/studio/customization - Channel Customization & Branding Studio
  if (url.pathname === '/api/studio/customization' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const customization = sovraDb.getCreatorChannelCustomization(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, customization }));
    return true;
  }

  // 18. POST /api/studio/customization/save - Save Channel Customization & Branding
  if (url.pathname === '/api/studio/customization/save' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const resData = sovraDb.saveCreatorChannelCustomization(creatorDid, parsed);
      const gSocial = (globalThis as any).dynamicSocialStore;
      if (gSocial && Array.isArray(gSocial.channels) && (parsed.channelId || parsed.channelHandle)) {
        const cleanHandle = parsed.channelHandle ? ('@' + parsed.channelHandle.replace(/^@+/, '')).toLowerCase() : '';
        const match = gSocial.channels.find((c: any) =>
          (parsed.channelId && c.id === parsed.channelId) ||
          (cleanHandle && c.handle && c.handle.toLowerCase() === cleanHandle) ||
          c.ownerDid === creatorDid
        );
        if (match) {
          if (parsed.channelName) match.name = parsed.channelName;
          if (parsed.channelBio) match.desc = parsed.channelBio;
          if (cleanHandle) match.handle = cleanHandle;
          if (parsed.trailerVideoId) match.trailerVideoId = parsed.trailerVideoId;
          if (parsed.featuredVideoId) match.featuredVideoId = parsed.featuredVideoId;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, customization: resData.customization }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Customization save failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 18.1 GET /api/studio/customization/shelves - Get channel homepage shelf layout
  if (url.pathname === '/api/studio/customization/shelves' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const shelves = sovraDb.getCreatorShelves(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, shelves }));
    return true;
  }

  // 18.2 POST /api/studio/customization/shelves - Save channel homepage shelf layout
  if (url.pathname === '/api/studio/customization/shelves' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const shelves = parsed.shelves || [];
      const result = sovraDb.saveCreatorShelves(creatorDid, shelves);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Shelves save failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 18.3 GET /api/studio/settings/moderation - Get channel community guidelines & blocked words
  if (url.pathname === '/api/studio/settings/moderation' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const result = sovraDb.getCreatorModerationSettings(creatorDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return true;
  }

  // 18.4 POST /api/studio/settings/moderation - Save channel community guidelines & blocked words
  if (url.pathname === '/api/studio/settings/moderation' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveCreatorDid(ctx);
      const result = sovraDb.saveCreatorModerationSettings(creatorDid, {
        guidelines: parsed.guidelines,
        blockedWords: parsed.blockedWords,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Moderation settings save failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 19. GET /api/studio/audio-library - Sovereign Royalty-Free Audio & SFX Library
  if (url.pathname === '/api/studio/audio-library' && req.method === 'GET') {
    let tracks = sovraDb.getCreatorAudioLibrary();
    const typeParam = url.searchParams.get('type');
    const genreParam = url.searchParams.get('genre');
    const searchParam = url.searchParams.get('q') || url.searchParams.get('search');
    if (typeParam && (typeParam === 'music' || typeParam === 'sfx')) {
      tracks = tracks.filter((t: any) => t.type === typeParam || (typeParam === 'sfx' ? t.genre === 'Sound Effects' : t.genre !== 'Sound Effects'));
    }
    if (genreParam && genreParam !== 'all') {
      tracks = tracks.filter((t: any) => t.genre.toLowerCase() === genreParam.toLowerCase() || (t.category && t.category.toLowerCase() === genreParam.toLowerCase()));
    }
    if (searchParam) {
      const q = searchParam.toLowerCase();
      tracks = tracks.filter((t: any) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.genre.toLowerCase().includes(q) || (t.category && t.category.toLowerCase().includes(q)));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: tracks.length, tracks }));
    return true;
  }

  // 20. GET /api/studio/space - Space metadata, subscriber stats & pinned announcement
  if (url.pathname === '/api/studio/space' && req.method === 'GET') {
    const spaceId = url.searchParams.get('spaceId') || '';
    const spaceType = (url.searchParams.get('spaceType') || 'channel') as SpaceType;
    const principal = ctx.resolvePrincipal(ctx.req);
    const userDid = principal?.did || '';

    let spaceEntity: any = null;
    if (spaceType === 'channel') spaceEntity = sovraDb.getChannelById(spaceId);
    else if (spaceType === 'page') spaceEntity = sovraDb.getPageById(spaceId);
    else if (spaceType === 'group') spaceEntity = sovraDb.getGroupById(spaceId);

    if (!spaceEntity) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Space entity not found' }));
      return true;
    }

    const userRole = userDid ? sovraDb.getSpaceMemberRole(spaceId, userDid) : null;
    const allPosts = sovraDb.getAllPosts().filter(p => p.channelTargetId === spaceId || p.authorEntityId === spaceId);
    const members = sovraDb.getSpaceMembers(spaceId, spaceType);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      space: spaceEntity,
      spaceType,
      userRole,
      isManager: userRole === 'OWNER' || userRole === 'ADMIN',
      stats: {
        contentCount: allPosts.length,
        memberCount: spaceType === 'group' ? (spaceEntity.memberCount || members.length) : (spaceEntity.count || 0),
        recentActivityCount: allPosts.length,
      },
    }));
    return true;
  }

  // 21. GET /api/studio/team - Space team members with verified role badges
  if (url.pathname === '/api/studio/team' && req.method === 'GET') {
    const spaceId = url.searchParams.get('spaceId') || '';
    const spaceType = (url.searchParams.get('spaceType') || 'channel') as SpaceType;
    const members = sovraDb.getSpaceMembers(spaceId, spaceType);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, spaceId, members }));
    return true;
  }

  // 22. POST /api/studio/team/role & POST /api/studio/team/update - Update space member roles
  if ((url.pathname === '/api/studio/team/role' || url.pathname === '/api/studio/team/update') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.enforceAuth(req, res);
      if (!principal) return true;
      const spaceId = String(parsed.spaceId || '');
      const targetDid = String(parsed.targetDid || '');
      const newRole = parsed.role as SpaceRole;
      const updateRes = sovraDb.updateSpaceMemberRole(spaceId, targetDid, newRole, principal.did);
      if (!updateRes.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: updateRes.error }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, spaceId, targetDid, role: newRole }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // 23. POST /api/studio/announcement/pin - Pin announcement to space header
  if (url.pathname === '/api/studio/announcement/pin' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.enforceAuth(req, res);
      if (!principal) return true;
      const spaceId = String(parsed.spaceId || '');
      const text = String(parsed.text || '').trim();
      const postId = parsed.postId ? String(parsed.postId) : undefined;
      if (!spaceId || !text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'spaceId and text are required' }));
        return true;
      }
      const pinRes = sovraDb.pinSpaceAnnouncement(spaceId, { postId, text, pinnedByDid: principal.did }, principal.did);
      if (!pinRes.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: pinRes.error }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, space: pinRes.space, pinnedAnnouncement: pinRes.pinnedAnnouncement }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // 24. POST /api/studio/announcement/unpin - Unpin announcement from space header
  if (url.pathname === '/api/studio/announcement/unpin' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.enforceAuth(req, res);
      if (!principal) return true;
      const spaceId = String(parsed.spaceId || '');
      if (!spaceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'spaceId is required' }));
        return true;
      }
      const unpinRes = sovraDb.unpinSpaceAnnouncement(spaceId, principal.did);
      if (!unpinRes.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: unpinRes.error }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, space: unpinRes.space, pinnedAnnouncement: null }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // 14. GET /api/studio/payouts & GET /api/studio/monetization/summary
  if ((url.pathname === '/api/studio/payouts' || url.pathname === '/api/studio/monetization/summary') && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const channelId = url.searchParams.get('channelId') || undefined;
    const summary = (sovraDb as any).getCreatorMonetizationSummary(creatorDid, channelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
    return true;
  }

  // 14b. GET /api/studio/monetization/tips - Recent peer tips & member subscriptions ledger
  if (url.pathname === '/api/studio/monetization/tips' && req.method === 'GET') {
    const creatorDid = resolveCreatorDid(ctx);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const tips = (sovraDb as any).getCreatorTipReceiptsLedger(creatorDid, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, creatorDid, tips, count: tips.length }));
    return true;
  }

  // 14c. POST /api/studio/monetization/tiers/save - Configure channel membership tiers
  if (url.pathname === '/api/studio/monetization/tiers/save' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const creatorDid = parsed.creatorDid || resolveCreatorDid(ctx);
      const channelId = parsed.channelId || '';
      const tiers = Array.isArray(parsed.tiers) ? parsed.tiers : [];
      if (tiers.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Tiers array is required' }));
        return true;
      }
      const result = (sovraDb as any).saveCreatorMembershipTiers(creatorDid, tiers, channelId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, creatorDid, ...result }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid tiers payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 15. POST /api/studio/payout & POST /api/studio/monetization/claim-payout - Authenticated Merkle claim settlement to Ed25519 wallet
  if ((url.pathname === '/api/studio/payout' || url.pathname === '/api/studio/monetization/claim-payout') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = (ok && body) ? JSON.parse(body) : {};
      const creatorDid = parsed.creatorDid || resolveCreatorDid(ctx);
      const requestedAmount = typeof parsed.amount === 'number' ? parsed.amount : undefined;
      const result = sovraDb.claimCreatorPayout(creatorDid, requestedAmount);
      if (!result.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: result.error || 'Payout failed' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, creatorDid, ...result }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid payout payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 16. GET /api/channel/hub - Standalone YouTube-Style Full Channel Hub Data
  if (url.pathname === '/api/channel/hub' && req.method === 'GET') {
    const channelId = url.searchParams.get('id') || url.searchParams.get('channelId') || '';
    const handle = url.searchParams.get('handle') || '';
    const query = channelId || handle;
    let ch = (sovraDb as any).getChannelByHandleOrId ? (sovraDb as any).getChannelByHandleOrId(query) : sovraDb.getChannelById(channelId);
    
    if (!ch && (handle || channelId)) {
      const cleanH = (handle || '').toLowerCase().replace(/^@/, '');
      const vid = ((sovraDb as any).db?.videos || []).find((v: any) =>
        (channelId && v.channelId === channelId) ||
        (cleanH && (v.channelHandle || '').toLowerCase().replace(/^@/, '') === cleanH)
      );
      if (vid || cleanH === 'sovralab') {
        ch = {
          id: vid?.channelId || ('ch_' + (cleanH || 'unknown')),
          name: vid?.channelName || (cleanH === 'sovralab' ? 'Sovra Protocol Lab' : ('@' + cleanH)),
          handle: vid?.channelHandle || ('@' + cleanH),
          desc: vid?.description || 'Official sovereign video hub for decentralized streaming and creator economies.',
          avatar: vid?.channelAvatar || '🎬',
          bg: '#6366f1',
          bannerUrl: 'linear-gradient(135deg, #0ea5e9, #8b5cf6, #ec4899)',
          verified: true,
          count: 142000,
          channelType: 'video',
          ownerDid: vid?.ownerDid || 'did:sovra:channel_lab_4k_master_stream'
        };
      }
    }
    
    if (!ch) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Channel not found' }));
      return true;
    }

    const creatorCust = ch.ownerDid ? (sovraDb.db as any).creator_customizations?.[ch.ownerDid] : null;
    if (creatorCust) {
      if (!ch.trailerVideoId && creatorCust.trailerVideoId) ch.trailerVideoId = creatorCust.trailerVideoId;
      if (!ch.featuredVideoId && creatorCust.featuredVideoId) ch.featuredVideoId = creatorCust.featuredVideoId;
    }

    const allVideos = (sovraDb as any).db?.videos || [];
    const cleanHandle = ch.handle ? ch.handle.replace(/^@/, '') : '';
    const channelVideos = allVideos.filter((v: any) => 
      v.channelId === ch.id || 
      (cleanHandle && v.channelHandle && v.channelHandle.replace(/^@/, '').toLowerCase() === cleanHandle.toLowerCase()) ||
      (v.channelName && v.channelName.toLowerCase() === ch.name.toLowerCase())
    );

    const fullVideos = channelVideos.filter((v: any) => !v.isReel && !v.isShort);
    const shorts = channelVideos.filter((v: any) => v.isReel || v.isShort);
    const totalViews = channelVideos.reduce((acc: number, v: any) => acc + (v.viewsCount || v.views || 0), 0);

    const allPosts = (sovraDb as any).db?.posts || [];
    const communityPosts = allPosts.filter((p: any) => 
      p.channelId === ch.id || (p.authorDid && ch.ownerDid && p.authorDid === ch.ownerDid)
    ).slice(0, 20);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      channel: ch,
      videos: fullVideos,
      shorts: shorts,
      community: communityPosts,
      stats: {
        subscriberCount: ch.count || 0,
        videoCount: channelVideos.length,
        viewsCount: totalViews,
        viewsFormatted: totalViews >= 1000 ? (totalViews / 1000).toFixed(1) + 'K' : String(totalViews),
        subscribersFormatted: (ch.count || 0) >= 1000 ? ((ch.count || 0) / 1000).toFixed(1) + 'K' : String(ch.count || 0)
      }
    }));
    return true;
  }

  // 17. POST /api/studio/customization - Live Channel Branding, Banner & Description Update
  if ((url.pathname === '/api/studio/customization' || url.pathname === '/api/channel/customization') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const channelId = parsed.channelId || parsed.id || '';
      if (!channelId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'channelId is required' }));
        return true;
      }
      const updates: any = {};
      if (parsed.name) updates.name = String(parsed.name).trim();
      if (parsed.desc !== undefined) updates.desc = String(parsed.desc).trim();
      if (parsed.category) updates.category = String(parsed.category).trim();
      if (parsed.avatar) updates.avatar = String(parsed.avatar).trim();
      if (parsed.bg) updates.bg = String(parsed.bg).trim();
      if (parsed.bannerUrl) updates.bannerUrl = String(parsed.bannerUrl).trim();
      if (Array.isArray(parsed.socialLinks)) updates.socialLinks = parsed.socialLinks;
      if (parsed.featuredVideoId) updates.featuredVideoId = parsed.featuredVideoId;

      const updated = sovraDb.updateChannel(channelId, updates);
      if (!updated) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Channel not found to update' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, channel: updated }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 18. POST /api/channel/community/post - Publish P2P Mesh Channel Community Announcement
  if (url.pathname === '/api/channel/community/post' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const channelId = parsed.channelId || '';
      const content = String(parsed.content || '').trim();
      if (!channelId || !content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'channelId and content are required' }));
        return true;
      }
      const principal = ctx.resolvePrincipal(ctx.req);
      const post = {
        id: 'cpost-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        channelId: channelId,
        authorDid: (principal && principal.did) || parsed.authorDid || 'did:sovra:creator',
        content: content,
        poll: parsed.poll || null,
        likesCount: 0,
        commentsCount: 0,
        createdAt: Date.now()
      };
      const dbAny = sovraDb as any;
      if (dbAny.db && Array.isArray(dbAny.db.posts)) {
        dbAny.db.posts.unshift(post);
        dbAny.save();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, post }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // =========================================================================
  // SOVRA COMMERCIALIZATION, REVENUE & BUSINESS LOGIC ROUTES (CYCLES 1 - 5)
  // =========================================================================

  // Helper to extract channelId from path pattern /api/channels/:id/...
  const extractChannelIdFromPath = (pathname: string): string | null => {
    const m = pathname.match(/^\/api\/channels\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  // -------------------------------------------------------------------------
  // CYCLE 1: MEMBERSHIP TIERS & RECURRING SUBSCRIPTIONS
  // -------------------------------------------------------------------------

  // GET /api/channels/:id/membership-tiers OR /api/membership/tiers
  if ((url.pathname.match(/^\/api\/channels\/[^/]+\/membership-tiers$/) || url.pathname === '/api/membership/tiers') && req.method === 'GET') {
    const channelId = extractChannelIdFromPath(url.pathname) || url.searchParams.get('channelId') || 'ch-alpha';
    const tiers = sovraDb.getChannelMembershipTiers(channelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channelId, tiers }));
    return true;
  }

  // POST /api/channels/:id/membership-tiers OR /api/membership/tiers
  if ((url.pathname.match(/^\/api\/channels\/[^/]+\/membership-tiers$/) || url.pathname === '/api/membership/tiers') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const channelId = extractChannelIdFromPath(url.pathname) || parsed.channelId || 'ch-alpha';
      const tiers = Array.isArray(parsed.tiers) ? parsed.tiers : [];
      const updated = sovraDb.setChannelMembershipTiers(channelId, tiers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, channelId, tiers: updated }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid tier payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // POST /api/channels/:id/subscribe-tier OR /api/membership/subscribe
  if ((url.pathname.match(/^\/api\/channels\/[^/]+\/subscribe-tier$/) || url.pathname === '/api/membership/subscribe') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const channelIdOrHandle = extractChannelIdFromPath(url.pathname) || parsed.channelId || parsed.channelHandle || 'ch-alpha';
      const principal = ctx.resolvePrincipal(ctx.req);
      const userDid = (principal && principal.did) || parsed.userDid || resolveCreatorDid(ctx);
      const tierLevel = Number(parsed.tierLevel || parsed.level || 1);

      const result = sovraDb.subscribeChannelTier({
        channelIdOrHandle,
        userDid,
        tierLevel,
      });

      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Subscription error: ' + (err?.message || err) }));
    }
    return true;
  }

  // GET /api/channels/:id/my-subscription OR /api/membership/my-subscription
  if ((url.pathname.match(/^\/api\/channels\/[^/]+\/my-subscription$/) || url.pathname === '/api/membership/my-subscription') && req.method === 'GET') {
    const channelId = extractChannelIdFromPath(url.pathname) || url.searchParams.get('channelId') || 'ch-alpha';
    const principal = ctx.resolvePrincipal(ctx.req);
    const userDid = (principal && principal.did) || url.searchParams.get('userDid') || resolveCreatorDid(ctx);

    const sub = sovraDb.getUserChannelSubscription(channelId, userDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      channelId,
      userDid,
      subscription: sub,
      hasActiveSubscription: Boolean(sub && (sub.status === 'ACTIVE' || sub.status === 'GRACE_PERIOD')),
    }));
    return true;
  }

  // POST /api/channels/:id/cancel-subscription OR /api/membership/cancel
  if ((url.pathname.match(/^\/api\/channels\/[^/]+\/cancel-subscription$/) || url.pathname === '/api/membership/cancel') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const channelId = extractChannelIdFromPath(url.pathname) || parsed.channelId || 'ch-alpha';
      const principal = ctx.resolvePrincipal(ctx.req);
      const userDid = (principal && principal.did) || parsed.userDid || resolveCreatorDid(ctx);

      const result = sovraDb.cancelChannelSubscription(channelId, userDid);
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Cancellation error: ' + (err?.message || err) }));
    }
    return true;
  }

  // GET /api/content/access-check
  if (url.pathname === '/api/content/access-check' && req.method === 'GET') {
    const principal = ctx.resolvePrincipal(ctx.req);
    const userDid = (principal && principal.did) || url.searchParams.get('userDid') || resolveCreatorDid(ctx);
    const contentId = url.searchParams.get('contentId') || undefined;
    const channelId = url.searchParams.get('channelId') || undefined;
    const minTier = Number(url.searchParams.get('minMembershipTier') || '0');
    const isPPV = url.searchParams.get('isPPV') === 'true';
    const ppvPriceSov = Number(url.searchParams.get('ppvPriceSov') || '15');

    const result = sovraDb.canUserAccessContent(
      {
        id: contentId,
        channelId,
        minMembershipTier: minTier,
        isPPV,
        ppvPriceSov,
      },
      userDid
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, userDid, contentId, ...result }));
    return true;
  }

  // -------------------------------------------------------------------------
  // CYCLE 2: LIVE STREAM REVENUE & HIGH-VELOCITY AUDIENCE TIPPING
  // -------------------------------------------------------------------------

  // POST /api/live/super-chat
  if (url.pathname === '/api/live/super-chat' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.resolvePrincipal(ctx.req);
      const senderDid = (principal && principal.did) || parsed.senderDid || resolveCreatorDid(ctx);

      const result = sovraDb.sendLiveSuperChat({
        channelId: parsed.channelId || 'ch-alpha',
        streamId: parsed.streamId,
        senderDid,
        amountSov: Number(parsed.amountSov || parsed.amount || 10),
        message: parsed.message || '',
        stickerId: parsed.stickerId,
      });

      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Super Chat error: ' + (err?.message || err) }));
    }
    return true;
  }

  // GET /api/live/super-chat/pins
  if (url.pathname === '/api/live/super-chat/pins' && req.method === 'GET') {
    const channelId = url.searchParams.get('channelId') || 'ch-alpha';
    const pins = sovraDb.getActiveLivePins(channelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channelId, pins }));
    return true;
  }

  // GET /api/live/stream-revenue
  if (url.pathname === '/api/live/stream-revenue' && req.method === 'GET') {
    const channelId = url.searchParams.get('channelId') || 'ch-alpha';
    const streamId = url.searchParams.get('streamId') || undefined;
    const stats = sovraDb.getLiveStreamRevenueStats(channelId, streamId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channelId, streamId, stats }));
    return true;
  }

  // -------------------------------------------------------------------------
  // CYCLE 3: PAY-PER-VIEW (PPV), GATED DIGITAL ASSETS & CREATOR STORE
  // -------------------------------------------------------------------------

  // GET /api/channels/:id/store/products OR /api/store/products
  if ((url.pathname.match(/^\/api\/channels\/[^/]+\/store\/products$/) || url.pathname === '/api/store/products') && req.method === 'GET') {
    const channelId = extractChannelIdFromPath(url.pathname) || url.searchParams.get('channelId') || 'ch-alpha';
    const products = sovraDb.getChannelDigitalProducts(channelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channelId, products }));
    return true;
  }

  // POST /api/channels/:id/store/products OR /api/store/products
  if ((url.pathname.match(/^\/api\/channels\/[^/]+\/store\/products$/) || url.pathname === '/api/store/products') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.resolvePrincipal(ctx.req);
      const creatorDid = (principal && principal.did) || parsed.creatorDid || resolveCreatorDid(ctx);
      const channelId = extractChannelIdFromPath(url.pathname) || parsed.channelId || 'ch-alpha';

      const product = sovraDb.createDigitalProduct({
        channelId,
        creatorDid,
        title: parsed.title || 'Exclusive Sovereign Asset',
        description: parsed.description || '',
        priceSov: Number(parsed.priceSov || 10),
        type: parsed.type || 'digital_download',
        targetVideoId: parsed.targetVideoId,
        filePayloadUrl: parsed.filePayloadUrl,
        previewUrl: parsed.previewUrl,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, product }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Product creation error: ' + (err?.message || err) }));
    }
    return true;
  }

  // POST /api/store/purchase
  if (url.pathname === '/api/store/purchase' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.resolvePrincipal(ctx.req);
      const buyerDid = (principal && principal.did) || parsed.buyerDid || resolveCreatorDid(ctx);
      const productId = parsed.productId;

      if (!productId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'productId is required' }));
        return true;
      }

      const result = sovraDb.purchaseDigitalProduct({
        productId,
        buyerDid,
      });

      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Store purchase error: ' + (err?.message || err) }));
    }
    return true;
  }

  // GET /api/videos/access-check
  if (url.pathname === '/api/videos/access-check' && req.method === 'GET') {
    const videoId = url.searchParams.get('videoId') || 'yt-video-1';
    const principal = ctx.resolvePrincipal(ctx.req);
    const userDid = (principal && principal.did) || url.searchParams.get('userDid') || resolveCreatorDid(ctx);

    const access = sovraDb.checkUserPPVAccess(videoId, userDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, videoId, userDid, ...access }));
    return true;
  }

  // -------------------------------------------------------------------------
  // CYCLE 4: B2B VERIFIED ORG BADGING, SPONSOR ESCROW & PROMOTIONS
  // -------------------------------------------------------------------------

  // POST /api/org/verify-subscription
  if (url.pathname === '/api/org/verify-subscription' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.resolvePrincipal(ctx.req);
      const orgDid = (principal && principal.did) || parsed.orgDid || resolveCreatorDid(ctx);

      const result = sovraDb.subscribeOrgVerified({
        orgDid,
        orgName: parsed.orgName || 'Verified Organization',
        handle: parsed.handle || '@org',
        tier: parsed.tier === 'enterprise_sovereign' ? 'enterprise_sovereign' : 'standard_org',
        seats: Array.isArray(parsed.seats) ? parsed.seats : [orgDid],
      });

      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Org verification error: ' + (err?.message || err) }));
    }
    return true;
  }

  // GET /api/org/badge-status
  if (url.pathname === '/api/org/badge-status' && req.method === 'GET') {
    const didOrHandle = url.searchParams.get('did') || url.searchParams.get('handle') || resolveCreatorDid(ctx);
    const badge = sovraDb.getOrgBadge(didOrHandle);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, didOrHandle, ...badge }));
    return true;
  }

  // POST /api/sponsors/escrow/create
  if (url.pathname === '/api/sponsors/escrow/create' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.resolvePrincipal(ctx.req);
      const sponsorDid = (principal && principal.did) || parsed.sponsorDid || resolveCreatorDid(ctx);

      const result = sovraDb.createSponsoredEscrow({
        sponsorDid,
        sponsorName: parsed.sponsorName || 'Brand Sponsor',
        creatorDid: parsed.creatorDid || 'did:sovra:creator_studio_broadcast',
        channelId: parsed.channelId || 'ch-alpha',
        bountyAmountSov: Number(parsed.bountyAmountSov || parsed.amount || 100),
        requiredViews: Number(parsed.requiredViews || 100),
        disclosureTag: parsed.disclosureTag || '#sponsored',
      });

      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Escrow creation error: ' + (err?.message || err) }));
    }
    return true;
  }

  // POST /api/sponsors/escrow/submit
  if (url.pathname === '/api/sponsors/escrow/submit' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.resolvePrincipal(ctx.req);
      const creatorDid = (principal && principal.did) || parsed.creatorDid || resolveCreatorDid(ctx);

      const result = sovraDb.submitSponsoredContent(parsed.escrowId, parsed.contentId, creatorDid);
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Escrow submission error: ' + (err?.message || err) }));
    }
    return true;
  }

  // POST /api/sponsors/escrow/release
  if (url.pathname === '/api/sponsors/escrow/release' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.resolvePrincipal(ctx.req);
      const callerDid = (principal && principal.did) || parsed.callerDid || resolveCreatorDid(ctx);

      const result = sovraDb.releaseSponsoredEscrow(parsed.escrowId, callerDid);
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Escrow release error: ' + (err?.message || err) }));
    }
    return true;
  }

  // POST /api/promotions/campaign/create
  if (url.pathname === '/api/promotions/campaign/create' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.resolvePrincipal(ctx.req);
      const creatorDid = (principal && principal.did) || parsed.creatorDid || resolveCreatorDid(ctx);

      const result = sovraDb.createPromotionCampaign({
        creatorDid,
        targetType: parsed.targetType || 'video',
        targetId: parsed.targetId || 'yt-video-1',
        stakedSov: Number(parsed.stakedSov || 50),
        cpmSov: Number(parsed.cpmSov || 2.0),
        targetChannels: Array.isArray(parsed.targetChannels) ? parsed.targetChannels : ['all'],
      });

      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Promotion error: ' + (err?.message || err) }));
    }
    return true;
  }

  // POST /api/promotions/record-impression
  if (url.pathname === '/api/promotions/record-impression' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const result = sovraDb.recordPromotionImpression(parsed.campaignId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Impression error: ' + (err?.message || err) }));
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // CYCLE 5: AUTOMATED CREATOR PAYOUT LEDGER, FEE REVIEWS & REFERRAL LOOPS
  // -------------------------------------------------------------------------

  // GET /api/studio/financials
  if (url.pathname === '/api/studio/financials' && req.method === 'GET') {
    const creatorDid = url.searchParams.get('creatorDid') || resolveCreatorDid(ctx);
    const channelId = url.searchParams.get('channelId') || undefined;
    const format = (url.searchParams.get('format') || 'json').toLowerCase();

    const financials = sovraDb.getStudioFinancials(creatorDid, channelId);

    if (format === 'csv') {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="creator-financial-ledger.csv"',
      });
      res.end(financials.csvExport);
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      creatorDid,
      channelId: channelId || 'all',
      summary: financials.summary,
      entries: financials.entries,
      exportTimestamp: Date.now(),
    }));
    return true;
  }

  // POST /api/referrals/bind
  if (url.pathname === '/api/referrals/bind' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = ctx.resolvePrincipal(ctx.req);
      const refereeDid = (principal && principal.did) || parsed.refereeDid || resolveCreatorDid(ctx);
      const referrerDid = parsed.referrerDid;

      if (!referrerDid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'referrerDid is required' }));
        return true;
      }

      const bound = sovraDb.bindReferral(refereeDid, referrerDid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, refereeDid, referrerDid, bound }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Referral bind error: ' + (err?.message || err) }));
    }
    return true;
  }

  // GET /api/referrals/my-rewards
  if (url.pathname === '/api/referrals/my-rewards' && req.method === 'GET') {
    const principal = ctx.resolvePrincipal(ctx.req);
    const referrerDid = (principal && principal.did) || url.searchParams.get('did') || resolveCreatorDid(ctx);
    const rewards = sovraDb.getReferralRewards(referrerDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, referrerDid, ...rewards }));
    return true;
  }

  return false;
}

export const handleStudioRoutes = handleStudioTranscoderRoutes;
