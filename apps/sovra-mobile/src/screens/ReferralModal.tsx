/**
 * @file apps/sovra-mobile/src/screens/ReferralModal.tsx
 * Viral 1-Click Referral & Invite Screen for Sovra Mobile App.
 *
 * Implements:
 * 1. 1-Tap WhatsApp and Telegram viral deep-link sharing.
 * 2. Deterministic referral code derivation & 1-click clipboard copy.
 * 3. Live referral earnings dashboard (Friends Invited, Total SOV Earned).
 * 4. Claim Inviter Code input with instant 25 SOV welcome bonus.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchReferralStats,
  claimReferralCode,
  type MobileReferralStats,
} from '../services/api.js';

export interface ReferralModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly userDid?: string;
  readonly onBalanceUpdated?: (newBalance: number) => void;
}

export function ReferralModal({
  isOpen,
  onClose,
  userDid,
  onBalanceUpdated,
}: ReferralModalProps): React.JSX.Element | null {
  const [statsData, setStatsData] = useState<MobileReferralStats | null>(null);
  const [_isLoading, setIsLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Manual code entry for users who haven't claimed yet
  const [enterCode, setEnterCode] = useState('');
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchReferralStats(userDid);
      if (data) {
        setStatsData(data);
      }
    } catch (err) {
      console.warn('[ReferralModal] Error loading stats:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userDid]);

  useEffect(() => {
    if (isOpen) {
      loadStats();
      setClaimMsg(null);
    }
  }, [isOpen, loadStats]);

  if (!isOpen) return null;

  const referralCode = statsData?.referralCode || 'SOV-GENESIS';
  const referralLink = statsData?.referralLink || `https://sovra.app/join?ref=${referralCode}`;
  const shareMessage = statsData?.shareMessage ||
    `🚀 Join me on Sovra - the private WhatsApp & YouTube alternative where you own your identity! Use my referral code *${referralCode}* to get 25 FREE SOV coins in your sovereign wallet: ${referralLink}`;

  const handleCopyCode = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(referralCode);
      }
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(referralLink);
      }
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleShareWhatsApp = () => {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareMessage)}`;
    window.open(url, '_blank');
  };

  const handleShareTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareMessage)}`;
    window.open(url, '_blank');
  };

  const handleClaimCode = async () => {
    if (!enterCode.trim()) return;
    setIsClaiming(true);
    setClaimMsg(null);
    try {
      const res = await claimReferralCode({
        referralCode: enterCode.trim(),
        ...(userDid ? { inviteeDid: userDid } : {}),
      });

      if (res.ok) {
        setClaimMsg({
          text: res.message || '🎉 25 SOV Welcome Bonus claimed successfully!',
          isError: false,
        });
        setEnterCode('');
        if (typeof res.newBalanceSov === 'number' && onBalanceUpdated) {
          onBalanceUpdated(res.newBalanceSov);
        }
        loadStats();
      } else {
        setClaimMsg({
          text: res.error || 'Failed to claim referral code.',
          isError: true,
        });
      }
    } catch (err: any) {
      setClaimMsg({
        text: err instanceof Error ? err.message : 'Claim failed',
        isError: true,
      });
    } finally {
      setIsClaiming(false);
    }
  };

  const hasClaimed = statsData?.stats.hasClaimedWelcomeBonus;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      <div
        style={{
          backgroundColor: '#0f172a',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          borderTop: '1px solid rgba(234, 179, 8, 0.4)',
          color: '#fff',
          overflow: 'hidden',
          boxShadow: '0 -10px 40px rgba(234, 179, 8, 0.15)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🎁</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fde047' }}>
                Invite Friends &amp; Earn SOV
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Viral Decentralized Growth Engine
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              color: '#94a3b8',
              width: 32,
              height: 32,
              borderRadius: '50%',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          {/* Hero Card */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.2) 0%, rgba(217, 119, 6, 0.15) 100%)',
              border: '1px solid rgba(234, 179, 8, 0.4)',
              borderRadius: 16,
              padding: 18,
              textAlign: 'center',
              marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 6 }}>💰</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fef08a' }}>
              Give 25 SOV, Get 50 SOV
            </div>
            <p style={{ fontSize: 12, color: '#e2e8f0', margin: '6px 0 0 0', lineHeight: 1.4 }}>
              Share your invite link with friends. Whenever a friend joins Sovra, they instantly receive <strong>25 SOV</strong> and you earn <strong>50 SOV</strong> in your wallet!
            </p>
          </div>

          {/* Referral Code Box */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Your Unique Referral Code
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#1e293b',
                border: '1px solid rgba(234, 179, 8, 0.5)',
                borderRadius: 12,
                padding: '10px 14px',
                justifyContent: 'space-between',
              }}
            >
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  fontFamily: 'monospace',
                  letterSpacing: 2,
                  color: '#facc15',
                }}
              >
                {referralCode}
              </span>
              <button
                onClick={handleCopyCode}
                style={{
                  backgroundColor: copiedCode ? '#22c55e' : '#eab308',
                  color: copiedCode ? '#fff' : '#000',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {copiedCode ? '✓ Copied' : 'Copy Code'}
              </button>
            </div>
          </div>

          {/* 1-Click Viral Share Channels */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Instant 1-Click Share
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {/* WhatsApp Button */}
              <button
                onClick={handleShareWhatsApp}
                style={{
                  backgroundColor: '#25D366',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  padding: '12px 14px',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 16 }}>💬</span> WhatsApp
              </button>

              {/* Telegram Button */}
              <button
                onClick={handleShareTelegram}
                style={{
                  backgroundColor: '#0088cc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  padding: '12px 14px',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 16 }}>✈️</span> Telegram
              </button>
            </div>

            {/* Copy Link Full Button */}
            <button
              onClick={handleCopyLink}
              style={{
                width: '100%',
                marginTop: 10,
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 600,
                color: copiedLink ? '#4ade80' : '#cbd5e1',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <span>🔗</span> {copiedLink ? '✓ Referral Link Copied to Clipboard!' : 'Copy Direct Referral Link'}
            </button>
          </div>

          {/* Stats Dashboard */}
          <div
            style={{
              backgroundColor: '#1e293b',
              borderRadius: 16,
              padding: 16,
              marginBottom: 20,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 12, textTransform: 'uppercase' }}>
              Your Referral Impact
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
              <div style={{ backgroundColor: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8' }}>
                  {statsData?.stats.totalInvited ?? 0}
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Friends Joined</div>
              </div>

              <div style={{ backgroundColor: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#facc15' }}>
                  {(statsData?.stats.totalEarnedSov ?? 0).toFixed(0)}
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>SOV Earned</div>
              </div>

              <div style={{ backgroundColor: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#4ade80' }}>
                  +50
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Per Invite</div>
              </div>
            </div>

            {/* Invited Friends List */}
            {statsData && statsData.invitedPeers && statsData.invitedPeers.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>Recent Joins:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {statsData.invitedPeers.slice(0, 5).map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        padding: '6px 10px',
                        borderRadius: 6,
                      }}
                    >
                      <span style={{ color: '#cbd5e1' }}>{p.inviteeHandle}</span>
                      <span style={{ color: '#facc15', fontWeight: 700 }}>+{p.rewardSov} SOV</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Claim An Inviter Code (If Not Claimed Yet) */}
          <div
            style={{
              backgroundColor: '#1e293b',
              borderRadius: 16,
              padding: 16,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase' }}>
              Have a Friend&apos;s Referral Code?
            </div>

            {hasClaimed ? (
              <div
                style={{
                  fontSize: 12,
                  color: '#4ade80',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  backgroundColor: 'rgba(74, 222, 128, 0.1)',
                  borderRadius: 8,
                }}
              >
                <span>✓</span> Welcome bonus already claimed ({statsData?.stats.claimedFromCode || 'Active'})
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 11, color: '#cbd5e1', margin: '0 0 10px 0' }}>
                  If a friend invited you, enter their code below to receive your <strong>25 SOV</strong> bonus.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="e.g. SOV-686ABE"
                    value={enterCode}
                    onChange={(e) => setEnterCode(e.target.value.toUpperCase())}
                    style={{
                      flex: 1,
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      color: '#fff',
                      fontSize: 13,
                      fontFamily: 'monospace',
                      textTransform: 'uppercase',
                    }}
                  />
                  <button
                    onClick={handleClaimCode}
                    disabled={isClaiming || !enterCode.trim()}
                    style={{
                      backgroundColor: isClaiming || !enterCode.trim() ? '#475569' : '#3b82f6',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '10px 16px',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: isClaiming || !enterCode.trim() ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isClaiming ? 'Claiming...' : 'Claim 25 SOV'}
                  </button>
                </div>

                {claimMsg && (
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 12,
                      color: claimMsg.isError ? '#f87171' : '#4ade80',
                      padding: '6px 10px',
                      backgroundColor: claimMsg.isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(74, 222, 128, 0.1)',
                      borderRadius: 8,
                    }}
                  >
                    {claimMsg.text}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
