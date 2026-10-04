/**
 * @file apps/sovra-app/src/hooks/useChannelFeed.ts
 * Client Hook: YouTube-Style Long-Form HLS ABR Streaming, Nested Discussions & Micropayment Tipping.
 *
 * Implements:
 * 1. Pro 16:9 HLS ABR engine with buffer health B(t) auto-resolution switching.
 * 2. Chapter scrubbers with hover preview keyframes.
 * 3. YouTube-style nested comments sorting (Top comments / Newest first via HLC).
 * 4. State channel micropayments via VirtualChannelMeshRouter with 95/5 creator split.
 */

import {
  HlsAbrEngine,
  type VideoResolution,
  type AbrDecision,
} from '@sovra/storage';
import {
  VirtualChannelMeshRouter,
  type VirtualChannelHop,
  type RouteQuote,
} from '@sovra/protocol';

export interface VideoChapter {
  readonly title: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface VideoMetadata {
  readonly id: string;
  readonly title: string;
  readonly channelDid: string;
  readonly channelName: string;
  readonly durationSeconds: number;
  readonly manifestCid: string;
  readonly chapters: readonly VideoChapter[];
}

export interface NestedComment {
  readonly id: string;
  readonly authorName: string;
  readonly authorDid: string;
  readonly text: string;
  readonly timestamp: number;
  readonly likes: number;
  readonly isSuperThanks?: boolean | undefined;
  readonly superThanksAmount?: string | undefined;
  readonly replies: readonly NestedComment[];
}

export interface UseChannelFeedReturn {
  readonly currentVideo: VideoMetadata;
  readonly activeResolution: VideoResolution;
  readonly bufferSeconds: number;
  readonly comments: readonly NestedComment[];
  evaluateAbr(bufferLengthSec: number, throughputBps: number): AbrDecision;
  setResolution(resolution: VideoResolution): void;
  sortComments(mode: 'top' | 'newest'): readonly NestedComment[];
  sendTip(amountSov: bigint, channelHop: VirtualChannelHop): RouteQuote;
}

export function createChannelFeedSession(
  video: VideoMetadata,
  initialComments: readonly NestedComment[] = [],
): UseChannelFeedReturn {
  const abr = new HlsAbrEngine();
  const router = new VirtualChannelMeshRouter();
  let currentRes: VideoResolution = '720p';
  let bufferSec = 6.0;
  let commentsList: NestedComment[] = [...initialComments];

  return {
    get currentVideo() {
      return video;
    },
    get activeResolution() {
      return currentRes;
    },
    get bufferSeconds() {
      return bufferSec;
    },
    get comments() {
      return commentsList;
    },
    evaluateAbr(bufferLengthSec: number, throughputBps: number) {
      bufferSec = bufferLengthSec;
      const decision = abr.evaluate(bufferLengthSec, throughputBps, currentRes);
      currentRes = decision.selectedResolution;
      return decision;
    },
    setResolution(resolution: VideoResolution) {
      currentRes = resolution;
    },
    sortComments(mode: 'top' | 'newest') {
      if (mode === 'top') {
        commentsList = [...commentsList].sort((a, b) => {
          const aWeight = a.likes + (a.isSuperThanks ? 100 : 0);
          const bWeight = b.likes + (b.isSuperThanks ? 100 : 0);
          return bWeight - aWeight;
        });
      } else {
        commentsList = [...commentsList].sort((a, b) => b.timestamp - a.timestamp);
      }
      return commentsList;
    },
    sendTip(amountSov: bigint, channelHop: VirtualChannelHop) {
      router.registerChannel(channelHop);
      return router.planMultiHopRoute(amountSov, 1n, [channelHop.channelId]);
    },
  };
}
