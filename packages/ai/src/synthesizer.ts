import {
  SupportingEvidenceItem,
  CounterargumentItem,
  ClaimSynthesis,
  QuestionSynthesis,
  EpistemicStatus,
} from './types.js';

export class LocalSummarizer {
  /**
   * Synthesizes a claim with its supporting evidence citations and counterarguments.
   * Produces a deterministic net epistemic score and consensus classification.
   */
  public synthesizeClaim(
    claimId: string,
    claimText: string,
    evidenceList: readonly SupportingEvidenceItem[],
    counterarguments: readonly CounterargumentItem[],
  ): ClaimSynthesis {
    let totalEvidenceReliability = 0;
    for (const ev of evidenceList) {
      totalEvidenceReliability += Math.max(0, Math.min(1, ev.reliability));
    }

    let totalCounterSeverity = 0;
    for (const ca of counterarguments) {
      totalCounterSeverity += Math.max(0, Math.min(1, ca.severity));
    }

    const netScoreRaw = totalEvidenceReliability - totalCounterSeverity;
    // Map to [-1.0, 1.0] using hyperbolic tangent or bounded scale
    const divisor = Math.max(1, totalEvidenceReliability + totalCounterSeverity);
    const netEpistemicScore = Number((netScoreRaw / divisor).toFixed(2));

    let consensusStatus: EpistemicStatus = 'UNVERIFIED';
    if (evidenceList.length === 0 && counterarguments.length === 0) {
      consensusStatus = 'UNVERIFIED';
    } else if (netEpistemicScore >= 0.35) {
      consensusStatus = 'SUPPORTED';
    } else if (netEpistemicScore <= -0.35) {
      consensusStatus = 'REFUTED';
    } else {
      consensusStatus = 'DISPUTED';
    }

    const avgReliability =
      evidenceList.length > 0
        ? Number((totalEvidenceReliability / evidenceList.length).toFixed(2))
        : 0;

    const summaryParts: string[] = [
      `Claim "${claimText.slice(0, 80)}${claimText.length > 80 ? '...' : ''}" is currently assessed as ${consensusStatus}.`,
      `Net epistemic score: ${netEpistemicScore > 0 ? '+' : ''}${netEpistemicScore}.`,
      `Supported by ${evidenceList.length} evidence citation(s) (mean reliability: ${avgReliability}).`,
    ];

    if (counterarguments.length > 0) {
      summaryParts.push(`Challenged by ${counterarguments.length} counterargument(s).`);
    }

    return {
      claimId,
      claimText,
      supportingEvidence: [...evidenceList],
      counterarguments: [...counterarguments],
      netEpistemicScore,
      consensusStatus,
      synthesisSummary: summaryParts.join(' '),
    };
  }

  /**
   * Synthesizes multiple answers to a question into a consensus briefing.
   */
  public synthesizeQuestion(
    questionId: string,
    questionText: string,
    answers: readonly {
      readonly answerId: string;
      readonly authorPubkey: string;
      readonly text: string;
      readonly evidenceScore: number;
    }[],
  ): QuestionSynthesis {
    if (answers.length === 0) {
      return {
        questionId,
        questionText,
        answers: [],
        topAnswerId: undefined,
        netSynthesis: `No answers submitted yet for question: "${questionText}".`,
      };
    }

    // Rank answers by evidence score
    const sorted = [...answers].sort((a, b) => b.evidenceScore - a.evidenceScore);
    const topAnswer = sorted[0];

    const netSynthesis =
      `Question "${questionText}" has ${answers.length} response(s). ` +
      `Leading answer with highest evidence grounding (score ${topAnswer?.evidenceScore}): "${topAnswer?.text.slice(0, 100)}..."`;

    return {
      questionId,
      questionText,
      answers: sorted,
      topAnswerId: topAnswer?.answerId,
      netSynthesis,
    };
  }
}
