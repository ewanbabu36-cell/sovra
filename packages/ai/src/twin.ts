import { KnowledgeTwinEntry, TwinEntryType } from './types.js';

export class PrivateKnowledgeTwin {
  private readonly entries = new Map<string, KnowledgeTwinEntry>();
  private readonly readItemIds = new Set<string>();

  /**
   * Records that the user has read a post, event, or claim.
   * Stored strictly locally.
   */
  public markAsRead(
    targetId: string,
    topicTags: readonly string[] = [],
    userNotes?: string,
  ): KnowledgeTwinEntry {
    const id = `twin_read_${targetId}_${Date.now()}`;
    const entry: KnowledgeTwinEntry = {
      id,
      type: 'READ',
      targetId,
      topicTags: [...topicTags],
      epistemicConfidence: 1.0,
      userNotes,
      recordedAt: Date.now(),
      isPrivate: true,
    };

    this.entries.set(id, entry);
    this.readItemIds.add(targetId);
    return entry;
  }

  /**
   * Records a claim or fact the user knows / has validated.
   */
  public recordKnowledge(
    targetId: string,
    topicTags: readonly string[],
    confidence: number,
    userNotes?: string,
  ): KnowledgeTwinEntry {
    const id = `twin_known_${targetId}_${Date.now()}`;
    const entry: KnowledgeTwinEntry = {
      id,
      type: 'KNOWN',
      targetId,
      topicTags: [...topicTags],
      epistemicConfidence: Math.max(0, Math.min(1, confidence)),
      userNotes,
      recordedAt: Date.now(),
      isPrivate: true,
    };

    this.entries.set(id, entry);
    return entry;
  }

  /**
   * Records that the user explicitly trusts a claim, source, or author.
   */
  public recordTrustAssertion(
    targetId: string,
    topicTags: readonly string[],
    confidence = 0.9,
    userNotes?: string,
  ): KnowledgeTwinEntry {
    const id = `twin_trust_${targetId}_${Date.now()}`;
    const entry: KnowledgeTwinEntry = {
      id,
      type: 'TRUSTED',
      targetId,
      topicTags: [...topicTags],
      epistemicConfidence: Math.max(0, Math.min(1, confidence)),
      userNotes,
      recordedAt: Date.now(),
      isPrivate: true,
    };

    this.entries.set(id, entry);
    return entry;
  }

  /**
   * Records that the user explicitly rejects a claim as false, deceptive, or low-quality.
   */
  public recordRejection(
    targetId: string,
    topicTags: readonly string[],
    userNotes?: string,
  ): KnowledgeTwinEntry {
    const id = `twin_reject_${targetId}_${Date.now()}`;
    const entry: KnowledgeTwinEntry = {
      id,
      type: 'REJECTED',
      targetId,
      topicTags: [...topicTags],
      epistemicConfidence: 0.0,
      userNotes,
      recordedAt: Date.now(),
      isPrivate: true,
    };

    this.entries.set(id, entry);
    return entry;
  }

  public isRead(targetId: string): boolean {
    return this.readItemIds.has(targetId);
  }

  public getReadItemIds(): ReadonlySet<string> {
    return new Set(this.readItemIds);
  }

  public getEntriesByType(type: TwinEntryType): readonly KnowledgeTwinEntry[] {
    const result: KnowledgeTwinEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.type === type) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * Computes user's private topic profile: items read, trusted claims, rejected claims.
   */
  public getTopicProficiency(topic: string): {
    itemsRead: number;
    trustedClaims: number;
    rejectedClaims: number;
  } {
    const lower = topic.toLowerCase();
    let itemsRead = 0;
    let trustedClaims = 0;
    let rejectedClaims = 0;

    for (const entry of this.entries.values()) {
      const matchesTopic = entry.topicTags.some(t => t.toLowerCase() === lower);
      if (!matchesTopic) continue;

      if (entry.type === 'READ') itemsRead++;
      else if (entry.type === 'TRUSTED' || entry.type === 'KNOWN') trustedClaims++;
      else if (entry.type === 'REJECTED') rejectedClaims++;
    }

    return { itemsRead, trustedClaims, rejectedClaims };
  }

  // =========================================================================
  // STRICT PRIVACY BOUNDARY ENFORCEMENT
  // =========================================================================

  /**
   * Invariant check: Knowledge Twin entries must NEVER be exported for public gossip.
   * Calling this method throws or strictly returns an empty list, guaranteeing
   * zero leakage to public mesh/relays.
   */
  public exportForPublicSync(): never {
    throw new Error(
      'Privacy boundary violation: Private knowledge twin entries are strictly local and cannot be synced over public gossip.',
    );
  }

  /**
   * Validates whether any arbitrary item is safe to broadcast to public mesh.
   */
  public static canExportToPublicMesh(entry: { isPrivate?: boolean }): boolean {
    return !entry.isPrivate;
  }

  /**
   * Returns total number of private entries stored locally.
   */
  public getEntryCount(): number {
    return this.entries.size;
  }
}
