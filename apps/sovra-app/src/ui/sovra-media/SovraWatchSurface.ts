/**
 * @file apps/sovra-app/src/ui/sovra-media/SovraWatchSurface.ts
 * Spatial Watch Surface helper methods and view logic
 */

import { WatchVideoItem, WatchCategory } from './types.js';

export interface WatchCategoryOption {
  key: WatchCategory;
  label: string;
  icon: string;
}

export class SovraWatchSurface {
  public static readonly CATEGORIES: readonly WatchCategoryOption[] = [
    { key: 'all', label: 'All', icon: '🌐' },
    { key: 'tech', label: 'Tech & Architecture', icon: '⚡' },
    { key: 'gaming', label: 'Gaming & Interactive', icon: '🎮' },
    { key: 'decentralized', label: 'Decentralized', icon: '🔗' },
    { key: 'live', label: 'Live Streams', icon: '🔴' },
  ];

  /**
   * Filters video catalog by category and search query.
   */
  public static filterVideos(videos: WatchVideoItem[], category: WatchCategory, query: string = ''): WatchVideoItem[] {
    let result = videos;
    if (category && category !== 'all') {
      if (category === 'live') {
        result = result.filter(v => (v.category === 'live' || (v.tags && v.tags.some(t => t.toLowerCase().includes('live')))));
      } else {
        result = result.filter(v => v.category === category || (v.tags && v.tags.some(t => t.toLowerCase().includes(category))));
      }
    }
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(v =>
        v.title.toLowerCase().includes(q) ||
        v.channelName.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        (v.tags && v.tags.some(t => t.toLowerCase().includes(q)))
      );
    }
    return result;
  }

  /**
   * Formats duration in seconds to standard MM:SS or HH:MM:SS format.
   */
  public static formatDuration(seconds: number): string {
    if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const secsStr = secs < 10 ? `0${secs}` : `${secs}`;
    if (hrs > 0) {
      const minsStr = mins < 10 ? `0${mins}` : `${mins}`;
      return `${hrs}:${minsStr}:${secsStr}`;
    }
    return `${mins}:${secsStr}`;
  }

  /**
   * Formats view count into human-readable compact notation (e.g. 1.2M, 45K).
   */
  public static formatViews(views: number): string {
    if (!views || views <= 0) return '0 views';
    if (views >= 1_000_000) {
      return `${(views / 1_000_000).toFixed(1)}M views`;
    }
    if (views >= 1_000) {
      return `${(views / 1_000).toFixed(1)}K views`;
    }
    return `${views} views`;
  }
}
