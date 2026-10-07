import { Result, ok, err } from '@sovra/shared';
import { SovraEvent, EventKind, CommunityGovernancePayload } from '@sovra/protocol';

export type GovernanceModel =
  | 'open'
  | 'invite_only'
  | 'moderated'
  | 'multi_admin'
  | 'community_governed';

export type CommunityRole = 'creator' | 'admin' | 'moderator' | 'member';

export interface CommunityRecord {
  readonly id: string;
  readonly creatorDid: string;
  readonly name: string;
  readonly model: GovernanceModel;
  readonly createdAt: number;
  readonly roles: Map<string, CommunityRole>; // key = did
}

export interface GovernanceProposal {
  readonly id: string;
  readonly communityId: string;
  readonly proposerDid: string;
  readonly title: string;
  readonly description: string;
  readonly options: readonly string[];
  readonly quorumCount: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly votes: Map<string, string>; // voterDid -> option
}

export interface ProposalTallyResult {
  readonly proposalId: string;
  readonly isClosed: boolean;
  readonly quorumReached: boolean;
  readonly totalVotes: number;
  readonly voteCounts: Record<string, number>;
  readonly winningOption?: string | undefined;
  readonly status: 'PASSED' | 'REJECTED' | 'NO_QUORUM' | 'ACTIVE';
}

export class CommunityGovernanceEngine {
  private readonly communities = new Map<string, CommunityRecord>();
  private readonly proposals = new Map<string, GovernanceProposal>();

  /**
   * Creates a community with specified governance model.
   */
  public createCommunity(
    id: string,
    creatorDid: string,
    name: string,
    model: GovernanceModel = 'open',
    createdAt = Date.now(),
  ): Result<CommunityRecord> {
    if (this.communities.has(id)) {
      return err(new Error(`Community ${id} already exists`));
    }

    const roles = new Map<string, CommunityRole>();
    roles.set(creatorDid, 'creator');

    const community: CommunityRecord = {
      id,
      creatorDid,
      name,
      model,
      createdAt,
      roles,
    };

    this.communities.set(id, community);
    return ok(community);
  }

  public getCommunity(id: string): CommunityRecord | undefined {
    return this.communities.get(id);
  }

  public joinCommunity(id: string, userDid: string): Result<void> {
    const community = this.communities.get(id);
    if (!community) {
      return err(new Error(`Community ${id} not found`));
    }

    if (community.model === 'invite_only') {
      return err(new Error(`Community ${id} is invite-only; direct joins not permitted`));
    }

    if (!community.roles.has(userDid)) {
      community.roles.set(userDid, 'member');
    }
    return ok(undefined);
  }

  public assignRole(
    communityId: string,
    actorDid: string,
    targetDid: string,
    newRole: CommunityRole,
  ): Result<void> {
    const community = this.communities.get(communityId);
    if (!community) return err(new Error(`Community ${communityId} not found`));

    const actorRole = community.roles.get(actorDid);
    if (community.model === 'community_governed') {
      return err(new Error('In community_governed mode, roles can only be granted via passed proposals'));
    }

    // Role hierarchy verification:
    // Creator can assign admin, moderator, member
    // Admin can assign moderator, member
    if (actorRole === 'creator') {
      community.roles.set(targetDid, newRole);
      return ok(undefined);
    }

    if (actorRole === 'admin') {
      if (newRole === 'creator' || newRole === 'admin') {
        return err(new Error('Admins cannot grant creator or admin roles'));
      }
      community.roles.set(targetDid, newRole);
      return ok(undefined);
    }

    return err(new Error(`Actor ${actorDid} has insufficient privileges to assign roles`));
  }

  public getRole(communityId: string, userDid: string): CommunityRole | undefined {
    return this.communities.get(communityId)?.roles.get(userDid);
  }

  public isMember(communityId: string, userDid: string): boolean {
    return this.communities.get(communityId)?.roles.has(userDid) ?? false;
  }

  /**
   * Submits a governance proposal.
   */
  public createProposal(
    communityId: string,
    proposerDid: string,
    title: string,
    description: string,
    options: readonly string[] = ['yes', 'no'],
    quorumCount = 3,
    durationSeconds = 86400,
    createdAt = Date.now(),
  ): Result<GovernanceProposal> {
    const community = this.communities.get(communityId);
    if (!community) return err(new Error(`Community ${communityId} not found`));

    if (!community.roles.has(proposerDid)) {
      return err(new Error('Only community members can submit proposals'));
    }

    const proposalId = `prop_${communityId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const proposal: GovernanceProposal = {
      id: proposalId,
      communityId,
      proposerDid,
      title,
      description,
      options,
      quorumCount,
      createdAt,
      expiresAt: createdAt + durationSeconds * 1000,
      votes: new Map(),
    };

    this.proposals.set(proposalId, proposal);
    return ok(proposal);
  }

  /**
   * Casts a signed vote on a governance proposal.
   */
  public castVote(
    proposalId: string,
    voterDid: string,
    option: string,
    currentTime = Date.now(),
  ): Result<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return err(new Error(`Proposal ${proposalId} not found`));

    if (currentTime > proposal.expiresAt) {
      return err(new Error('Voting period has expired for this proposal'));
    }

    const community = this.communities.get(proposal.communityId);
    if (!community || !community.roles.has(voterDid)) {
      return err(new Error('Only verified community members may cast votes'));
    }

    if (!proposal.options.includes(option)) {
      return err(new Error(`Option '${option}' is not a valid choice for proposal ${proposalId}`));
    }

    // Record or update vote (1 vote per DID)
    proposal.votes.set(voterDid, option);
    return ok(undefined);
  }

  /**
   * Deterministically tallies a proposal.
   */
  public tallyProposal(proposalId: string, currentTime = Date.now()): Result<ProposalTallyResult> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return err(new Error(`Proposal ${proposalId} not found`));

    const isClosed = currentTime >= proposal.expiresAt;
    const voteCounts: Record<string, number> = {};
    for (const opt of proposal.options) {
      voteCounts[opt] = 0;
    }

    for (const option of proposal.votes.values()) {
      if (option in voteCounts) {
        voteCounts[option] = (voteCounts[option] ?? 0) + 1;
      }
    }

    const totalVotes = proposal.votes.size;
    const quorumReached = totalVotes >= proposal.quorumCount;

    let winningOption: string | undefined;
    let highestVotes = -1;
    for (const [opt, count] of Object.entries(voteCounts)) {
      if (count > highestVotes) {
        highestVotes = count;
        winningOption = opt;
      }
    }

    let status: ProposalTallyResult['status'] = 'ACTIVE';
    if (isClosed) {
      if (!quorumReached) {
        status = 'NO_QUORUM';
      } else if (winningOption === 'yes') {
        status = 'PASSED';
      } else {
        status = 'REJECTED';
      }
    }

    return ok({
      proposalId,
      isClosed,
      quorumReached,
      totalVotes,
      voteCounts,
      winningOption,
      status,
    });
  }

  /**
   * Ingests a protocol CommunityGovernance event.
   */
  public processGovernanceEvent(event: SovraEvent): Result<void> {
    if (event.kind !== EventKind.CommunityGovernance) {
      return ok(undefined);
    }

    try {
      const payload: CommunityGovernancePayload =
        typeof event.content === 'string' ? JSON.parse(event.content) : event.content;

      const actorDid = `did:key:${event.pubkey}`;

      switch (payload.action) {
        case 'create_community': {
          const res = this.createCommunity(
            payload.communityId,
            actorDid,
            payload.communityId,
            payload.governanceModel ?? 'open',
            event.createdAt * 1000,
          );
          return res.ok ? ok(undefined) : res;
        }

        case 'grant_role': {
          if (!payload.targetSubjectDid || !payload.roleName) {
            return err(new Error('Missing targetSubjectDid or roleName for grant_role'));
          }
          return this.assignRole(
            payload.communityId,
            actorDid,
            payload.targetSubjectDid,
            payload.roleName as CommunityRole,
          );
        }

        case 'cast_vote': {
          if (!payload.proposalId || !payload.voteOption) {
            return err(new Error('Missing proposalId or voteOption for cast_vote'));
          }
          return this.castVote(
            payload.proposalId,
            actorDid,
            payload.voteOption,
            event.createdAt * 1000,
          );
        }

        default:
          return ok(undefined);
      }
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e ?? 'Failed to process governance event')));
    }
  }
}
