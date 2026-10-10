/**
 * @file apps/sovra-app/src/ui/sovra-media/SovraReelsSurface.ts
 * Spatial Reels Vertical Media Controller and Preload Manager
 */

export interface ReelPreloadWindow {
  currentIndex: number;
  preloadIndices: number[];
  evictIndices: number[];
}

export class SovraReelsSurface {
  public static readonly WHEEL_THRESHOLD_PX = 40;

  /**
   * Computes the bounded next index in the vertical feed.
   */
  public static getNextIndex(currentIndex: number, totalCount: number): number {
    if (totalCount <= 0) return 0;
    return Math.min(totalCount - 1, currentIndex + 1);
  }

  /**
   * Computes the bounded previous index in the vertical feed.
   */
  public static getPrevIndex(currentIndex: number): number {
    return Math.max(0, currentIndex - 1);
  }

  /**
   * Calculates the preload window (current, previous, next) and evicts items outside this range.
   * This guarantees that at most 3 video instances are kept warm in memory simultaneously.
   */
  public static calculatePreloadWindow(currentIndex: number, totalCount: number): ReelPreloadWindow {
    if (totalCount <= 0) {
      return { currentIndex: 0, preloadIndices: [], evictIndices: [] };
    }
    const needed = new Set<number>();
    needed.add(currentIndex);
    if (currentIndex > 0) needed.add(currentIndex - 1);
    if (currentIndex < totalCount - 1) needed.add(currentIndex + 1);

    const evictIndices: number[] = [];
    for (let i = 0; i < totalCount; i++) {
      if (!needed.has(i)) {
        evictIndices.push(i);
      }
    }

    return {
      currentIndex,
      preloadIndices: Array.from(needed),
      evictIndices,
    };
  }

  /**
   * Resolves vertical delta from keyboard and wheel events.
   * Returns: +1 for move down (next), -1 for move up (previous), 0 for no move.
   */
  public static resolveNavDelta(deltaY: number): 1 | -1 | 0 {
    if (deltaY > this.WHEEL_THRESHOLD_PX) return 1;
    if (deltaY < -this.WHEEL_THRESHOLD_PX) return -1;
    return 0;
  }
}
