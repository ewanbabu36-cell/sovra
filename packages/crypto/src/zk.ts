/**
 * @file packages/crypto/src/zk.ts
 * Sovra Protocol - Genuine Zero-Knowledge Groth16 Proof Verifier on BN254 (alt_bn128)
 *
 * Implements rigorous cryptographic bilinear pairing verification for Semaphore
 * zero-knowledge proofs of personhood and humanity attestations.
 */

import { bn254 } from '@noble/curves/bn254';

export interface Groth16Proof {
  pi_a: [string | bigint, string | bigint, ...(string | bigint)[]];
  pi_b: [[string | bigint, string | bigint], [string | bigint, string | bigint], ...any[]];
  pi_c: [string | bigint, string | bigint, ...(string | bigint)[]];
  protocol?: string;
  curve?: string;
}

export interface Groth16VerificationKey {
  protocol?: string;
  curve?: string;
  nPublic?: number;
  vk_alpha_1: [string, string, ...string[]];
  vk_beta_2: [[string, string], [string, string], ...any[]];
  vk_gamma_2: [[string, string], [string, string], ...any[]];
  vk_delta_2: [[string, string], [string, string], ...any[]];
  IC: [string, string][];
}

export interface ZkVerificationResult {
  valid: boolean;
  reason?: string;
}

function toBigInt(val: string | bigint | number | undefined): bigint {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'string') {
    return BigInt(val);
  }
  if (typeof val === 'number') return BigInt(val);
  throw new Error(`Invalid curve scalar: ${val}`);
}

/**
 * Mathematically verifies a Groth16 Zero-Knowledge SNARK proof on the BN254 pairing-friendly elliptic curve.
 *
 * Verifies: e(-pi_a, pi_b) * e(alpha, beta) * e(L, gamma) * e(pi_c, delta) == 1 in Fp12
 */
export function verifyGroth16Proof(
  proof: Groth16Proof,
  publicSignals: (string | bigint)[],
  vKey: Groth16VerificationKey
): ZkVerificationResult {
  try {
    if (!proof || typeof proof !== 'object') {
      return { valid: false, reason: 'Proof must be an object' };
    }
    if (!proof.pi_a || !proof.pi_b || !proof.pi_c) {
      return { valid: false, reason: 'Proof is missing pi_a, pi_b, or pi_c elements' };
    }
    if (!Array.isArray(publicSignals)) {
      return { valid: false, reason: 'Public signals must be an array' };
    }
    if (!vKey || !vKey.IC || !Array.isArray(vKey.IC) || vKey.IC.length === 0) {
      return { valid: false, reason: 'Invalid or missing verification key' };
    }

    if (publicSignals.length + 1 !== vKey.IC.length) {
      return {
        valid: false,
        reason: `Public signals count (${publicSignals.length}) does not match verification key inputs (${vKey.IC.length - 1})`,
      };
    }

    // 1. Construct and validate G1 point: pi_a
    const ax = toBigInt(proof.pi_a[0]);
    const ay = toBigInt(proof.pi_a[1]);
    const pi_a = bn254.G1.ProjectivePoint.fromAffine({ x: ax, y: ay });
    pi_a.assertValidity();

    // 2. Construct and validate G2 point: pi_b
    // snarkjs format represents G2 points with coordinates in Fp2 [c0, c1]
    const bx0 = toBigInt(proof.pi_b[0][0]);
    const bx1 = toBigInt(proof.pi_b[0][1]);
    const by0 = toBigInt(proof.pi_b[1][0]);
    const by1 = toBigInt(proof.pi_b[1][1]);
    const pi_b = bn254.G2.ProjectivePoint.fromAffine({
      x: { c0: bx0, c1: bx1 },
      y: { c0: by0, c1: by1 },
    });
    pi_b.assertValidity();

    // 3. Construct and validate G1 point: pi_c
    const cx = toBigInt(proof.pi_c[0]);
    const cy = toBigInt(proof.pi_c[1]);
    const pi_c = bn254.G1.ProjectivePoint.fromAffine({ x: cx, y: cy });
    pi_c.assertValidity();

    // 4. Construct Public Inputs Linear Combination: L = IC0 + sum(xi * ICi)
    const ic0 = vKey.IC[0];
    if (!ic0 || ic0.length < 2) {
      return { valid: false, reason: 'Invalid IC0 in verification key' };
    }

    let L = bn254.G1.ProjectivePoint.fromAffine({
      x: toBigInt(ic0[0]),
      y: toBigInt(ic0[1]),
    });

    for (let i = 0; i < publicSignals.length; i++) {
      const xi = toBigInt(publicSignals[i]);
      const icItem = vKey.IC[i + 1];
      if (!icItem || icItem.length < 2) {
        return { valid: false, reason: `Invalid IC[${i + 1}] in verification key` };
      }
      const ICi = bn254.G1.ProjectivePoint.fromAffine({
        x: toBigInt(icItem[0]),
        y: toBigInt(icItem[1]),
      });
      L = L.add(ICi.multiply(xi));
    }

    // 5. Construct Verification Key Points
    const alpha1 = bn254.G1.ProjectivePoint.fromAffine({
      x: toBigInt(vKey.vk_alpha_1[0]),
      y: toBigInt(vKey.vk_alpha_1[1]),
    });

    const beta2 = bn254.G2.ProjectivePoint.fromAffine({
      x: { c0: toBigInt(vKey.vk_beta_2[0][0]), c1: toBigInt(vKey.vk_beta_2[0][1]) },
      y: { c0: toBigInt(vKey.vk_beta_2[1][0]), c1: toBigInt(vKey.vk_beta_2[1][1]) },
    });

    const gamma2 = bn254.G2.ProjectivePoint.fromAffine({
      x: { c0: toBigInt(vKey.vk_gamma_2[0][0]), c1: toBigInt(vKey.vk_gamma_2[0][1]) },
      y: { c0: toBigInt(vKey.vk_gamma_2[1][0]), c1: toBigInt(vKey.vk_gamma_2[1][1]) },
    });

    const delta2 = bn254.G2.ProjectivePoint.fromAffine({
      x: { c0: toBigInt(vKey.vk_delta_2[0][0]), c1: toBigInt(vKey.vk_delta_2[0][1]) },
      y: { c0: toBigInt(vKey.vk_delta_2[1][0]), c1: toBigInt(vKey.vk_delta_2[1][1]) },
    });

    // 6. Execute Bilinear Pairings on BN254
    // e(-pi_a, pi_b) * e(alpha, beta) * e(L, gamma) * e(pi_c, delta) == 1
    const neg_pi_a = pi_a.negate();
    const p1 = bn254.pairing(neg_pi_a, pi_b);
    const p2 = bn254.pairing(alpha1, beta2);
    const p3 = bn254.pairing(L, gamma2);
    const p4 = bn254.pairing(pi_c, delta2);

    const Fp12 = bn254.fields.Fp12;
    const prod = Fp12.mul(Fp12.mul(p1, p2), Fp12.mul(p3, p4));
    const isValid = Fp12.eql(prod, Fp12.ONE);

    return {
      valid: isValid,
      reason: isValid ? 'OK' : 'Bilinear pairing check failed: e(-A,B)*e(alpha,beta)*e(L,gamma)*e(C,delta) != 1',
    };
  } catch (err: any) {
    return {
      valid: false,
      reason: `Cryptographic assertion error: ${err.message}`,
    };
  }
}

/**
 * Canonical Semaphore v3 16-Depth Merkle Tree Verification Key from Privacy & Scaling Explorations (PSE)
 * Sourced from the official trusted setup ceremony (Groth16 on BN254 / alt_bn128).
 * Public inputs: [merkleTreeRoot, nullifierHash, signalHash, externalNullifierHash] (nPublic: 4)
 */
export const DEFAULT_SEMAPHORE_HUMANITY_VKEY: Groth16VerificationKey = {
  protocol: 'groth16',
  curve: 'bn128',
  nPublic: 4,
  vk_alpha_1: [
    '20491192805390485299153009773594534940189261866228447918068658471970481763042',
    '9383485363053290200918347156157836566562967994039712273449902621266178545958',
    '1',
  ],
  vk_beta_2: [
    [
      '6375614351688725206403948262868962793625744043794305715222011528459656738731',
      '4252822878758300859123897981450591353533073413197771768651442665752259397132',
    ],
    [
      '10505242626370262277552901082094356697409835680220590971873171140371331206856',
      '21847035105528745403288232691147584728191162732299865338377159692350059136679',
    ],
    ['1', '0'],
  ],
  vk_gamma_2: [
    [
      '10857046999023057135944570762232829481370756359578518086990519993285655852781',
      '11559732032986387107991004021392285783925812861821192530917403151452391805634',
    ],
    [
      '8495653923123431417604973247489272438418190587263600148770280649306958101930',
      '4082367875863433681332203403145435568316851327593401208105741076214120093531',
    ],
    ['1', '0'],
  ],
  vk_delta_2: [
    [
      '16243966861079634958125511652590761846958471358623040426599000904006426210032',
      '13406811599156507528361773763681356312643537981039994686313383243831956396116',
    ],
    [
      '15688083679237922164673518758181461582601853873216319711156397437601833996222',
      '11781596534582143578120404722739278517564025497573071755253972265891888117374',
    ],
    ['1', '0'],
  ],
  IC: [
    [
      '1964404930528116823793003656764176108669615750422202377358993070935069307720',
      '2137714996673694828207437580381836490878070731768805974506391024595988817424',
    ],
    [
      '19568893707760843340848992184233194433177372925415116053368211122719346671126',
      '11639469568629189918046964192305250472192697612201524135560178632824282818614',
    ],
    [
      '5317268879687484957437879782519918549127939892210247573193613900261494313825',
      '528174394975085006443543773707702838726735933116136102590448357278717993744',
    ],
    [
      '14865918005176722116473730206622066845866539143554731094374354951675249722731',
      '3197770568483953664363740385883457803041685902965668289308665954510373380344',
    ],
    [
      '6863358721495494421022713667808247652425178970453300712435830652679038918987',
      '15025816433373311798308762709072064417001390853103872064614174594927359131281',
    ],
  ],
};
