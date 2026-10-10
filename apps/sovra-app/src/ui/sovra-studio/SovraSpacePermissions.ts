/**
 * @file apps/sovra-app/src/ui/sovra-studio/SovraSpacePermissions.ts
 * Unified Space Permission Engine & RBAC Matrix
 */

import { SpaceRole, SpaceAction } from './types.js';

export class SovraSpacePermissions {
  /**
   * Evaluates whether a role possesses permission for a given space action.
   */
  public static hasPermission(role: SpaceRole | null, action: SpaceAction): boolean {
    if (!role) return false;

    switch (action) {
      case 'VIEW':
        return true;

      case 'TRANSFER_OWNERSHIP':
        return role === 'OWNER';

      case 'MANAGE_SETTINGS':
      case 'MANAGE_TEAM':
        return role === 'OWNER' || role === 'ADMIN';

      case 'MANAGE_MEMBERS':
      case 'MANAGE_MODERATION':
      case 'MANAGE_COMMENTS':
        return role === 'OWNER' || role === 'ADMIN' || role === 'MODERATOR';

      case 'CREATE_CONTENT':
      case 'EDIT_CONTENT':
      case 'DELETE_CONTENT':
        return role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR';

      case 'VIEW_ANALYTICS':
        return role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR' || role === 'MODERATOR';

      default:
        return false;
    }
  }

  /**
   * Checks whether a role can perform management operations.
   */
  public static canManage(role: SpaceRole | null): boolean {
    return role === 'OWNER' || role === 'ADMIN';
  }

  /**
   * Enforces role hierarchy rules to prevent privilege escalation.
   */
  public static canAssignRole(assignerRole: SpaceRole, targetRole: SpaceRole): boolean {
    if (assignerRole === 'OWNER') return true;
    if (assignerRole === 'ADMIN') {
      // Admins cannot appoint other Admins or Owners
      return targetRole === 'EDITOR' || targetRole === 'MODERATOR' || targetRole === 'MEMBER';
    }
    return false;
  }
}
