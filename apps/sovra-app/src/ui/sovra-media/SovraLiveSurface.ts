/**
 * @file apps/sovra-app/src/ui/sovra-media/SovraLiveSurface.ts
 * Real Live session state machine and moderation logic
 */

import { LiveSessionStatus } from './types.js';

export class SovraLiveSurface {
  /**
   * Strictly validates state machine transitions.
   * SCHEDULED -> STARTING -> LIVE -> ENDING -> ENDED -> REPLAY
   */
  public static isValidTransition(current: LiveSessionStatus, target: LiveSessionStatus): boolean {
    if (current === target) return true;
    const allowed: Record<LiveSessionStatus, readonly LiveSessionStatus[]> = {
      SCHEDULED: ['STARTING', 'LIVE', 'ENDED'],
      STARTING: ['LIVE', 'ENDED'],
      LIVE: ['ENDING', 'ENDED'],
      ENDING: ['ENDED', 'REPLAY'],
      ENDED: ['REPLAY', 'SCHEDULED'],
      REPLAY: ['ENDED'],
    };
    return (allowed[current] ?? []).includes(target);
  }

  /**
   * Returns display styling and badges for live session status.
   */
  public static getStatusBadge(status: LiveSessionStatus): { text: string; bg: string; color: string; isLive: boolean } {
    switch (status) {
      case 'LIVE':
        return { text: '● LIVE', bg: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', isLive: true };
      case 'STARTING':
        return { text: 'STARTING...', bg: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', isLive: false };
      case 'SCHEDULED':
        return { text: 'SCHEDULED', bg: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', isLive: false };
      case 'ENDING':
        return { text: 'ENDING', bg: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', isLive: false };
      case 'ENDED':
        return { text: 'ENDED', bg: 'rgba(100, 116, 139, 0.2)', color: '#94a3b8', isLive: false };
      case 'REPLAY':
        return { text: 'REPLAY', bg: 'rgba(16, 185, 129, 0.2)', color: '#34d399', isLive: false };
      default:
        return { text: status, bg: 'rgba(100, 116, 139, 0.2)', color: '#94a3b8', isLive: false };
    }
  }

  /**
   * Checks whether the user has host or moderator authority.
   */
  public static canModerate(userDid: string, creatorDid: string, userRole?: string): boolean {
    if (!userDid) return false;
    if (userDid === creatorDid || userDid === 'did:sovra:system') return true;
    if (userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'MODERATOR' || userRole === 'SUPER_ADMIN') {
      return true;
    }
    return false;
  }
}
