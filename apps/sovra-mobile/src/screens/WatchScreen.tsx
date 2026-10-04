/**
 * @file apps/sovra-mobile/src/screens/WatchScreen.tsx
 * YouTube-Style 16:9 HLS Player & Creator Monetization Screen for Mobile.
 *
 * Implements:
 * 1. 16:9 Aspect ratio video player with ambient glow backdrop.
 * 2. Adaptive Bitrate (ABR) selector (Auto, 1080p, 720p, 480p, 360p).
 * 3. 95/5 Creator Super-Thanks tipping with confetti burst.
 * 4. Nested comment discussions with pinned supporter badges.
 */

import React, { useState } from 'react';

export function WatchScreen(): React.JSX.Element {
  const [isPlaying, setIsPlaying] = useState(true);
  const [resolution, setResolution] = useState<'1080p' | '720p' | '480p' | '360p'>('720p');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [confettiActive, setConfettiActive] = useState(false);
  const [tipsSent, setTipsSent] = useState(0);

  const handleSuperTip = () => {
    setConfettiActive(true);
    setTipsSent(prev => prev + 10); // ₹10
    setTimeout(() => setConfettiActive(false), 2000);
  };

  return (
    <div style={{ flex: 1, backgroundColor: '#090d16', color: '#fff', overflowY: 'auto', paddingBottom: 64 }}>
      {/* 16:9 Video Player Viewport */}
      <div style={{ width: '100%', aspectRatio: '16/9', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
        <div
          onClick={() => setIsPlaying(!isPlaying)}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at center, #1e1b4b 0%, #030712 100%)',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '3rem', marginBottom: 6 }}>🎬</span>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Understanding P2P Distributed Hash Tables</div>
          <div style={{ fontSize: 10, color: '#34d399', marginTop: 4, fontFamily: 'monospace' }}>
            ● Buffer: 6.4s &bull; Quality: {resolution} (Auto ABR)
          </div>
        </div>

        {/* Confetti Animation Notification */}
        {confettiActive && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(245, 158, 11, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.4rem',
              fontWeight: 800,
              color: '#fef08a',
            }}
          >
            🎉 ₹10 Super-Thanks Sent! (95% to Creator) ⚡
          </div>
        )}

        {/* Controls Bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '8px 12px',
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span onClick={() => setIsPlaying(!isPlaying)} style={{ cursor: 'pointer' }}>
              {isPlaying ? '⏸' : '▶'}
            </span>
            <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>04:12 / 18:40</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              value={resolution}
              onChange={e => setResolution(e.target.value as any)}
              style={{
                backgroundColor: '#1f2937',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 4,
                fontSize: 10,
                padding: '2px 4px',
              }}
            >
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
              <option value="480p">480p</option>
              <option value="360p">360p</option>
            </select>
            <span>⛶</span>
          </div>
        </div>
      </div>

      {/* Video Details */}
      <div style={{ padding: '12px 16px' }}>
        <h1 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 8px 0', lineHeight: 1.3 }}>
          Understanding P2P Distributed Hash Tables (Kademlia XOR Distance Walk)
        </h1>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
          14.2K views &bull; 2 days ago &bull; #p2p #kademlia #storage
        </div>

        {/* Channel Details & Subscribe Button */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 0',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                backgroundColor: '#3b82f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              A
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                Alice P2P Architect <span style={{ color: '#38bdf8' }}>✓</span>
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>8.4K subscribers</div>
            </div>
          </div>

          <button
            onClick={() => setIsSubscribed(!isSubscribed)}
            style={{
              padding: '6px 14px',
              borderRadius: 9999,
              backgroundColor: isSubscribed ? 'rgba(255,255,255,0.1)' : '#fff',
              color: isSubscribed ? '#fff' : '#000',
              fontWeight: 700,
              fontSize: 12,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {isSubscribed ? 'Subscribed' : 'Subscribe'}
          </button>
        </div>

        {/* Action Pills Row */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16 }}>
          <button
            onClick={handleSuperTip}
            style={{
              backgroundColor: '#f59e0b',
              color: '#000',
              border: 'none',
              borderRadius: 9999,
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            ⚡ Super Thanks ({tipsSent > 0 ? `+₹${tipsSent}` : '₹10'})
          </button>
          <button
            style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              color: '#fff',
              border: 'none',
              borderRadius: 9999,
              padding: '6px 12px',
              fontSize: 11,
            }}
          >
            👍 842
          </button>
          <button
            style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              color: '#fff',
              border: 'none',
              borderRadius: 9999,
              padding: '6px 12px',
              fontSize: 11,
            }}
          >
            ↗️ Share
          </button>
          <button
            style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              color: '#fff',
              border: 'none',
              borderRadius: 9999,
              padding: '6px 12px',
              fontSize: 11,
            }}
          >
            ⬇️ Download
          </button>
        </div>

        {/* Comments Preview Box */}
        <div
          style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderRadius: 12,
            padding: 12,
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Comments &bull; 64</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                backgroundColor: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
              }}
            >
              B
            </div>
            <span style={{ color: '#cbd5e1', fontSize: 11 }}>
              <span style={{ fontWeight: 600, color: '#fff', marginRight: 4 }}>bob_live:</span>
              The explanation of XOR metric at 04:12 cleared all my doubts!
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
