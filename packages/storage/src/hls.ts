import { CID } from './cid.js';
import { BitSwapEngine } from './bitswap.js';

export type VideoResolution = '360p' | '480p' | '720p' | '1080p';

export interface HlsVideoSegment {
  readonly sequenceNumber: number;
  readonly durationSeconds: number;
  readonly cid: string;
  readonly byteLength: number;
  readonly resolution?: VideoResolution | undefined;
}

export interface HlsStreamVariant {
  readonly resolution: VideoResolution;
  readonly bandwidth: number;
  readonly width: number;
  readonly height: number;
  readonly uri: string;
}

/**
 * Standard HLS Master Playlist Generator (RFC 8216)
 */
export function generateHlsMasterPlaylist(variants: readonly HlsStreamVariant[]): string {
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];

  for (const variant of variants) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.width}x${variant.height},NAME="${variant.resolution}"`,
    );
    lines.push(variant.uri);
  }

  return lines.join('\n') + '\n';
}

/**
 * Standard HLS Media Playlist Generator (RFC 8216)
 */
export function generateHlsMediaPlaylist(
  segments: readonly HlsVideoSegment[],
  targetDurationSeconds = 2,
): string {
  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${Math.ceil(targetDurationSeconds)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
  ];

  for (const seg of segments) {
    lines.push(`#EXTINF:${seg.durationSeconds.toFixed(1)},`);
    lines.push(seg.cid.startsWith('ipfs://') ? seg.cid : `ipfs://${seg.cid}`);
  }

  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}

/**
 * Parses an m3u8 media playlist into structured segment descriptors.
 */
export function parseM3u8MediaPlaylist(content: string): HlsVideoSegment[] {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const segments: HlsVideoSegment[] = [];

  let currentDuration = 2.0;
  let seq = 0;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const durPart = line.substring(8).split(',')[0];
      if (durPart) {
        currentDuration = parseFloat(durPart) || 2.0;
      }
    } else if (!line.startsWith('#')) {
      // It's a URI / CID line
      const cleanCid = line.replace('ipfs://', '');
      segments.push({
        sequenceNumber: seq++,
        durationSeconds: currentDuration,
        cid: cleanCid,
        byteLength: 0,
      });
    }
  }

  return segments;
}

export interface SlidingWindowConfig {
  readonly windowSize?: number; // Number of forward segments to pre-buffer (default 3)
  readonly keepBehindCount?: number; // Number of past segments to retain before eviction (default 2)
  readonly peerCandidates?: readonly string[];
}

/**
 * Sliding Window Buffer Pre-Fetcher.
 * Designed for sub-second video startup (<300ms) and stutter-free streaming over BitSwap:
 * 1. Prioritizes segment 0 with highest priority (100) for instant startup.
 * 2. Sliding window pre-fetches next [t+1, t+2, t+3] segments in background.
 * 3. Immediately shifts priority upon scrub/seek, cancelling or deprioritizing stale segments.
 * 4. Evicts passed segments to stay within mobile RAM limits.
 */
export class SlidingWindowFetcher {
  private readonly windowSize: number;
  private readonly keepBehindCount: number;
  private readonly peerCandidates: readonly string[];

  private currentPlayingIndex = 0;
  private readonly bufferedSegments = new Map<number, Uint8Array>();
  private readonly inFlightRequests = new Map<number, Promise<Uint8Array>>();

  constructor(
    public readonly segments: readonly HlsVideoSegment[],
    public readonly bitswap: BitSwapEngine,
    config: SlidingWindowConfig = {},
  ) {
    this.windowSize = config.windowSize ?? 3;
    this.keepBehindCount = config.keepBehindCount ?? 2;
    this.peerCandidates = config.peerCandidates ?? [];
  }

  public get currentIndex(): number {
    return this.currentPlayingIndex;
  }

  public getBufferedCount(): number {
    return this.bufferedSegments.size;
  }

  public isBuffered(index: number): boolean {
    return this.bufferedSegments.has(index);
  }

  /**
   * Initializes playback by fetching Segment 0 with maximum priority (100)
   * and initiating background pre-fetches for [1..windowSize].
   */
  public async startPlayback(): Promise<Uint8Array> {
    if (this.segments.length === 0) {
      throw new Error('No segments available in playlist');
    }

    this.currentPlayingIndex = 0;
    const seg0 = await this.fetchSegment(0, 100);

    // Trigger sliding window pre-fetching in background
    this.triggerWindowPrefetch(1);

    return seg0;
  }

  /**
   * Retrieves segment at index. If pre-buffered, returns immediately.
   * Advances the playback head and shifts the sliding pre-fetch window forward.
   */
  public async getSegment(index: number): Promise<Uint8Array> {
    this.currentPlayingIndex = index;

    let data = this.bufferedSegments.get(index);
    if (!data) {
      data = await this.fetchSegment(index, 90);
    }

    // Shift window forward and evict past segments
    this.triggerWindowPrefetch(index + 1);
    this.evictPassedSegments();

    return data;
  }

  /**
   * Seeks/Scrubs immediately to target segment.
   * Reprioritizes window to [targetIndex, targetIndex + windowSize].
   */
  public async seekToSegment(targetIndex: number): Promise<Uint8Array> {
    if (targetIndex < 0 || targetIndex >= this.segments.length) {
      throw new Error(`Seek target index ${targetIndex} out of bounds (0-${this.segments.length - 1})`);
    }

    this.currentPlayingIndex = targetIndex;

    const data = await this.fetchSegment(targetIndex, 100);

    // Evict old buffers outside new window
    this.evictPassedSegments();
    // Trigger forward prefetch from new seek location
    this.triggerWindowPrefetch(targetIndex + 1);

    return data;
  }

  private async fetchSegment(index: number, priority: number): Promise<Uint8Array> {
    const existing = this.bufferedSegments.get(index);
    if (existing) {
      return existing;
    }

    const inFlight = this.inFlightRequests.get(index);
    if (inFlight) {
      return inFlight;
    }

    const segment = this.segments[index];
    if (!segment) {
      throw new Error(`Segment at index ${index} does not exist`);
    }

    const requestPromise = (async () => {
      try {
        const data = await this.bitswap.requestBlock(
          CID.parse(segment.cid),
          this.peerCandidates.length > 0 ? this.peerCandidates : undefined,
          { priority },
        );
        this.bufferedSegments.set(index, data);
        return data;
      } finally {
        this.inFlightRequests.delete(index);
      }
    })();

    this.inFlightRequests.set(index, requestPromise);
    return requestPromise;
  }

  private triggerWindowPrefetch(startIndex: number): void {
    const endIndex = Math.min(startIndex + this.windowSize, this.segments.length);
    for (let i = startIndex; i < endIndex; i++) {
      if (!this.bufferedSegments.has(i) && !this.inFlightRequests.has(i)) {
        // Decreasing priority as distance increases
        const priority = Math.max(50, 90 - (i - startIndex) * 10);
        this.fetchSegment(i, priority).catch(() => {
          // Prefetch failures are non-fatal, will retry on actual playback demand
        });
      }
    }
  }

  /**
   * Evicts passed segments behind playback cursor to avoid mobile memory leaks.
   */
  public evictPassedSegments(): void {
    const minKeepIndex = this.currentPlayingIndex - this.keepBehindCount;
    for (const index of this.bufferedSegments.keys()) {
      if (index < minKeepIndex) {
        this.bufferedSegments.delete(index);
      }
    }
  }

  public getBufferStatus(): {
    bufferedCount: number;
    bufferedIndices: number[];
    currentPlayingIndex: number;
  } {
    return {
      bufferedCount: this.bufferedSegments.size,
      bufferedIndices: Array.from(this.bufferedSegments.keys()).sort((a, b) => a - b),
      currentPlayingIndex: this.currentPlayingIndex,
    };
  }
}

/**
 * Adaptive Bitrate (ABR) Dynamic Switching Engine.
 * Implements Sub-300ms Video Streaming Gap 4:
 * 1. Computes live download bandwidth over P2P BitSwap swarms.
 * 2. Dynamically switches between 360p, 480p, 720p, 1080p without buffering stutter.
 */
export class AdaptiveBitrateEngine {
  public static calculateMeasuredBandwidthBps(
    bytes: number,
    durationMs: number,
    safetyMultiplier = 0.75,
  ): number {
    if (durationMs <= 0) return 5_000_000;
    const durationSeconds = durationMs / 1000;
    const rawBps = (bytes * 8) / durationSeconds;
    return Math.floor(rawBps * safetyMultiplier);
  }

  public static selectBestResolution(measuredBandwidthBps: number): VideoResolution {
    if (measuredBandwidthBps >= 4_000_000) return '1080p';
    if (measuredBandwidthBps >= 2_200_000) return '720p';
    if (measuredBandwidthBps >= 1_000_000) return '480p';
    return '360p';
  }
}

/**
 * High-Speed Edge Pre-Warm RAM Cache.
 * Holds Segment 0 in RAM on edge relay nodes for instant sub-100ms video playback.
 */
export class EdgePreWarmCache {
  private readonly cache = new Map<string, Uint8Array>();

  constructor(private readonly maxEntries = 200) {}

  public preWarm(manifestCid: string, segment0Data: Uint8Array): void {
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(manifestCid, segment0Data);
  }

  public getSegment0(manifestCid: string): Uint8Array | undefined {
    return this.cache.get(manifestCid);
  }

  public has(manifestCid: string): boolean {
    return this.cache.has(manifestCid);
  }

  public size(): number {
    return this.cache.size;
  }
}

export interface BufferHealthDecision {
  readonly recommendedResolution: VideoResolution;
  readonly shouldFallbackToEdgeSeeder: boolean;
  readonly reason: string;
}

/**
 * Pillar 4: Buffer Health Controller.
 * - If playback buffer < 2.0s: Instant downgrade to 360p + fallback to direct edge seeder.
 * - If playback buffer > 8.0s: Upgrade to 1080p + full switch to pure P2P swarm BitSwap.
 */
export class DynamicBufferHealthController {
  public static evaluateBuffer(
    bufferLengthSeconds: number,
    currentResolution: VideoResolution = '720p',
  ): BufferHealthDecision {
    if (bufferLengthSeconds < 2.0) {
      return {
        recommendedResolution: '360p',
        shouldFallbackToEdgeSeeder: true,
        reason: 'Critical buffer freeze risk: downgraded to 360p with direct edge seeder pull',
      };
    }
    if (bufferLengthSeconds > 8.0) {
      return {
        recommendedResolution: '1080p',
        shouldFallbackToEdgeSeeder: false,
        reason: 'Healthy buffer: upgraded to 1080p on sustained P2P swarm',
      };
    }
    return {
      recommendedResolution: currentResolution,
      shouldFallbackToEdgeSeeder: false,
      reason: 'Stable playback buffer',
    };
  }
}

/**
 * Pillar 4: Speculative Pre-Warm Predictive Caching.
 * Speculatively pulls Segment 0 of upcoming items (post i+1 and i+2) into memory buffer.
 */
export class SpeculativePreWarmCache {
  public static getTargetSegment0PrefetchCids(
    currentIndex: number,
    feedItems: readonly { index: number; segment0Cid: string }[],
    forwardWindow = 2,
  ): string[] {
    const targets = feedItems.filter(
      item => item.index > currentIndex && item.index <= currentIndex + forwardWindow,
    );
    return targets.map(t => t.segment0Cid);
  }
}

export interface VideoSegmentFetchPlan {
  readonly segmentIndex: number;
  readonly transport: 'edge_direct_pull' | 'p2p_swarm_bitswap';
  readonly targetLatencyMs: number;
  readonly isSegment0: boolean;
}

/**
 * Pillar 4: Hybrid Swarm-Mesh Video Pipeline.
 * - First 1-second segment (Segment 0): Direct high-availability edge relay pull (sub-80ms).
 * - Subsequent segments (1, 2, 3...): Assembled over background peer-to-peer BitSwap swarm.
 */
export class HybridSwarmVideoPipeline {
  public static resolveSegmentRoute(segmentIndex: number): VideoSegmentFetchPlan {
    const isSegment0 = segmentIndex === 0;
    return {
      segmentIndex,
      transport: isSegment0 ? 'edge_direct_pull' : 'p2p_swarm_bitswap',
      targetLatencyMs: isSegment0 ? 80 : 250,
      isSegment0,
    };
  }
}

export interface AbrDecision {
  readonly selectedResolution: VideoResolution;
  readonly bufferHealthSeconds: number;
  readonly estimatedThroughputBps: number;
  readonly isDowngraded: boolean;
  readonly isUpgraded: boolean;
  readonly switchReason: string;
}

/**
 * HlsAbrEngine:
 * Dynamically switches video resolution based on real-time network throughput and buffer health B(t).
 */
export class HlsAbrEngine {
  private currentResolution: VideoResolution = '720p';

  public evaluate(
    bufferLengthSeconds: number,
    estimatedThroughputBps: number,
    currentResolution: VideoResolution = this.currentResolution,
  ): AbrDecision {
    let selected: VideoResolution = currentResolution;
    let switchReason = 'Buffer stable';
    let isDowngraded = false;
    let isUpgraded = false;

    // B(t) < 2.0s: Critical buffer exhaustion -> instant emergency fallback to 360p
    if (bufferLengthSeconds < 2.0) {
      selected = '360p';
      switchReason = 'Buffer critical (< 2.0s): emergency fallback to 360p';
      isDowngraded = true;
    } else if (bufferLengthSeconds < 4.0 || estimatedThroughputBps < 1_500_000) {
      selected = '480p';
      switchReason = 'Buffer recovering (< 4.0s): stable 480p';
      isDowngraded = currentResolution === '720p' || currentResolution === '1080p';
    } else if (bufferLengthSeconds > 8.0 && estimatedThroughputBps > 8_000_000) {
      selected = '1080p';
      switchReason = 'High buffer health (> 8.0s) & throughput: optimal 1080p60';
      isUpgraded = currentResolution !== '1080p';
    } else {
      selected = '720p';
      switchReason = 'Standard HD 720p stream';
    }

    this.currentResolution = selected;
    return {
      selectedResolution: selected,
      bufferHealthSeconds: bufferLengthSeconds,
      estimatedThroughputBps,
      isDowngraded,
      isUpgraded,
      switchReason,
    };
  }
}
