/**
 * @file packages/identity/src/governance/ext-consensus.ts
 * Isolated Experimental Governance Extension Namespace (`SOVRA-EXT-CONSENSUS`).
 *
 * Per IA-01 Sections 1 & 11, token-weighted voting, hardcoded Genesis Security Council
 * bindings, and legacy single-founder milestone records are isolated here as optional
 * extension components outside mandatory token-free `CommunityGovernanceEngine` core paths.
 */

export {
  GENESIS_SECURITY_COUNCIL,
  MultiPartyApprovalEngine,
  type MultiPartyActionType,
  type MultiPartyActionProposal,
  type TrustedSignerRecord,
  type GovernanceSignerRegistry,
  type GenesisCouncilMember,
} from './multi-party-approval.js';

export {
  FounderIdentityRegistry,
  type FounderMilestone,
  type FounderRevealStatus,
  type FounderIdentityRecord,
  type PublicFounderProfile,
} from './founder-identity.js';

export {
  GOVERNANCE_TOKEN_EXTENSION_ID,
  GovernanceVotingEngine,
  type VoterProfile,
  type VoterEligibilityRecord,
  type CastVoteRecord,
  type GovernanceTallyReport,
} from './voting-engine.js';
