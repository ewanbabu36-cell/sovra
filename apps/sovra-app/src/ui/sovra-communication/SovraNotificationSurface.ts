/**
 * @file apps/sovra-app/src/ui/sovra-communication/SovraNotificationSurface.ts
 * Spatial Notifications Surface Utilities & Deep-Link Resolution
 */

import { SpatialNotification } from './types.js';

export class SovraNotificationSurface {
  /**
   * Filters notification list by tab category.
   */
  public static filterNotifications(notifications: SpatialNotification[], filter: 'all' | 'chats' | 'network'): SpatialNotification[] {
    if (filter === 'chats') {
      return notifications.filter(n => n.type === 'message');
    }
    if (filter === 'network') {
      return notifications.filter(n => n.type !== 'message');
    }
    return notifications;
  }

  /**
   * Returns category icon and label for notification item.
   */
  public static getCategoryIcon(type: string): { icon: string; label: string } {
    switch (type) {
      case 'message':
        return { icon: '💬', label: 'Message' };
      case 'friend_request':
        return { icon: '👥', label: 'Peer Connection' };
      case 'like':
      case 'reaction':
        return { icon: '❤️', label: 'Attestation' };
      case 'comment':
        return { icon: '💭', label: 'Comment' };
      case 'channel':
        return { icon: '📢', label: 'Channel Dispatch' };
      case 'page':
        return { icon: '🏢', label: 'Page Update' };
      case 'group':
        return { icon: '👥', label: 'Group Activity' };
      default:
        return { icon: '⚡', label: 'Mesh Alert' };
    }
  }
}
