/**
 * @file apps/sovra-app/src/ui/sovra-media/SovraPlaylistSurface.ts
 * Playlist surface controller and ordering engine
 */

import { WatchVideoItem } from './types.js';

export class SovraPlaylistSurface {
  /**
   * Reorders an array of video IDs by moving an item from sourceIndex to targetIndex.
   */
  public static reorderVideoIds(videoIds: string[], sourceIndex: number, targetIndex: number): string[] {
    if (sourceIndex < 0 || sourceIndex >= videoIds.length || targetIndex < 0 || targetIndex >= videoIds.length) {
      return [...videoIds];
    }
    const result = [...videoIds];
    const [moved] = result.splice(sourceIndex, 1);
    if (moved !== undefined) {
      result.splice(targetIndex, 0, moved);
    }
    return result;
  }

  /**
   * Calculates total duration of playlist videos in seconds.
   */
  public static calculateTotalDuration(videos: WatchVideoItem[]): number {
    return videos.reduce((acc, v) => acc + (v.durationSeconds || 0), 0);
  }

  /**
   * Validates playlist input data.
   */
  public static validatePlaylistInput(title: string): { ok: boolean; error?: string } {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      return { ok: false, error: 'Playlist title is required' };
    }
    if (cleanTitle.length > 100) {
      return { ok: false, error: 'Playlist title cannot exceed 100 characters' };
    }
    return { ok: true };
  }
}
