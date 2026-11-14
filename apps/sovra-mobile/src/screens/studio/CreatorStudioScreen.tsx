/**
 * @file apps/sovra-mobile/src/screens/studio/CreatorStudioScreen.tsx
 * Modular Creator Studio Screen: Monetization, Analytics & Instant Fiat Cash-Out.
 */

import React, { useState } from 'react';

export interface CreatorStudioScreenProps {
  readonly balanceSov?: string;
  readonly handle?: string;
  readonly onOpenWithdraw?: () => void;
  readonly onOpenWallet?: () => void;
  readonly onBack?: () => void;
}

export const CreatorStudioScreen: React.FC<CreatorStudioScreenProps> = ({
  balanceSov = '150.00',
  handle = '@alice',
  onOpenWithdraw,
  onOpenWallet,
  onBack,
}) => {
  const [tokenGatedEnabled, setTokenGatedEnabled] = useState(true);
  const [tipGoal, setTipGoal] = useState('500');

  return (
    <div style={{ padding: '16px 16px 80px 16px', color: '#f8fafc', maxWidth: 480, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              ←
            </button>
          )}
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>🎨 Creator Studio</h2>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{handle}</div>
          </div>
        </div>
        <span
          style={{
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 6,
            backgroundColor: 'rgba(99, 102, 241, 0.15)',
            color: '#818cf8',
            fontWeight: 700,
          }}
        >
          Partner Tier 1 ✓
        </span>
      </div>

      {/* Earnings Summary Card */}
      <div
        style={{
          background: 'linear-gradient(135deg, #311042 0%, #0f172a 100%)',
          borderRadius: 20,
          padding: '20px',
          border: '1px solid rgba(236, 72, 153, 0.25)',
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 11, color: '#f472b6', textTransform: 'uppercase', fontWeight: 700 }}>
          Creator Earnings Balance
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '8px 0 4px 0' }}>
          <span style={{ fontSize: 28, fontWeight: 900 }}>{balanceSov}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#f472b6' }}>SOV</span>
        </div>
        <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 14 }}>
          ≈ ₹{(parseFloat(balanceSov || '0') * 10).toFixed(2)} INR Available for Instant Cash-Out
        </div>
        <button
          onClick={onOpenWithdraw}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#10b981',
            color: '#090d16',
            border: 'none',
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          ⚡ Cash Out to Bank / UPI (Zero Fee)
        </button>
        {onOpenWallet && (
          <button
            onClick={onOpenWallet}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '10px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            💳 View Sovereign Treasury Wallet
          </button>
        )}
      </div>

      {/* Analytics Grid */}
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: '#94a3b8' }}>Performance Overview</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
        <div style={{ backgroundColor: '#1e293b', padding: '12px', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8' }}>14.2K</div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Views</div>
        </div>
        <div style={{ backgroundColor: '#1e293b', padding: '12px', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#34d399' }}>₹1,420</div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Tips Earned</div>
        </div>
        <div style={{ backgroundColor: '#1e293b', padding: '12px', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#ec4899' }}>98.4%</div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Positive Ratio</div>
        </div>
      </div>

      {/* Monetization Tools */}
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: '#94a3b8' }}>Monetization Controls</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            backgroundColor: '#1e293b',
            padding: '12px 14px',
            borderRadius: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Exclusive Content Subscriptions</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Allow subscribers to access private feeds</div>
          </div>
          <input
            type="checkbox"
            checked={tokenGatedEnabled}
            onChange={e => setTokenGatedEnabled(e.target.checked)}
            style={{ width: 18, height: 18, cursor: 'pointer' }}
          />
        </div>

        <div style={{ backgroundColor: '#1e293b', padding: '12px 14px', borderRadius: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Monthly Tipping Goal</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="number"
              value={tipGoal}
              onChange={e => setTipGoal(e.target.value)}
              style={{
                flex: 1,
                backgroundColor: '#0f172a',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 13,
              }}
            />
            <span style={{ fontSize: 12, color: '#94a3b8' }}>SOV</span>
          </div>
        </div>
      </div>
    </div>
  );
};
