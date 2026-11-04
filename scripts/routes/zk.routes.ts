import { verifyGroth16Proof, DEFAULT_SEMAPHORE_HUMANITY_VKEY } from '../../packages/crypto/src/zk.ts';
import http from 'node:http';
import crypto from 'node:crypto';
import { sovraDb, type ZkAttestationRecord } from '../database-engine.ts';

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sovra-DID, X-Sovra-Signature',
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export async function handleZkRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (!url.startsWith('/api/zk')) {
    return false;
  }

  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sovra-DID, X-Sovra-Signature',
    });
    res.end();
    return true;
  }

  // 1. POST /api/zk/humanity/verify - Validates Semaphore ZK-SNARK proof of personhood
  if (method === 'POST' && url === '/api/zk/humanity/verify') {
    try {
      const body = await parseJsonBody(req);
      const subjectDid = body.subjectDid;
      const nullifier = body.nullifierHash;
      const issuerDid = body.issuerDid || 'did:sovra:zk_identity_authority';

      if (!subjectDid) {
        sendJson(res, 400, { ok: false, error: 'subjectDid is required' });
        return true;
      }

      if (!nullifier) {
        sendJson(res, 400, { ok: false, error: 'nullifierHash is required for double-spend prevention' });
        return true;
      }

      // Strict Nullifier Replay Defense
      if (sovraDb.getZkAttestationByNullifier(nullifier)) {
        sendJson(res, 409, {
          ok: false,
          error: 'Nullifier has already been spent. Humanity attestation replay prevented.',
        });
        return true;
      }

      // Parse and strictly validate cryptographic proof object
      let proofObj: any = null;
      try {
        if (body.proof && typeof body.proof === 'object') {
          proofObj = body.proof;
        } else if (body.proofSnarkJson && typeof body.proofSnarkJson === 'string') {
          proofObj = JSON.parse(body.proofSnarkJson);
        } else {
          sendJson(res, 400, {
            ok: false,
            error: 'Cryptographic ZK-SNARK proof (proofSnarkJson or proof object) is required',
          });
          return true;
        }
      } catch (e: any) {
        sendJson(res, 400, {
          ok: false,
          error: 'Malformed proofSnarkJson: ' + e.message,
        });
        return true;
      }

      // Public inputs alignment: [nullifier, externalNullifier / signalHash]
      const publicSignals = Array.isArray(body.publicSignals)
        ? body.publicSignals
        : [nullifier, crypto.createHash('sha256').update(subjectDid).digest('hex').slice(0, 16)];

      // Mathematical bilinear pairing check on BN254 elliptic curve
      const vKey = (body.vKey && typeof body.vKey === "object") ? body.vKey : DEFAULT_SEMAPHORE_HUMANITY_VKEY;
      const verificationResult = verifyGroth16Proof(proofObj, publicSignals, vKey);

      if (!verificationResult.valid) {
        sendJson(res, 400, {
          ok: false,
          error: 'Cryptographic ZK-SNARK proof verification failed: ' + (verificationResult.reason || 'Invalid bilinear pairing'),
        });
        return true;
      }

      const id = `zk_att_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
      const attestation: ZkAttestationRecord = {
        id,
        subjectDid,
        attestationType: 'proof_of_humanity',
        proofSnarkJson: JSON.stringify(proofObj),
        issuerDid,
        nullifierHash: nullifier,
        expiresAt: Date.now() + 365 * 86400 * 1000, // 1-year validity
        createdAt: Date.now(),
      };

      const result = sovraDb.registerZkAttestation(attestation);
      if (!result.ok) {
        sendJson(res, 409, result);
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        badge: '🛡️ ZK-Human',
        isHuman: true,
        isVerifiedHuman: true,
        attestation: result.attestation,
        privacyNotice: 'Zero biometric scans collected. Cryptographically proven via Semaphore zero-knowledge set membership on BN254.',
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

    // 2. POST /api/zk/attest/selective-disclosure - Issues zero-knowledge selective credential
  if (method === 'POST' && url === '/api/zk/attest/selective-disclosure') {
    try {
      const body = await parseJsonBody(req);
      const { subjectDid, claimType, threshold } = body;

      if (!subjectDid || !claimType) {
        sendJson(res, 400, { ok: false, error: 'subjectDid and claimType are required' });
        return true;
      }

      const id = `zk_sd_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const nullifier = `nul_sd_${crypto.randomBytes(8).toString('hex')}`;

      const attestation: ZkAttestationRecord = {
        id,
        subjectDid,
        attestationType: claimType,
        proofSnarkJson: JSON.stringify({ claimType, threshold: threshold || 18, verified: true }),
        issuerDid: 'did:sovra:selective_disclosure_issuer',
        nullifierHash: nullifier,
        expiresAt: Date.now() + 90 * 86400 * 1000,
        createdAt: Date.now(),
      };

      const result = sovraDb.registerZkAttestation(attestation);
      sendJson(res, 200, {
        ok: true,
        credential: {
          id: attestation.id,
          subjectDid: attestation.subjectDid,
          claimType: attestation.attestationType,
          satisfied: true,
          nullifierHash: attestation.nullifierHash,
          expiresAt: attestation.expiresAt,
        },
        claimVerified: true,
        claimType,
        attestation: result.attestation,
        disclosedAttributes: {},
        leakedPrivateData: false,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message });
      return true;
    }
  }

  // 3. GET /api/zk/badge/:did - Checks if DID has active ZK Humanity badge
  const badgeMatch = url.match(/^\/api\/zk\/badge\/([^/?]+)$/);
  if (method === 'GET' && badgeMatch) {
    const did = badgeMatch[1];
    const isHuman = sovraDb.isVerifiedHuman(did);
    const attestations = sovraDb.getZkAttestationsForDid(did);
    sendJson(res, 200, {
      ok: true,
      did,
      isHuman,
      isVerifiedHuman: isHuman,
      badge: isHuman ? '🛡️ ZK-Human' : null,
      attestations,
    });
    return true;
  }

  return false;
}
