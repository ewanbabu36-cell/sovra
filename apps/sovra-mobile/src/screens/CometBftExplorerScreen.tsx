/**
 * @file apps/sovra-mobile/src/screens/CometBftExplorerScreen.tsx
 * Mobile CometBFT L1 Block Explorer Screen
 * Displays live decentralized consensus metrics, block height, validator pools,
 * and state-channel cryptographic transactions.
 */

import React, { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../services/api.js';

export interface BlockSummary {
  readonly height: number;
  readonly hash: string;
  readonly timeAgo: string;
  readonly txCount: number;
  readonly proposer: string;
}

export interface CometBftExplorerScreenProps {
  readonly onClose: () => void;
}

export function CometBftExplorerScreen({ onClose }: CometBftExplorerScreenProps): React.JSX.Element {
  const [blockHeight, setBlockHeight] = useState<number>(0);
  const [activeValidators, setActiveValidators] = useState<number>(0);
  const [blockTimeSeconds, setBlockTimeSeconds] = useState<number>(1.0);
  const [economy, setEconomy] = useState<any | null>(null);
  const [recentBlocks, setRecentBlocks] = useState<BlockSummary[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadLiveChainState = async () => {
    try {
      const [sumRes, econRes] = await Promise.all([
        fetch(`${getApiBaseUrl()}/api/explorer/summary`),
        fetch(`${getApiBaseUrl()}/api/economy/overview`),
      ]);
      if (sumRes.ok) {
        const data = await sumRes.json();
        if (data?.ok) {
          setBlockHeight(Number(data.height || 0));
          setActiveValidators(Number(data.consensus?.onlineValidators ?? data.consensus?.totalValidators ?? 0));
          if (data.blockTimeSeconds) setBlockTimeSeconds(Number(data.blockTimeSeconds));
          if (Array.isArray(data.recentBlocks)) {
            setRecentBlocks(
              data.recentBlocks.map((b: any) => ({
                height: Number(b.height || 0),
                hash: String(b.blockHash || b.hash || '').slice(0, 18),
                timeAgo: b.timestamp ? `${Math.max(0, Math.round((Date.now() - Number(b.timestamp)) / 1000))}s ago` : 'recent',
                txCount: Number(b.txCount || 0),
                proposer: String(b.proposer || 'validator-0'),
              })),
            );
          }
        }
      }
      if (econRes.ok) {
        const eData = await econRes.json();
        if (eData?.ok && eData.economy) {
          setEconomy(eData.economy);
        }
      }
    } catch {}
  };

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      if (mounted) await loadLiveChainState();
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await loadLiveChainState();
    setTimeout(() => setIsRefreshing(false), 300);
  };

  return (
    <div
      id="mobileCometBftExplorerScreen"
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
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            ⛓️
          </div>
          <div>
            <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#f8fafc' }}>CometBFT L1 Explorer</div>
            <div style={{ fontSize: '0.72rem', color: '#a5b4fc' }}>Sovereign Tendermint Consensus</div>
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
        {/* Consensus Metrics Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
              padding: '12px',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
              Block Height
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#38bdf8', marginTop: 4 }}>
              #{blockHeight.toLocaleString()}
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
              padding: '12px',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
              Block Time
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#34d399', marginTop: 4 }}>
              {blockTimeSeconds}s
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
              padding: '12px',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
              Validators
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#a5b4fc', marginTop: 4 }}>
              {activeValidators} Active
            </div>
          </div>
        </div>

        {/* Live Sovereign Supply, Burn, Locked & Circulating Dashboard */}
        <div
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.06)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: 14,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#34d399', textTransform: 'uppercase' }}>
              🔥 Live Supply, Burn & Lockup Dashboard
            </span>
            <span style={{ fontSize: '0.68rem', color: economy?.isNetDeflationaryToday ? '#f59e0b' : '#94a3b8', fontWeight: 700 }}>
              {economy?.isNetDeflationaryToday ? 'NET DEFLATIONARY 🔥' : '100M Hard Cap'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: '0.72rem' }}>
            <div>
              <div style={{ color: '#94a3b8' }}>Total Burned (SOV)</div>
              <div style={{ fontWeight: 800, color: '#f87171' }}>
                {economy ? Number(economy.totalBurnedSov || 0).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
              </div>
            </div>
            <div>
              <div style={{ color: '#94a3b8' }}>Total Locked (Staked+Vest+DePIN+POL)</div>
              <div style={{ fontWeight: 800, color: '#a5b4fc' }}>
                {economy ? Number(economy.totalLockedSov || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
              </div>
            </div>
            <div>
              <div style={{ color: '#94a3b8' }}>Liquid Circulating Supply</div>
              <div style={{ fontWeight: 800, color: '#38bdf8' }}>
                {economy ? Number(economy.liquidCirculatingSov || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
              </div>
            </div>
            <div>
              <div style={{ color: '#94a3b8' }}>Fee Burn / Unbond Delay</div>
              <div style={{ fontWeight: 800, color: '#e2e8f0' }}>
                {economy ? `${economy.feeBurnPercent}% Burn · ${economy.unbondingPeriodDays}d Cooldown` : '50% Burn · 14d Cooldown'}
              </div>
            </div>
          </div>
          {economy && (
            <div style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <span>veSOV: {Number(economy.bondedStakeSov || 0).toFixed(1)} SOV</span>
              <span>DePIN Bond: {Number(economy.seederCollateralSov || 0).toFixed(1)} SOV</span>
              <span>Patron: {Number(economy.patronStakedSov || 0).toFixed(1)} SOV</span>
              <span>Vesting: {Number(economy.vestingLockedSov || 0).toFixed(1)} SOV</span>
              <span>POL LP: {Number(economy.polLockedSov || 0).toFixed(1)} SOV</span>
            </div>
          )}
        </div>

        {/* Live Block Stream Table */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9' }}>Recent Confirmed Blocks</span>
            <button
              onClick={handleManualRefresh}
              style={{
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: '#a5b4fc',
                fontSize: '0.74rem',
                fontWeight: 700,
                borderRadius: 8,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              {isRefreshing ? '↻ Syncing...' : '↻ Refresh'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentBlocks.map((blk) => (
              <div
                key={blk.height}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#38bdf8' }}>#{blk.height}</span>
                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                      {blk.hash}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
                    Proposer: {blk.proposer} • {blk.timeAgo}
                  </div>
                </div>
                <div
                  style={{
                    backgroundColor: 'rgba(52, 211, 153, 0.15)',
                    color: '#34d399',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: 8,
                  }}
                >
                  {blk.txCount} txs
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
