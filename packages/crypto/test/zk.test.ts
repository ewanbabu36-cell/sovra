import { describe, it, expect } from 'vitest';
import { bn254 } from '@noble/curves/bn254';
import { keccak_256 } from '@noble/hashes/sha3';
import { verifyGroth16Proof, DEFAULT_SEMAPHORE_HUMANITY_VKEY } from '../src/zk';
import fs from 'fs';
import path from 'path';

describe('BN254 Groth16 Zero-Knowledge Cryptography', () => {
  const vkeyPath = path.resolve(__dirname, '../../../scratch/semaphore_16_vkey.json');
  const proofPath = path.resolve(__dirname, '../../../scratch/zk-test/semaphore_proof_depth16.json');

  it('validates canonical Semaphore verification key on BN254 curve', () => {
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));

    // 1. Validate alpha_1 on G1
    const alpha1 = bn254.G1.ProjectivePoint.fromAffine({
      x: BigInt(vkey.vk_alpha_1[0]),
      y: BigInt(vkey.vk_alpha_1[1]),
    });
    expect(() => alpha1.assertValidity()).not.toThrow();

    // 2. Validate beta_2 on G2
    // Note: snarkjs stores G2 as [[x0, x1], [y0, y1]] or [[x1, x0], [y1, y0]]
    // Let's test which order satisfies G2 curve equation:
    let beta2Valid = false;
    try {
      const p = bn254.G2.ProjectivePoint.fromAffine({
        x: { c0: BigInt(vkey.vk_beta_2[0][0]), c1: BigInt(vkey.vk_beta_2[0][1]) },
        y: { c0: BigInt(vkey.vk_beta_2[1][0]), c1: BigInt(vkey.vk_beta_2[1][1]) },
      });
      p.assertValidity();
      beta2Valid = true;
      console.log('beta2 is valid with [0, 1] order');
    } catch {
      const p = bn254.G2.ProjectivePoint.fromAffine({
        x: { c0: BigInt(vkey.vk_beta_2[0][1]), c1: BigInt(vkey.vk_beta_2[0][0]) },
        y: { c0: BigInt(vkey.vk_beta_2[1][1]), c1: BigInt(vkey.vk_beta_2[1][0]) },
      });
      p.assertValidity();
      beta2Valid = true;
      console.log('beta2 is valid with [1, 0] order');
    }
    expect(beta2Valid).toBe(true);

    // 3. Validate all IC points on G1
    for (let i = 0; i < vkey.IC.length; i++) {
      const ic = bn254.G1.ProjectivePoint.fromAffine({
        x: BigInt(vkey.IC[i][0]),
        y: BigInt(vkey.IC[i][1]),
      });
      expect(() => ic.assertValidity()).not.toThrow();
    }
  });

  it('cryptographically verifies genuine Semaphore Groth16 proof using bilinear pairings', () => {
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
    const proofData = JSON.parse(fs.readFileSync(proofPath, 'utf8'));

    function semaphoreHash(message: string | number | bigint) {
      const bn = BigInt(message);
      let hex = bn.toString(16);
      if (hex.length % 2 !== 0) hex = '0' + hex;
      const rawBytes = Buffer.from(hex, 'hex');
      const padded = new Uint8Array(32);
      padded.set(rawBytes, 32 - rawBytes.length);
      const hashBytes = keccak_256(padded);
      const hashHex = Buffer.from(hashBytes).toString('hex');
      return (BigInt('0x' + hashHex) >> 8n).toString();
    }

    const sHash = semaphoreHash(proofData.signal);
    const extHash = semaphoreHash(proofData.externalNullifier);

    const publicSignals = [
      proofData.merkleTreeRoot,
      proofData.nullifierHash,
      sHash,
      extHash,
    ];

    const snarkProof = {
      pi_a: [proofData.proof[0], proofData.proof[1], '1'] as [string, string, string],
      pi_b: [
        [proofData.proof[3], proofData.proof[2]],
        [proofData.proof[5], proofData.proof[4]],
        ['1', '0'],
      ] as [[string, string], [string, string], [string, string]],
      pi_c: [proofData.proof[6], proofData.proof[7], '1'] as [string, string, string],
      protocol: 'groth16',
      curve: 'bn128',
    };

    const res = verifyGroth16Proof(snarkProof, publicSignals, vkey);
    console.log('Test result:', res);
    expect(res.valid).toBe(true);
  });

  it('rejects tampered public signals (adversarial proof forgery)', () => {
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
    const proofData = JSON.parse(fs.readFileSync(proofPath, 'utf8'));

    function semaphoreHash(message: string | number | bigint) {
      const bn = BigInt(message);
      let hex = bn.toString(16);
      if (hex.length % 2 !== 0) hex = '0' + hex;
      const rawBytes = Buffer.from(hex, 'hex');
      const padded = new Uint8Array(32);
      padded.set(rawBytes, 32 - rawBytes.length);
      const hashBytes = keccak_256(padded);
      const hashHex = Buffer.from(hashBytes).toString('hex');
      return (BigInt('0x' + hashHex) >> 8n).toString();
    }

    const sHash = semaphoreHash(proofData.signal);
    // Tamper the external nullifier hash
    const forgedExtHash = (BigInt(semaphoreHash(proofData.externalNullifier)) + 1n).toString();

    const tamperedSignals = [
      proofData.merkleTreeRoot,
      proofData.nullifierHash,
      sHash,
      forgedExtHash,
    ];

    const snarkProof = {
      pi_a: [proofData.proof[0], proofData.proof[1], '1'] as [string, string, string],
      pi_b: [
        [proofData.proof[3], proofData.proof[2]],
        [proofData.proof[5], proofData.proof[4]],
        ['1', '0'],
      ] as [[string, string], [string, string], [string, string]],
      pi_c: [proofData.proof[6], proofData.proof[7], '1'] as [string, string, string],
      protocol: 'groth16',
      curve: 'bn128',
    };

    const res = verifyGroth16Proof(snarkProof, tamperedSignals, vkey);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Bilinear pairing check failed');
  });

  it('rejects tampered proof coordinates', () => {
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
    const proofData = JSON.parse(fs.readFileSync(proofPath, 'utf8'));

    function semaphoreHash(message: string | number | bigint) {
      const bn = BigInt(message);
      let hex = bn.toString(16);
      if (hex.length % 2 !== 0) hex = '0' + hex;
      const rawBytes = Buffer.from(hex, 'hex');
      const padded = new Uint8Array(32);
      padded.set(rawBytes, 32 - rawBytes.length);
      const hashBytes = keccak_256(padded);
      const hashHex = Buffer.from(hashBytes).toString('hex');
      return (BigInt('0x' + hashHex) >> 8n).toString();
    }

    const publicSignals = [
      proofData.merkleTreeRoot,
      proofData.nullifierHash,
      semaphoreHash(proofData.signal),
      semaphoreHash(proofData.externalNullifier),
    ];

    const tamperedProof = {
      pi_a: [(BigInt(proofData.proof[0]) + 1n).toString(), proofData.proof[1], '1'] as [string, string, string],
      pi_b: [
        [proofData.proof[3], proofData.proof[2]],
        [proofData.proof[5], proofData.proof[4]],
        ['1', '0'],
      ] as [[string, string], [string, string], [string, string]],
      pi_c: [proofData.proof[6], proofData.proof[7], '1'] as [string, string, string],
      protocol: 'groth16',
      curve: 'bn128',
    };

    const res = verifyGroth16Proof(tamperedProof, publicSignals, vkey);
    expect(res.valid).toBe(false);
  });
});
