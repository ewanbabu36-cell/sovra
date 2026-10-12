/**
 * @file tests/unit/community-jury.test.ts
 * SOVRA Community Jury & 24-Hour Democratic Moderation System
 *
 * Verifies the foundational principles:
 * "Universal Rights & Sovereign Equality: No government, corporation, or elite
 * has unilateral takedown power or special immunity."
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { sovraDb, ExtendedViolationCategory } from '../../scripts/database-engine.js';

describe('SOVRA Community Jury & 24-Hour Democratic Moderation Engine', { timeout: 25000 }, () => {
  const ts = Date.now();
  const authorDid = `did:sovra:author_${ts}`;
  const reporterDid = `did:sovra:reporter_${ts}`;
  const reporter2Did = `did:sovra:reporter2_${ts}`;
  const testPostId = `feed-jury-${ts}`;

  beforeAll(() => {
    // Register author and reporters
    sovraDb.registerUser({
      did: authorDid,
      handle: `@author_${ts}`,
      displayName: 'Sovereign Author',
    });

    sovraDb.registerUser({
      did: reporterDid,
      handle: `@reporter_${ts}`,
      displayName: 'Sovereign Reporter',
    });

    sovraDb.registerUser({
      did: reporter2Did,
      handle: `@reporter2_${ts}`,
      displayName: 'Second Reporter',
    });

    // Create target post
    sovraDb.createPost({
      id: testPostId,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Decentralized free speech publication #truth #sovereignty',
      visibility: 'public',
    });
  }, 30000);

  // 1. Standardized 17 Violation Categories
  it('1. correctly normalizes and recognizes all 17 standardized violation categories', () => {
    const expected17: ExtendedViolationCategory[] = [
      'hate_speech',
      'credible_threats',
      'terrorism_extremism',
      'csam_exploitation',
      'minor_grooming',
      'ncii_exploitation',
      'adult_sexual_content',
      'harassment_stalking',
      'misinformation_deception',
      'fraud_scams',
      'doxxing_privacy',
      'trafficking_coercion',
      'dangerous_instructions',
      'spam_manipulation',
      'suicide_self_harm',
      'copyright_violation',
      'other_serious',
    ];

    expect(expected17.length).toBe(17);

    for (const cat of expected17) {
      const normalized = sovraDb.normalizeViolationCategory(cat);
      expect(normalized).toBe(cat);
    }

    // Verify aliases/screaming snake case map correctly
    expect(sovraDb.normalizeViolationCategory('HATE_SPEECH_DEHUMANIZATION')).toBe('hate_speech');
    expect(sovraDb.normalizeViolationCategory('CHILD_EXPLOITATION_CSAM')).toBe('csam_exploitation');
    expect(sovraDb.normalizeViolationCategory('IMMINENT_VIOLENCE_INCITEMENT')).toBe('credible_threats');
    expect(sovraDb.normalizeViolationCategory('FINANCIAL_FRAUD_SCAM')).toBe('fraud_scams');
  });

  // 2. Emergency Safety Routing (CSAM / Imminent Danger)
  it('2. triggers emergency safety quarantine immediately for high-risk severe violations', () => {
    const emergencyPostId = `feed-emerg-${ts}`;
    sovraDb.createPost({
      id: emergencyPostId,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'High risk content under test',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: emergencyPostId,
      reporterDid: reporterDid,
      category: 'csam_exploitation',
      description: 'Emergency safety report for child safety violation',
    });

    expect(res.ok).toBe(true);
    expect(res.emergency).toBe(true);
    expect(res.case?.priority).toBe('EMERGENCY');
    expect(res.case?.state).toBe('TRIAGE');
    expect(res.case?.emergencyAction?.applied).toBe(true);

    // Underlying post must be immediately quarantined/restricted
    const modState = sovraDb.getContentModerationState('post', emergencyPostId);
    expect(modState).toBe('RESTRICTED');
  });

  // 3. 24-Hour Review Epoch & Deadline Calculation
  it('3. enforces 24-hour voting epoch deadline and prevents premature non-forced finalization', () => {
    const post3Id = `feed-epoch-${ts}`;
    sovraDb.createPost({
      id: post3Id,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Epoch test post',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: post3Id,
      reporterDid: reporterDid,
      category: 'misinformation_deception',
      description: 'Misleading statement regarding election timing',
    });

    expect(res.ok).toBe(true);
    const juryCase = res.case!;
    expect(juryCase.votingDeadline - juryCase.votingOpensAt).toBe(24 * 60 * 60 * 1000);

    // Premature finalization without force must fail
    const premature = sovraDb.finalizeJuryCase(juryCase.id, false);
    expect(premature.ok).toBe(false);
    expect(premature.error).toContain('Voting window is still open');
  });

  // 4. Equal Protection Principle: Author Defense & Context
  it('4. guarantees author equal right of defense while barring non-authors', () => {
    const post4Id = `feed-defense-${ts}`;
    sovraDb.createPost({
      id: post4Id,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Defense test post',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: post4Id,
      reporterDid: reporterDid,
      category: 'harassment_stalking',
      description: 'Alleged targeted harassment',
    });
    expect(res.ok).toBe(true);
    const caseId = res.case!.id;

    // Non-author attempt to submit defense must be rejected
    const imposterRes = sovraDb.submitAuthorDefense(caseId, reporterDid, 'I am not guilty');
    expect(imposterRes.ok).toBe(false);
    expect(imposterRes.error).toContain('Only the content author can submit a defense');

    // Author defense submission must succeed
    const authorRes = sovraDb.submitAuthorDefense(
      caseId,
      authorDid,
      'This was satirical criticism made in public political discourse with verified sources.'
    );
    expect(authorRes.ok).toBe(true);
    expect(authorRes.case?.authorDefenseNote).toContain('satirical criticism');
    expect(authorRes.case?.authorDefenseSubmittedAt).toBeGreaterThan(0);
  });

  // 5. Conflict of Interest: Author and Reporter Barred from Voting
  it('5. strictly prevents author and direct reporters from voting as jurors', () => {
    const post5Id = `feed-coi-${ts}`;
    sovraDb.createPost({
      id: post5Id,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'COI test post',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: post5Id,
      reporterDid: reporterDid,
      category: 'hate_speech',
      description: 'Hate speech report for testing COI',
    });
    const caseId = res.case!.id;

    // Author cannot vote on their own case
    const authorVote = sovraDb.castJuryVote(caseId, authorDid, 'VIOLATION_NOT_PROVEN', 'I did nothing wrong');
    expect(authorVote.ok).toBe(false);
    expect(authorVote.error).toContain('Author cannot vote on their own case');

    // Direct reporter cannot vote
    const reporterVote = sovraDb.castJuryVote(caseId, reporterDid, 'VIOLATION_PROVEN', 'Guilty');
    expect(reporterVote.ok).toBe(false);
    expect(reporterVote.error).toContain('Direct reporter cannot act as juror');
  });

  // 6. Sybil Resistance: Duplicate Voting Barred
  it('6. prevents duplicate votes from the same juror DID', () => {
    const post6Id = `feed-sybil-${ts}`;
    sovraDb.createPost({
      id: post6Id,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Sybil test post',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: post6Id,
      reporterDid: reporterDid,
      category: 'fraud_scams',
      description: 'Financial scheme investigation',
    });
    const caseId = res.case!.id;
    const jurorDid = `did:sovra:juror_single_${ts}`;

    const vote1 = sovraDb.castJuryVote(caseId, jurorDid, 'VIOLATION_PROVEN', 'Evidence verified');
    expect(vote1.ok).toBe(true);

    const vote2 = sovraDb.castJuryVote(caseId, jurorDid, 'VIOLATION_PROVEN', 'Duplicate attempt');
    expect(vote2.ok).toBe(false);
    expect(vote2.error).toContain('Duplicate Vote');
  });

  // 7. Consolidation of Multiple Reports
  it('7. consolidates additional reports into active case without duplicate ballots', () => {
    const consolidPostId = `feed-consolid-${ts}`;
    sovraDb.createPost({
      id: consolidPostId,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Post for testing report consolidation',
      visibility: 'public',
    });

    const res1 = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: consolidPostId,
      reporterDid: reporterDid,
      category: 'spam_manipulation',
      description: 'First report from Alice',
      evidenceUrls: ['https://sovra.mesh/evidence/1'],
    });
    expect(res1.ok).toBe(true);
    expect(res1.isConsolidated).toBe(false);

    const res2 = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: consolidPostId,
      reporterDid: reporter2Did,
      category: 'fraud_scams',
      description: 'Second report from Bob',
      evidenceUrls: ['https://sovra.mesh/evidence/2'],
    });
    expect(res2.ok).toBe(true);
    expect(res2.isConsolidated).toBe(true);
    expect(res2.case?.id).toBe(res1.case?.id);
    expect(res2.case?.reportsCount).toBe(2);
    expect(res2.case?.categories).toContain('fraud_scams');
  });

  // 8. Democratic Quorum Requirement (21 jurors default)
  it('8. preserves content if minimum quorum (21 jurors) is not met', () => {
    const post8Id = `feed-quorum-${ts}`;
    sovraDb.createPost({
      id: post8Id,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Quorum test post',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: post8Id,
      reporterDid: reporterDid,
      category: 'doxxing_privacy',
      description: 'Doxxing allegation',
    });
    const caseId = res.case!.id;

    // Cast only 5 votes (below quorum of 21)
    for (let i = 0; i < 5; i++) {
      sovraDb.castJuryVote(caseId, `did:sovra:juror_quorum_${ts}_${i}`, 'VIOLATION_PROVEN');
    }

    const finalized = sovraDb.finalizeJuryCase(caseId, { force: true });
    expect(finalized.ok).toBe(true);
    expect(finalized.case?.verdict?.decision).toBe('INSUFFICIENT_QUORUM');
    expect(finalized.case?.verdict?.quorumReached).toBe(false);
    expect(finalized.case?.enforcement?.action).toBe('PRESERVED');

    const modState = sovraDb.getContentModerationState('post', post8Id);
    expect(modState).toBe('VISIBLE');
  }, 20000);

  // 9. Democratic Supermajority Threshold (66.67% Required for Removal)
  it('9. executes automatic removal when democratic 66.67% supermajority is achieved with quorum', () => {
    const postToRemove = `feed-remove-${ts}`;
    sovraDb.createPost({
      id: postToRemove,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Flagrant violation post',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: postToRemove,
      reporterDid: reporterDid,
      category: 'hate_speech',
      description: 'Explicit hate speech and dehumanization',
    });
    const caseId = res.case!.id;

    // Cast 21 votes: 15 VIOLATION_PROVEN (71.4%), 6 VIOLATION_NOT_PROVEN
    for (let i = 0; i < 15; i++) {
      const v = sovraDb.castJuryVote(caseId, `did:sovra:juror_pass_${ts}_${i}`, 'VIOLATION_PROVEN');
      expect(v.ok).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      const v = sovraDb.castJuryVote(caseId, `did:sovra:juror_notpass_${ts}_${i}`, 'VIOLATION_NOT_PROVEN');
      expect(v.ok).toBe(true);
    }

    const finalized = sovraDb.finalizeJuryCase(caseId, { force: true });
    expect(finalized.ok).toBe(true);
    expect(finalized.case?.verdict?.decision).toBe('REMOVE');
    expect(finalized.case?.verdict?.violationPercent).toBeGreaterThanOrEqual(67);
    expect(finalized.case?.enforcement?.action).toBe('REMOVED');

    const modState = sovraDb.getContentModerationState('post', postToRemove);
    expect(modState).toBe('REMOVED');
  }, 60000);

  // 10. Content Preservation when Supermajority is Not Reached
  it('10. preserves content when violation votes are below 66.67% supermajority threshold', () => {
    const postToKeep = `feed-keep-${ts}`;
    sovraDb.createPost({
      id: postToKeep,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Controversial political debate',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: postToKeep,
      reporterDid: reporterDid,
      category: 'misinformation_deception',
      description: 'Contentious political claims',
    });
    const caseId = res.case!.id;

    // Cast 21 votes: 12 VIOLATION_PROVEN (57.1%), 9 VIOLATION_NOT_PROVEN (42.9%)
    for (let i = 0; i < 12; i++) {
      const v = sovraDb.castJuryVote(caseId, `did:sovra:juror_below_${ts}_${i}`, 'VIOLATION_PROVEN');
      expect(v.ok).toBe(true);
    }
    for (let i = 0; i < 9; i++) {
      const v = sovraDb.castJuryVote(caseId, `did:sovra:juror_safe_${ts}_${i}`, 'VIOLATION_NOT_PROVEN');
      expect(v.ok).toBe(true);
    }

    const finalized = sovraDb.finalizeJuryCase(caseId, { force: true });
    expect(finalized.ok).toBe(true);
    expect(finalized.case?.verdict?.decision).toBe('PRESERVE');
    expect(finalized.case?.enforcement?.action).toBe('PRESERVED');

    const modState = sovraDb.getContentModerationState('post', postToKeep);
    expect(modState).toBe('VISIBLE');
  }, 60000);

  // 11. Appeals Window & Independent Reviewer Protection
  it('11. allows appeals from author and bars original jurors from evaluating appeal', () => {
    const appealedPost = `feed-appeal-${ts}`;
    sovraDb.createPost({
      id: appealedPost,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Post to be removed then appealed',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: appealedPost,
      reporterDid: reporterDid,
      category: 'copyright_violation',
      description: 'Fair use dispute',
    });
    const caseId = res.case!.id;

    const originalJuror = `did:sovra:juror_appealtest_${ts}`;
    for (let i = 0; i < 21; i++) {
      const vDid = i === 0 ? originalJuror : `did:sovra:juror_app_${ts}_${i}`;
      sovraDb.castJuryVote(caseId, vDid, 'VIOLATION_PROVEN');
    }

    sovraDb.finalizeJuryCase(caseId, { force: true });

    // Submit appeal by author
    const appealRes = sovraDb.submitJuryAppeal(caseId, authorDid, {
      rationale: 'Content is transformative public commentary protected under sovereign fair-use exceptions.',
    });
    expect(appealRes.ok).toBe(true);
    const appealId = appealRes.appeal!.id;

    // Original juror must be barred from reviewing appeal
    const jurorResolve = sovraDb.resolveJuryAppeal(caseId, appealId, originalJuror, 'GRANTED');
    expect(jurorResolve.ok).toBe(false);
    expect(jurorResolve.error).toContain('Original juror cannot evaluate this appeal');

    // Independent reviewer grants appeal -> content restored
    const independentReviewer = `did:sovra:independent_panel_${ts}`;
    const grantRes = sovraDb.resolveJuryAppeal(
      caseId,
      appealId,
      independentReviewer,
      'GRANTED',
      'Appeal granted: transformative commentary verified'
    );
    expect(grantRes.ok).toBe(true);
    expect(grantRes.appeal?.status).toBe('GRANTED');
    expect(grantRes.case?.enforcement?.action).toBe('RESTORED');

    const modState = sovraDb.getContentModerationState('post', appealedPost);
    expect(modState).toBe('VISIBLE');
  }, 60000);

  // 12. Automated Epoch Processing
  it('12. automatically finalizes expired cases via processDueCases', () => {
    const expiredPost = `feed-expired-${ts}`;
    sovraDb.createPost({
      id: expiredPost,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Post past voting deadline',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: expiredPost,
      reporterDid: reporterDid,
      category: 'spam_manipulation',
      description: 'Automated processing check',
    });
    const caseId = res.case!.id;

    // Simulate expired deadline on the live database record
    const state = sovraDb.getState();
    const c = (state.jury_cases || []).find(item => item.id === caseId);
    if (c) {
      c.votingDeadline = Date.now() - 1000;
      sovraDb.save();
    }

    const processed = sovraDb.processDueCases();
    expect(processed.finalizedCount).toBeGreaterThanOrEqual(1);

    const updated = sovraDb.getJuryCaseById(caseId);
    expect(updated?.enforcement?.applied).toBe(true);
  });

  // 13. Public Transparency Metrics
  it('13. provides accurate transparency metrics across all 17 categories and outcomes', () => {
    const metrics = sovraDb.getTransparencyMetrics();
    expect(typeof metrics.totalCases).toBe('number');
    expect(typeof metrics.activeCases).toBe('number');
    expect(typeof metrics.violationProvenCount).toBe('number');
    expect(typeof metrics.violationNotProvenCount).toBe('number');
    expect(typeof metrics.categoryBreakdown).toBe('object');
    expect(metrics.totalCases).toBeGreaterThanOrEqual(1);
  });

  // 14. Anonymization and Privacy for Juror Retaliation Prevention
  it('14. anonymizes voter identities in public case views to prevent retaliation', () => {
    const post14Id = `feed-privacy-${ts}`;
    sovraDb.createPost({
      id: post14Id,
      authorDid: authorDid,
      authorName: 'Sovereign Author',
      authorHandle: `@author_${ts}`,
      caption: 'Privacy test post',
      visibility: 'public',
    });

    const res = sovraDb.createOrConsolidateJuryReport({
      targetType: 'post',
      targetId: post14Id,
      reporterDid: reporterDid,
      category: 'hate_speech',
      description: 'Privacy test case',
    });
    const caseId = res.case!.id;
    const voterDid = `did:sovra:private_juror_${ts}`;

    sovraDb.castJuryVote(caseId, voterDid, 'VIOLATION_PROVEN');

    // Case retrieved by another viewer must have anonymized juror hash
    const publicCase = sovraDb.getJuryCaseById(caseId, `did:sovra:other_viewer_${ts}`);
    expect(publicCase).not.toBeNull();
    const voterKeys = Object.keys(publicCase!.voters);
    expect(voterKeys.length).toBe(1);
    expect(voterKeys[0]).toMatch(/^juror_[a-f0-9]{8}$/);
  });
});
