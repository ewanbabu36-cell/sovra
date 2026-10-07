/**
 * @file packages/social/src/reputation.ts
 * Multidimensional Sybil-Resistant Reputation Engine for Sovra.
 *
 * Implements:
 * 1. 5 Distinct Epistemic & Behavioral Dimensions:
 *    - Knowledge Contribution
 *    - Community Contribution
 *    - Node & Routing Reliability
 *    - Bilateral Trust
 *    - Content Safety & Quality
 * 2. Web-of-Trust (WoT) Damping Factor:
 *    - Weights assertions by graph distance from the observer.
 *    - Prevents isolated Sybil rings from fabricating artificial reputation.
 * 3. Self-assertion filtering (self-ratings have 0 weight).
 */

import { bytesToHex } from '@sovra/crypto';
import { decodeEd25519DidKey } from '@sovra/identity';
import { ReputationDimension, ReputationAssertionPayload } from '@sovra/protocol';
import { SocialGraphEngine } from './types.js';

export interface MultidimensionalScore {
  readonly knowledge: number; // 0 to 100
  readonly community: number; // 0 to 100
  readonly reliability: number; // 0 to 100
  readonly trust: number; // 0 to 100
  readonly content: number; // 0 to 100
  readonly compositeScore: number; // 0 to 100 weighted aggregate
  readonly wotConfidence: number; // 0.0 to 1.0 confidence based on graph connectivity
}

export interface ReputationEngineOptions {
  dampingFactor?: number | undefined; // Default: 0.5 per hop
  maxGraphHops?: number | undefined; // Default: 3
}

export class MultidimensionalReputationEngine {
  private readonly assertionsBySubject = new Map<string, Array<{ issuerDid: string; payload: ReputationAssertionPayload; timestamp: number }>>();
  private readonly dampingFactor: number;
  private readonly maxGraphHops: number;

  constructor(options: ReputationEngineOptions = {}) {
    this.dampingFactor = options.dampingFactor ?? 0.5;
    this.maxGraphHops = options.maxGraphHops ?? 3;
  }

  /**
   * Records a signed reputation assertion from an issuer about a subject.
   */
  public recordAssertion(issuerDid: string, payload: ReputationAssertionPayload, timestamp = Date.now()): boolean {
    // Self-assertions are strictly rejected
    if (issuerDid === payload.subjectDid) {
      return false;
    }

    let list = this.assertionsBySubject.get(payload.subjectDid);
    if (!list) {
      list = [];
      this.assertionsBySubject.set(payload.subjectDid, list);
    }

    list.push({
      issuerDid,
      payload,
      timestamp,
    });

    return true;
  }

  /**
   * Computes multidimensional reputation for targetDid from the perspective of observerDid.
   * Uses Web-of-Trust graph distance to dampen untrusted or Sybil assertions.
   */
  public computeScore(
    targetDid: string,
    observerDid: string,
    graphEngine?: SocialGraphEngine,
  ): MultidimensionalScore {
    const assertions = this.assertionsBySubject.get(targetDid) ?? [];

    const dimTotals: Record<ReputationDimension, { weightedSum: number; weightSum: number }> = {
      knowledge: { weightedSum: 50, weightSum: 1 }, // Prior baseline 50
      community: { weightedSum: 50, weightSum: 1 },
      reliability: { weightedSum: 50, weightSum: 1 },
      trust: { weightedSum: 50, weightSum: 1 },
      content: { weightedSum: 50, weightSum: 1 },
    };

    let totalWeightAccumulated = 0;

    for (const record of assertions) {
      const distance = this.calculateWotDistance(observerDid, record.issuerDid, graphEngine);
      if (distance > this.maxGraphHops) continue;

      const weight = Math.pow(this.dampingFactor, distance);
      const deltaScaled = record.payload.scoreDelta * 50; // -1..+1 mapped to -50..+50

      const dim = dimTotals[record.payload.dimension];
      if (dim) {
        dim.weightedSum += (50 + deltaScaled) * weight;
        dim.weightSum += weight;
        totalWeightAccumulated += weight;
      }
    }

    const knowledge = Math.max(0, Math.min(100, dimTotals.knowledge.weightedSum / dimTotals.knowledge.weightSum));
    const community = Math.max(0, Math.min(100, dimTotals.community.weightedSum / dimTotals.community.weightSum));
    const reliability = Math.max(0, Math.min(100, dimTotals.reliability.weightedSum / dimTotals.reliability.weightSum));
    const trust = Math.max(0, Math.min(100, dimTotals.trust.weightedSum / dimTotals.trust.weightSum));
    const content = Math.max(0, Math.min(100, dimTotals.content.weightedSum / dimTotals.content.weightSum));

    // Balanced composite score
    const compositeScore =
      knowledge * 0.25 +
      community * 0.20 +
      reliability * 0.20 +
      trust * 0.20 +
      content * 0.15;

    const wotConfidence = Math.min(1.0, totalWeightAccumulated / 5.0);

    return {
      knowledge: Number(knowledge.toFixed(1)),
      community: Number(community.toFixed(1)),
      reliability: Number(reliability.toFixed(1)),
      trust: Number(trust.toFixed(1)),
      content: Number(content.toFixed(1)),
      compositeScore: Number(compositeScore.toFixed(1)),
      wotConfidence: Number(wotConfidence.toFixed(2)),
    };
  }

  /**
   * Breadth-first search for Web-of-Trust graph distance between observer and issuer.
   */
  private calculateWotDistance(
    observerDid: string,
    issuerDid: string,
    graphEngine?: SocialGraphEngine,
  ): number {
    if (observerDid === issuerDid) return 0;
    if (!graphEngine) return 1;

    let targetPubkeyHex: string;
    try {
      targetPubkeyHex = bytesToHex(decodeEd25519DidKey(issuerDid));
    } catch {
      targetPubkeyHex = issuerDid;
    }

    let observerPubkeyHex: string;
    try {
      observerPubkeyHex = bytesToHex(decodeEd25519DidKey(observerDid));
    } catch {
      observerPubkeyHex = observerDid;
    }

    if (observerPubkeyHex === targetPubkeyHex) return 0;

    const visited = new Set<string>([observerPubkeyHex]);
    const queue: Array<{ pubkeyHex: string; depth: number }> = [{ pubkeyHex: observerPubkeyHex, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= this.maxGraphHops) continue;

      const neighbors = graphEngine.getFollowing(current.pubkeyHex);

      for (const neighborPubkey of neighbors) {
        if (neighborPubkey === targetPubkeyHex) {
          return current.depth + 1;
        }

        if (!visited.has(neighborPubkey)) {
          visited.add(neighborPubkey);
          queue.push({ pubkeyHex: neighborPubkey, depth: current.depth + 1 });
        }
      }
    }

    return this.maxGraphHops + 1; // Unreachable within max hops
  }
}
