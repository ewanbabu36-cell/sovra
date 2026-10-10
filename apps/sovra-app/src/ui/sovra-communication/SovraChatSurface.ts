/**
 * @file apps/sovra-app/src/ui/sovra-communication/SovraChatSurface.ts
 * Spatial Chat Surface logic and helpers
 */

import { ChatContact } from './types.js';

export class SovraChatSurface {
  /**
   * Formats relative timestamp for chat previews and message bubbles.
   */
  public static formatChatTime(timestamp: number): string {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    const d = new Date(timestamp);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /**
   * Filters contact list by search query.
   */
  public static filterContacts(contacts: ChatContact[], query: string): ChatContact[] {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.handle.toLowerCase().includes(q) ||
      (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
    );
  }

  /**
   * Returns display indicator for message delivery status.
   */
  public static getDeliveryTick(status: string | null | undefined): { icon: string; color: string } {
    switch (status) {
      case 'read':
        return { icon: '✓✓', color: '#38bdf8' };
      case 'delivered':
        return { icon: '✓✓', color: '#94a3b8' };
      case 'sent':
        return { icon: '✓', color: '#94a3b8' };
      case 'sending':
        return { icon: '🕒', color: '#64748b' };
      case 'failed':
        return { icon: '⚠️', color: '#ef4444' };
      default:
        return { icon: '', color: '' };
    }
  }
}
