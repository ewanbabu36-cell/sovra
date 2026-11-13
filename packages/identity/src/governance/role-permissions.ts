/**
 * @file packages/identity/src/governance/role-permissions.ts
 * SOVRA Role Permission Registry & Anti-Founder-Unilateralism Enforcement.
 *
 * Enforces:
 * 1. Least-privilege capability mapping across all administrative and community roles.
 * 2. Hardcoded barriers preventing any founder, administrator, or node operator from
 *    unilaterally minting coins, burning balances, draining treasuries, or intercepting E2EE messages.
 */

import { ValidationError } from '@sovra/shared';
import { AdminRole } from '../principal.js';

export type GovernanceCapability =
  | 'proposal:submit'
  | 'proposal:vote'
  | 'treasury:propose'
  | 'treasury:execute_multisig'
  | 'protocol:propose_upgrade'
  | 'validator:slashing_adjust'
  | 'security:emergency_pause'
  | 'security:panic_wipe'
  | 'admin:moderate_content'
  | 'admin:view_telemetry';

export type ProhibitedUnilateralAction =
  | 'UNILATERAL_COIN_MINT'
  | 'UNILATERAL_TOKEN_BURN'
  | 'UNILATERAL_TREASURY_WITHDRAW'
  | 'UNILATERAL_GOVERNANCE_OVERRIDE'
  | 'UNILATERAL_LEDGER_EDIT'
  | 'DECRYPT_E2EE_USER_MESSAGES'
  | 'ACCESS_USER_PRIVATE_KEYS';

export class RolePermissionRegistry {
  private static readonly PROHIBITED_UNILATERAL_ACTIONS: ReadonlySet<string> = new Set([
    'UNILATERAL_COIN_MINT',
    'UNILATERAL_TOKEN_BURN',
    'UNILATERAL_TREASURY_WITHDRAW',
    'UNILATERAL_GOVERNANCE_OVERRIDE',
    'UNILATERAL_LEDGER_EDIT',
    'DECRYPT_E2EE_USER_MESSAGES',
    'ACCESS_USER_PRIVATE_KEYS',
  ]);

  /**
   * Evaluates if a role has permission to initiate a routine governance or operational action.
   */
  public static hasGovernanceCapability(role: AdminRole, capability: GovernanceCapability): boolean {
    switch (role) {
      case 'SUPER_ADMIN':
        return [
          'proposal:submit',
          'proposal:vote',
          'treasury:propose',
          'treasury:execute_multisig',
          'protocol:propose_upgrade',
          'security:emergency_pause',
          'admin:moderate_content',
          'admin:view_telemetry',
        ].includes(capability);

      case 'SECURITY_ADMIN':
        return [
          'proposal:submit',
          'security:emergency_pause',
          'security:panic_wipe',
          'admin:view_telemetry',
        ].includes(capability);

      case 'MODERATOR':
        return ['admin:moderate_content', 'proposal:vote'].includes(capability);

      case 'INFRA_OPERATOR':
        return ['admin:view_telemetry'].includes(capability);

      case 'USER':
      default:
        return ['proposal:submit', 'proposal:vote', 'treasury:propose'].includes(capability);
    }
  }

  /**
   * Non-negotiable constitutional enforcement gate:
   * Rejects any attempt by ANY actor (including the founder) to execute a prohibited unilateral action.
   */
  public static assertNonFounderUnilateral(actionName: string, actorDid: string): void {
    if (this.PROHIBITED_UNILATERAL_ACTIONS.has(actionName)) {
      throw new ValidationError(
        `CRITICAL CONSTITUTIONAL VIOLATION: Unilateral action "${actionName}" attempted by ${actorDid} is strictly prohibited by SOVRA Constitution (Invariants 1, 2, 3, 4 & 6). Zero god-mode permitted.`,
        { actionName, actorDid },
      );
    }
  }

  /**
   * Returns true if an action is among the prohibited unilateral actions.
   */
  public static isProhibitedUnilateralAction(actionName: string): boolean {
    return this.PROHIBITED_UNILATERAL_ACTIONS.has(actionName);
  }
}
