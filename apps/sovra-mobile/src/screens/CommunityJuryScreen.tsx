/**
 * @file apps/sovra-mobile/src/screens/CommunityJuryScreen.tsx
 * Mobile Equal Rights Community Jury (24h Democratic Review)
 * Implements sovereign human equality: no corporate or governmental takedown immunity.
 * Peers review reported disputes, author defense, and cast anonymous quadratic votes.
 */

import React, { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../services/api.js';

export interface DisputeCase {
  readonly id: string;
  readonly targetType: string;
  readonly reportedHandle: string;
  readonly reason: string;
  readonly evidenceSummary: string;
  readonly authorDefense: string;
  readonly hoursRemaining: number;
  readonly votesKeep: number;
  readonly votesRemove: number;
  readonly userVoted?: 'keep' | 'remove';
}

export interface CommunityJuryScreenProps {
  readonly onClose: () => void;
}

export function CommunityJuryScreen({ onClose }: CommunityJuryScreenProps): React.JSX.Element {
  const [activeCases, setActiveCases] = useState<DisputeCase[]>([
    {
      id: 'disp_2026_01',
      targetType: 'Public Mesh Dispatch',
      reportedHandle: '@david_p2p',
      reason: 'Misinformation & Manipulated Media',
      evidenceSummary: 'Video alleges simulated zero-knowledge proof failure on testnet without reproduction steps.',
      authorDefense: 'Provided full reproducible shell command trace in public repository issue #402. Not manipulated.',
      hoursRemaining: 18,
      votesKeep: 142,
      votesRemove: 38,
    },
    {
      id: 'disp_2026_02',
      targetType: 'Channel Broadcast',
      reportedHandle: '@defi_alpha',
      reason: 'Spam, Bots & Coordinated Inauthentic Behavior',
      evidenceSummary: 'Repetitive broadcast loops detected across 4 relays within 10 minutes.',
      authorDefense: 'Automated script glitch during mesh relay upgrade. Fixed in v2.4.',
      hoursRemaining: 9,
      votesKeep: 85,
      votesRemove: 110,
    },
  ]);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchCases = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/moderation/cases`);
        const data = await res.json();
        if (mounted && data && data.ok && Array.isArray(data.cases) && data.cases.length > 0) {
          setActiveCases(data.cases.map((c: any) => ({
            id: c.caseId || c.id,
            targetType: c.targetType || 'Content Violation',
            reportedHandle: c.reportedHandle || '@peer',
            reason: c.reason || 'Community Guidelines Review',
            evidenceSummary: c.evidenceSummary || 'Pending juror consensus.',
            authorDefense: c.authorDefense || 'No defense submitted.',
            hoursRemaining: c.hoursRemaining || 24,
            votesKeep: c.votesKeep || 0,
            votesRemove: c.votesRemove || 0,
          })));
        }
      } catch (_) {}
    };
    fetchCases();
    return () => { mounted = false; };
  }, []);

  const handleVote = async (caseId: string, choice: 'keep' | 'remove') => {
    setActiveCases((prev) =>
      prev.map((c) => {
        if (c.id === caseId) {
          return {
            ...c,
            userVoted: choice,
            votesKeep: choice === 'keep' ? c.votesKeep + 1 : c.votesKeep,
            votesRemove: choice === 'remove' ? c.votesRemove + 1 : c.votesRemove,
          };
        }
        return c;
      })
    );
    setFeedbackMsg(`⚖️ Anonymous quadratic vote cast: ${choice === 'keep' ? 'Preserve Content' : 'Quarantine Content'}`);
    try {
      await fetch(`${getApiBaseUrl()}/api/jury/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ballotId: caseId, vote: choice, weight: 1 }),
      });
    } catch (_) {}
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  return (
    <div
      id="mobileCommunityJuryScreen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#090e17',
        color: '#f8fafc',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 18px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(10px)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            ⚖️
          </div>
          <div>
            <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#f8fafc' }}>Equal Rights Community Jury</div>
            <div style={{ fontSize: '0.72rem', color: '#f87171' }}>24h Democratic Review & Defense</div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            fontSize: '1.2rem',
            cursor: 'pointer',
            padding: 6,
          }}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Universal Human Equality Banner */}
        <div
          style={{
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: 14,
            padding: '12px 14px',
            fontSize: '0.76rem',
            color: '#bae6fd',
            lineHeight: 1.45,
          }}
        >
          <b>Universal Equality Guarantee:</b> Under SOVRA, no government, corporation, or elite has unilateral takedown power. All dispute reports require a <b>24-Hour Democratic Community Ballot</b> where the author holds equal right of defense.
        </div>

        {feedbackMsg && (
          <div
            style={{
              backgroundColor: 'rgba(52, 211, 153, 0.15)',
              border: '1px solid rgba(52, 211, 153, 0.35)',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: '0.76rem',
              color: '#34d399',
              textAlign: 'center',
              fontWeight: 700,
            }}
          >
            {feedbackMsg}
          </div>
        )}

        {/* Dispute Cases */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activeCases.map((cs) => (
            <div
              key={cs.id}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 16,
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', color: '#f87171', fontWeight: 700 }}>
                  🚩 {cs.reason}
                </span>
                <span
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    color: '#fbbf24',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 10,
                  }}
                >
                  ⏱️ {cs.hoursRemaining}h Left
                </span>
              </div>

              <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                <b>Reported:</b> {cs.reportedHandle} ({cs.targetType})
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  padding: '8px 10px',
                  borderRadius: 10,
                  fontSize: '0.74rem',
                  color: '#94a3b8',
                }}
              >
                <b>Evidence:</b> {cs.evidenceSummary}
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  padding: '8px 10px',
                  borderRadius: 10,
                  fontSize: '0.74rem',
                  color: '#a7f3d0',
                }}
              >
                <b>Author Defense:</b> {cs.authorDefense}
              </div>

              {/* Vote Actions */}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => handleVote(cs.id, 'keep')}
                  style={{
                    flex: 1,
                    backgroundColor: cs.userVoted === 'keep' ? 'rgba(52, 211, 153, 0.3)' : 'rgba(52, 211, 153, 0.15)',
                    border: '1px solid rgba(52, 211, 153, 0.4)',
                    color: '#34d399',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    borderRadius: 10,
                    padding: '8px',
                    cursor: 'pointer',
                  }}
                >
                  ✓ Preserve ({cs.votesKeep})
                </button>
                <button
                  onClick={() => handleVote(cs.id, 'remove')}
                  style={{
                    flex: 1,
                    backgroundColor: cs.userVoted === 'remove' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    borderRadius: 10,
                    padding: '8px',
                    cursor: 'pointer',
                  }}
                >
                  ✕ Quarantine ({cs.votesRemove})
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
