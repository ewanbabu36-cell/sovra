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

function parseJsonBody(req: http.IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
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

      // Security SEC-01-B: Client-controlled verification key override defense
      if ('vKey' in body) {
        sendJson(res, 400, {
          ok: false,
          error: 'Client-supplied verification keys are strictly forbidden. Sovereign canonical verification key is enforced.',
        });
        return true;
      }

      // Pre-flight Nullifier Sybil Defense check
      if (sovraDb.getZkAttestationByNullifier(nullifier)) {
        sendJson(res, 409, {
          ok: false,
          error: 'Nullifier hash already used; duplicate proof-of-humanity attestation rejected',
        });
        return true;
      }

      // Public inputs alignment: Semaphore v3 expects 4 public signals:
      // [merkleTreeRoot, nullifierHash, signalHash, externalNullifierHash]
      if (!Array.isArray(body.publicSignals) || body.publicSignals.length !== 4) {
        sendJson(res, 400, {
          ok: false,
          error: 'Semaphore Groth16 proof requires exactly 4 public signals: [merkleTreeRoot, nullifierHash, signalHash, externalNullifierHash]',
        });
        return true;
      }

      if (body.publicSignals[1].toString() !== nullifier.toString()) {
        sendJson(res, 400, {
          ok: false,
          error: 'Nullifier parameter does not match publicSignals[1] nullifierHash in proof',
        });
        return true;
      }

      // Mathematical bilinear pairing check on BN254 elliptic curve using canonical sovereign vKey
      const verificationResult = verifyGroth16Proof(proofObj, body.publicSignals, DEFAULT_SEMAPHORE_HUMANITY_VKEY);

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
      const { subjectDid, claimType, threshold, claimValue, proof, proofSnarkJson, publicSignals, requireProof } = body;

      if (!subjectDid || !claimType) {
        sendJson(res, 400, { ok: false, error: 'subjectDid and claimType are required' });
        return true;
      }

      // If client strictly requires cryptographic proof verification
      if (requireProof && (!proof && !proofSnarkJson)) {
        sendJson(res, 422, {
          ok: false,
          error: 'ERR_UNPROVEN_CLAIM',
          message: 'Selective disclosure claims cannot be marked cryptographically verified without an authentic zero-knowledge circuit proof. Mock verification is strictly disabled.',
        });
        return true;
      }

      let isCryptographicallyVerified = false;
      let proofRecordJson: string | null = null;

      // If a proof is supplied, verify it strictly
      if (proof || proofSnarkJson) {
        let proofObj: any = null;
        try {
          proofObj = proof && typeof proof === 'object' ? proof : JSON.parse(proofSnarkJson);
        } catch (_) {
          sendJson(res, 400, { ok: false, error: 'Malformed proof object or JSON' });
          return true;
        }

        if (Array.isArray(publicSignals) && publicSignals.length === 4) {
          const vResult = verifyGroth16Proof(proofObj, publicSignals, DEFAULT_SEMAPHORE_HUMANITY_VKEY);
          isCryptographicallyVerified = vResult.valid;
          if (isCryptographicallyVerified) {
            proofRecordJson = JSON.stringify(proofObj);
          }
        }
      }

      const id = `zk_sd_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const nullifier = `nul_sd_${crypto.randomBytes(8).toString('hex')}`;
      const isSatisfied = claimValue !== undefined ? Number(claimValue) >= Number(threshold || 18) : true;

      const attestation: ZkAttestationRecord = {
        id,
        subjectDid,
        attestationType: claimType,
        proofSnarkJson: proofRecordJson || JSON.stringify({
          claimType,
          threshold: threshold || 18,
          cryptographicallyVerified: isCryptographicallyVerified,
          note: isCryptographicallyVerified ? 'Verified via Groth16' : 'Self-asserted; unverified by ZK proof'
        }),
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
          satisfied: isSatisfied,
          nullifierHash: attestation.nullifierHash,
          expiresAt: attestation.expiresAt,
          claimVerified: isCryptographicallyVerified,
          cryptographicallyVerified: isCryptographicallyVerified,
        },
        claimVerified: isCryptographicallyVerified,
        cryptographicallyVerified: isCryptographicallyVerified,
        verificationStatus: isCryptographicallyVerified ? 'VERIFIED_GROTH16' : 'UNVERIFIED_SELF_ASSERTION',
        verificationNotice: isCryptographicallyVerified
          ? 'Cryptographically verified via Groth16 circuit.'
          : 'Self-asserted claim only. Genuine ZK range proof is required for cryptographic verification.',
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
