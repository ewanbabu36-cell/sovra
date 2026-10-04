/**
 * @file packages/protocol/src/channel-mesh.ts
 * Pillar 8: Virtual State Channel Mesh & Autonomous Circular Rebate Netting.
 *
 * Real-world problem:
 * 99% of social users are pure consumers (only send tips) and 1% are creators (only receive).
 * One-way channel exhaustion freezes payments within 2 hours. Frequent on-chain rebalancing
 * destroys the zero-fee promise.
 *
 * Solution:
 * 1. Multi-hop state channel routing through seeder relays.
 * 2. Channel Imbalance Ratio: Lambda = (Local - Remote) / (Local + Remote) in [-1.0, 1.0].
 * 3. Dynamic Fee / Rebate: Rebalancing flows get discounted or negative fees (rebates),
 *    while depleting flows pay congestion premiums.
 * 4. Autonomous circular netting offsets bandwidth debts against creator tips without L1 gas.
 */

export interface VirtualChannelHop {
  readonly channelId: string;
  readonly peerDid: string;
  readonly localBalance: bigint;
  readonly remoteBalance: bigint;
  readonly capacity: bigint;
}

export interface RouteQuote {
  readonly hops: readonly string[];
  readonly totalFee: bigint;
  readonly netRebate: bigint;
  readonly effectivePayment: bigint;
  readonly isFeasible: boolean;
}

/**
 * Calculates channel imbalance ratio Lambda:
 * Lambda = (Local - Remote) / (Local + Remote) in [-1.0, 1.0]
 * Returns 0 if total capacity is 0.
 */
export function calculateChannelImbalance(localBalance: bigint, remoteBalance: bigint): number {
  const total = localBalance + remoteBalance;
  if (total <= 0n) return 0.0;

  const diff = Number(localBalance - remoteBalance);
  const rawLambda = diff / Number(total);
  return Math.max(-1.0, Math.min(1.0, Math.round(rawLambda * 1000) / 1000));
}

/**
 * Calculates dynamic routing fee with autonomous circular rebate:
 * For an outbound payment:
 * FeeMultiplier = 1.0 - Lambda
 * - If Local has surplus (Lambda > 0), outbound payments rebalance the channel -> Fee drops or gives rebate.
 * - If Local is depleted (Lambda < 0), outbound payments worsen imbalance -> Congestion premium added.
 */
export function calculateDynamicRoutingFee(
  baseFee: bigint,
  localBalance: bigint,
  remoteBalance: bigint,
  isOutbound: boolean,
): { fee: bigint; isRebate: boolean } {
  const lambda = calculateChannelImbalance(localBalance, remoteBalance);
  const flowFactor = isOutbound ? -lambda : lambda;
  const multiplier = Math.max(0.1, 1.0 + flowFactor);

  const calculated = (baseFee * BigInt(Math.round(multiplier * 100))) / 100n;
  const isRebate = multiplier < 0.5;

  return {
    fee: calculated,
    isRebate,
  };
}

export class VirtualChannelMeshRouter {
  private readonly channels = new Map<string, VirtualChannelHop>();

  public registerChannel(hop: VirtualChannelHop): void {
    this.channels.set(hop.channelId, hop);
  }

  public getChannel(channelId: string): VirtualChannelHop | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Plans a multi-hop transfer from consumer to creator via intermediary seeders.
   */
  public planMultiHopRoute(
    amount: bigint,
    baseFeePerHop: bigint,
    hopChannelIds: readonly string[],
  ): RouteQuote {
    if (hopChannelIds.length === 0) {
      return {
        hops: [],
        totalFee: 0n,
        netRebate: 0n,
        effectivePayment: amount,
        isFeasible: false,
      };
    }

    let totalFee = 0n;
    let netRebate = 0n;
    let isFeasible = true;

    for (const cid of hopChannelIds) {
      const hop = this.channels.get(cid);
      if (!hop) {
        isFeasible = false;
        break;
      }

      if (hop.localBalance < amount) {
        isFeasible = false;
        break;
      }

      const { fee, isRebate } = calculateDynamicRoutingFee(baseFeePerHop, hop.localBalance, hop.remoteBalance, true);
      totalFee += fee;
      if (isRebate) {
        netRebate += fee;
      }
    }

    return {
      hops: hopChannelIds,
      totalFee,
      netRebate,
      effectivePayment: amount + totalFee - netRebate,
      isFeasible,
    };
  }
}
