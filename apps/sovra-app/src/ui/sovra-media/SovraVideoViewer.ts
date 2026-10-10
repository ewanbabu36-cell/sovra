/**
 * @file apps/sovra-app/src/ui/sovra-media/SovraVideoViewer.ts
 * Production-grade Video Viewer controller helpers
 */

export class SovraVideoViewer {
  public static readonly PLAYBACK_SPEEDS: readonly number[] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  /**
   * Cycles to the next available playback rate.
   */
  public static getNextPlaybackSpeed(currentSpeed: number): number {
    const idx = this.PLAYBACK_SPEEDS.indexOf(currentSpeed);
    if (idx === -1 || idx === this.PLAYBACK_SPEEDS.length - 1) {
      return this.PLAYBACK_SPEEDS[0] ?? 1.0;
    }
    return this.PLAYBACK_SPEEDS[idx + 1] ?? 1.0;
  }

  /**
   * Clamps volume level safely between 0.0 and 1.0.
   */
  public static clampVolume(volume: number): number {
    if (isNaN(volume)) return 1.0;
    return Math.max(0, Math.min(1, volume));
  }

  /**
   * Formats current playback time and total duration into standard display (e.g. 02:45 / 14:20).
   */
  public static formatPlaybackProgress(currentSec: number, totalSec: number): string {
    const cur = this.formatTime(currentSec);
    const tot = this.formatTime(totalSec);
    return `${cur} / ${tot}`;
  }

  public static formatTime(seconds: number): string {
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
   * Calculates target seek time clamped to video bounds.
   */
  public static clampSeekTime(targetSec: number, durationSec: number): number {
    if (isNaN(targetSec) || targetSec <= 0) return 0;
    if (isNaN(durationSec) || durationSec <= 0) return targetSec;
    return Math.max(0, Math.min(durationSec, targetSec));
  }
}
