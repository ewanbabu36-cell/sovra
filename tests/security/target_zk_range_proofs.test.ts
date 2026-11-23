import { describe, it, expect } from 'vitest';
import {
  verifyGroth16Proof,
  DEFAULT_RANGE_PROOF_VKEY,
  generateGroth16RangeProof,
} from '../../packages/crypto/src/zk.ts';
import { handleZkRoutes } from '../../scripts/routes/zk.routes.ts';
import { EventEmitter } from 'node:events';

function createMockReqRes(method: string, url: string, body?: any) {
  const req = new EventEmitter() as any;
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json' };

  let statusCode = 200;
  let responseData = '';
  const headers: Record<string, string> = {};

  const res = {
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(data?: string) {
      if (data) responseData += data;
      res.emit?.('finish');
    },
  } as any;

  process.nextTick(() => {
    if (body) {
      req.emit('data', Buffer.from(JSON.stringify(body)));
    }
    req.emit('end');
  });

  return {
    req,
    res,
    getResponse: () => ({
      statusCode,
      headers,
      body: responseData,
      json: () => JSON.parse(responseData || '{}'),
    }),
  };
}

describe('Target ZK Range Proofs - BN254 Groth16 Standards Verification', () => {
  it('generates genuine Groth16 range proof when privateValue >= threshold (Age 25 >= 18)', () => {
    const { proof, publicSignals } = generateGroth16RangeProof({
      privateValue: 25,
      threshold: 18,
      nullifierSeed: `user_age_seed_${Date.now()}`,
    });

    expect(proof).toBeDefined();
    expect(proof.pi_a).toHaveLength(3);
    expect(proof.pi_b).toHaveLength(3);
    expect(proof.pi_c).toHaveLength(3);
    expect(publicSignals).toHaveLength(2);
    expect(publicSignals[0]).toBe('18');

    const result = verifyGroth16Proof(proof, publicSignals, DEFAULT_RANGE_PROOF_VKEY);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('OK');
  });

  it('generates genuine Groth16 range proof for solvency (Balance 50,000 SOV >= 10,000 SOV Escrow)', () => {
    const { proof, publicSignals } = generateGroth16RangeProof({
      privateValue: 50000,
      threshold: 10000,
      nullifierSeed: `solvency_seed_${Date.now()}`,
    });

    const result = verifyGroth16Proof(proof, publicSignals, DEFAULT_RANGE_PROOF_VKEY);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('OK');
  });

  it('strictly rejects generating range proof when privateValue < threshold (Fail-Closed Prover)', () => {
    expect(() => {
      generateGroth16RangeProof({
        privateValue: 16,
        threshold: 18,
      });
    }).toThrow(/is strictly less than required threshold/i);
  });

  it('rejects tampered threshold in public signals (Bilinear Pairing Defense)', () => {
    const { proof, publicSignals } = generateGroth16RangeProof({
      privateValue: 30,
      threshold: 21,
      nullifierSeed: `tamper_test_${Date.now()}`,
    });

    // Tamper public threshold: claim threshold was 25 instead of 21
    const tamperedSignals = ['25', publicSignals[1]];
    const result = verifyGroth16Proof(proof, tamperedSignals, DEFAULT_RANGE_PROOF_VKEY);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Bilinear pairing check failed');
  });

  it('rejects tampered nullifier in public signals', () => {
    const { proof, publicSignals } = generateGroth16RangeProof({
      privateValue: 30,
      threshold: 21,
      nullifierSeed: `nullifier_tamper_${Date.now()}`,
    });

    const tamperedSignals = [publicSignals[0], '99999999999999999999'];
    const result = verifyGroth16Proof(proof, tamperedSignals, DEFAULT_RANGE_PROOF_VKEY);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Bilinear pairing check failed');
  });

  it('rejects tampered curve coordinates in pi_a', () => {
    const { proof, publicSignals } = generateGroth16RangeProof({
      privateValue: 25,
      threshold: 18,
      nullifierSeed: `coord_tamper_${Date.now()}`,
    });

    const forgedProof = {
      ...proof,
      pi_a: [
        (BigInt(proof.pi_a[0] as string) + 1n).toString(),
        proof.pi_a[1],
        proof.pi_a[2],
      ] as [string, string, string],
    };

    const result = verifyGroth16Proof(forgedProof, publicSignals, DEFAULT_RANGE_PROOF_VKEY);
    expect(result.valid).toBe(false);
  });

  it('POST /api/zk/attest/selective-disclosure verifies authentic range proof and upgrades to VERIFIED_GROTH16', async () => {
    const subjectDid = `did:sovra:zk_user_${Date.now()}`;
    const { proof, publicSignals } = generateGroth16RangeProof({
      privateValue: 28,
      threshold: 21,
      nullifierSeed: `attest_seed_${Date.now()}`,
    });

    const { req, res, getResponse } = createMockReqRes('POST', '/api/zk/attest/selective-disclosure', {
      subjectDid,
      claimType: 'age_over_21',
      threshold: 21,
      proof,
      publicSignals,
      requireProof: true,
    });

    const handled = await handleZkRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(200);
    const json = resp.json();
    expect(json.ok).toBe(true);
    expect(json.verificationStatus).toBe('VERIFIED_GROTH16');
    expect(json.claimVerified).toBe(true);
    expect(json.cryptographicallyVerified).toBe(true);
    expect(json.leakedPrivateData).toBe(false);
    expect(json.credential.claimVerified).toBe(true);
    expect(json.credential.nullifierHash).toBe(publicSignals[1]);
  });

  it('POST /api/zk/attest/selective-disclosure rejects forged range proof when requireProof: true', async () => {
    const subjectDid = `did:sovra:zk_attacker_${Date.now()}`;
    const { proof, publicSignals } = generateGroth16RangeProof({
      privateValue: 28,
      threshold: 21,
      nullifierSeed: `forge_seed_${Date.now()}`,
    });

    // Tamper with public signals
    const forgedSignals = ['21', '123456789123456789'];

    const { req, res, getResponse } = createMockReqRes('POST', '/api/zk/attest/selective-disclosure', {
      subjectDid,
      claimType: 'age_over_21',
      threshold: 21,
      proof,
      publicSignals: forgedSignals,
      requireProof: true,
    });

    const handled = await handleZkRoutes(req, res);
    expect(handled).toBe(true);

    const resp = getResponse();
    expect(resp.statusCode).toBe(422);
    const json = resp.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('ERR_UNPROVEN_CLAIM');
  });

  it('POST /api/zk/attest/selective-disclosure prevents nullifier replay on verified credentials', async () => {
    const subjectDid = `did:sovra:zk_user_replay_${Date.now()}`;
    const { proof, publicSignals } = generateGroth16RangeProof({
      privateValue: 35,
      threshold: 18,
      nullifierSeed: `replay_seed_${Date.now()}`,
    });

    // First registration
    const { req: req1, res: res1, getResponse: getResp1 } = createMockReqRes(
      'POST',
      '/api/zk/attest/selective-disclosure',
      {
        subjectDid,
        claimType: 'age_over_18',
        threshold: 18,
        proof,
        publicSignals,
        requireProof: true,
      }
    );
    await handleZkRoutes(req1, res1);
    expect(getResp1().statusCode).toBe(200);

    // Replay with identical proof and nullifier
    const { req: req2, res: res2, getResponse: getResp2 } = createMockReqRes(
      'POST',
      '/api/zk/attest/selective-disclosure',
      {
        subjectDid: `did:sovra:zk_attacker_${Date.now()}`,
        claimType: 'age_over_18',
        threshold: 18,
        proof,
        publicSignals,
        requireProof: true,
      }
    );
    await handleZkRoutes(req2, res2);
    const resp2 = getResp2();
    expect(resp2.statusCode).toBe(409);
    expect(resp2.json().error).toMatch(/already used|duplicate/i);
  });
});
