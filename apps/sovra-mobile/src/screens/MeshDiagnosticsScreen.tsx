/**
 * @file apps/sovra-mobile/src/screens/MeshDiagnosticsScreen.tsx
 * Production Mobile Mesh Diagnostics HUD & RF Attenuation Simulator.
 *
 * Provides real-time telemetry for:
 * 1. Physical BLE 5.3 GATT & Wi-Fi Direct NAN radio interfaces.
 * 2. Cryptographic Noise_XX session keys & local Peer ID.
 * 3. Connected peers matrix with real-time RSSI signal bars, hop count, and relayed bytes.
 * 4. Interactive RF attenuation simulator (0-90dB, 0-100% loss, 5-100m range decay).
 * 5. 1-tap "Ping Mesh Broadcast" measuring round-trip propagation latency.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchMeshTelemetry,
  updateRfSimulation,
  sendMeshPing,
  type MobileMeshTelemetry,
  type MobileMeshPingResult,
} from '../services/api.js';

interface MeshDiagnosticsScreenProps {
  onClose?: () => void;
}

export function MeshDiagnosticsScreen({ onClose }: MeshDiagnosticsScreenProps): React.JSX.Element {
  const [telemetry, setTelemetry] = useState<MobileMeshTelemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [pinging, setPinging] = useState(false);
  const [lastPingResult, setLastPingResult] = useState<MobileMeshPingResult['pingResult'] | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // RF Simulator controls state
  const [attenuationDb, setAttenuationDb] = useState(0);
  const [packetLossPct, setPacketLossPct] = useState(0);
  const [rangeDecayMeters, setRangeDecayMeters] = useState(50);
  const [multiHopFallback, setMultiHopFallback] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const data = await fetchMeshTelemetry();
      setTelemetry(data);
      if (data?.rfConfig) {
        setAttenuationDb(data.rfConfig.attenuationDb);
        setPacketLossPct(data.rfConfig.packetLossPct);
        setRangeDecayMeters(data.rfConfig.rangeDecayMeters);
        setMultiHopFallback(data.rfConfig.multiHopFallbackEnabled);
      }
    } catch (err) {
      console.error('Failed to load mesh telemetry:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 4000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleApplyRfSimulation = async (
    newAttenuation?: number,
    newLoss?: number,
    newDecay?: number,
    newFallback?: boolean,
  ) => {
    const config = {
      attenuationDb: newAttenuation ?? attenuationDb,
      packetLossPct: newLoss ?? packetLossPct,
      rangeDecayMeters: newDecay ?? rangeDecayMeters,
      multiHopFallbackEnabled: newFallback ?? multiHopFallback,
    };
    try {
      const res = await updateRfSimulation(config);
      if (res?.rfConfig && telemetry) {
        setTelemetry({
          ...telemetry,
          rfConfig: res.rfConfig,
          peers: res.peers,
        });
      }
    } catch (err) {
      console.error('Failed to update RF simulation:', err);
    }
  };

  const handlePingBroadcast = async () => {
    setPinging(true);
    try {
      const res = await sendMeshPing(telemetry?.localDid);
      if (res?.ok && res.pingResult) {
        setLastPingResult(res.pingResult);
        await loadData();
      }
    } catch (err) {
      console.error('Ping broadcast failed:', err);
    } finally {
      setPinging(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopyFeedback(`Copied ${label}!`);
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  const renderSignalBars = (bars: number, status: string) => {
    if (status === 'UNREACHABLE') {
      return <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>✕ DEAD</span>;
    }
    const color = bars >= 4 ? '#10b981' : bars >= 3 ? '#38bdf8' : bars >= 2 ? '#f59e0b' : '#ef4444';
    return (
      <div style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
        {[1, 2, 3, 4, 5].map(b => (
          <div
            key={b}
            style={{
              width: 3,
              height: `${b * 20}%`,
              backgroundColor: b <= bars ? color : 'rgba(255,255,255,0.15)',
              borderRadius: 1,
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#090d16',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflowY: 'auto',
        position: 'relative',
      }}
    >
      {/* Top Header Bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backgroundColor: '#030712',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: 'none',
                color: '#94a3b8',
                borderRadius: '50%',
                width: 32,
                height: 32,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
              }}
            >
              ←
            </button>
          )}
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0, letterSpacing: '0.2px' }}>
              📡 Mesh Diagnostics HUD
            </h1>
            <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 600 }}>
              BLE 5.3 GATT + Wi-Fi Direct NAN RF Simulator
            </div>
          </div>
        </div>

        <button
          onClick={handlePingBroadcast}
          disabled={pinging}
          style={{
            background: pinging
              ? 'rgba(56, 189, 248, 0.2)'
              : 'linear-gradient(135deg, #0284c7, #2563eb)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 12,
            cursor: pinging ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 2px 10px rgba(2, 132, 199, 0.3)',
          }}
        >
          <span>{pinging ? '⚡ Ping...' : '🎯 Ping Mesh'}</span>
        </button>
      </div>

      {copyFeedback && (
        <div
          style={{
            position: 'fixed',
            top: 70,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#10b981',
            color: '#020617',
            padding: '4px 12px',
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 700,
            zIndex: 100,
          }}
        >
          {copyFeedback}
        </div>
      )}

      {loading && !telemetry ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
          Initializing mesh radio interfaces...
        </div>
      ) : (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Card 1: Node Identity & Noise_XX Cryptography */}
          <div
            style={{
              backgroundColor: '#0f172a',
              borderRadius: 12,
              padding: 14,
              border: '1px solid rgba(56, 189, 248, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
                🔑 Sovereign Node Cryptography
              </span>
              <span
                style={{
                  fontSize: 10,
                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                  color: '#4ade80',
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontWeight: 700,
                }}
              >
                Noise_XX_25519 Active
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#94a3b8' }}>Local Peer ID:</span>
                <span
                  onClick={() => handleCopy(telemetry?.localPeerId || '', 'Peer ID')}
                  style={{
                    fontFamily: 'monospace',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    textDecoration: 'underline dotted',
                  }}
                  title="Click to copy"
                >
                  {telemetry?.localPeerId ? `${telemetry.localPeerId.slice(0, 14)}...` : 'Unknown'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#94a3b8' }}>Noise_XX Key:</span>
                <span
                  onClick={() => handleCopy(telemetry?.localNoiseXxKey || '', 'Noise Key')}
                  style={{
                    fontFamily: 'monospace',
                    color: '#c084fc',
                    cursor: 'pointer',
                    textDecoration: 'underline dotted',
                  }}
                  title="Click to copy"
                >
                  {telemetry?.localNoiseXxKey ? `${telemetry.localNoiseXxKey.slice(0, 16)}...` : 'N/A'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#94a3b8' }}>Master DID:</span>
                <span
                  onClick={() => handleCopy(telemetry?.localDid || '', 'DID')}
                  style={{
                    fontFamily: 'monospace',
                    color: '#94a3b8',
                    cursor: 'pointer',
                  }}
                >
                  {telemetry?.localDid ? `${telemetry.localDid.slice(0, 20)}...` : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Physical Radios (BLE 5.3 + Wi-Fi Direct NAN) */}
          <div
            style={{
              backgroundColor: '#0f172a',
              borderRadius: 12,
              padding: 14,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', marginBottom: 12 }}>
              📻 Active Mesh Radio Interfaces
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.06)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>🔵</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>BLE 5.3 GATT</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>MTU: 512 bytes</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>PHY: 2M LE Coded</div>
                <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginTop: 4 }}>
                  ● ADVERTISING & SCAN
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(168, 85, 247, 0.06)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>🟣</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#c084fc' }}>Wi-Fi Direct NAN</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Band: 5.0 GHz Unlicensed</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Role: Master Anchor</div>
                <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginTop: 4 }}>
                  ● CLUSTER SYNCHRONIZED
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Interactive RF Attenuation Simulator */}
          <div
            style={{
              backgroundColor: '#0f172a',
              borderRadius: 12,
              padding: 14,
              border: '1px solid rgba(245, 158, 11, 0.3)',
              boxShadow: '0 4px 20px rgba(245, 158, 11, 0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>
                🎛️ RF Attenuation & Environmental Simulator
              </span>
              <button
                onClick={() => {
                  setAttenuationDb(0);
                  setPacketLossPct(0);
                  setRangeDecayMeters(50);
                  setMultiHopFallback(true);
                  handleApplyRfSimulation(0, 0, 50, true);
                }}
                style={{
                  background: 'none',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#94a3b8',
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Reset
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Attenuation Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: '#cbd5e1' }}>RF Signal Attenuation:</span>
                  <span style={{ fontWeight: 700, color: attenuationDb > 50 ? '#ef4444' : '#fbbf24' }}>
                    {attenuationDb} dB {attenuationDb >= 60 ? '(Concrete Walls)' : attenuationDb >= 25 ? '(Indoor)' : '(Clear RF)'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="90"
                  step="5"
                  value={attenuationDb}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setAttenuationDb(val);
                    handleApplyRfSimulation(val);
                  }}
                  style={{ width: '100%', accentColor: '#fbbf24', cursor: 'pointer' }}
                />
              </div>

              {/* Packet Loss Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: '#cbd5e1' }}>Artificial Packet Loss:</span>
                  <span style={{ fontWeight: 700, color: packetLossPct > 40 ? '#ef4444' : '#fbbf24' }}>
                    {packetLossPct}% Loss
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={packetLossPct}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setPacketLossPct(val);
                    handleApplyRfSimulation(undefined, val);
                  }}
                  style={{ width: '100%', accentColor: '#f97316', cursor: 'pointer' }}
                />
              </div>

              {/* Range Decay Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: '#cbd5e1' }}>Effective RF Decay Range:</span>
                  <span style={{ fontWeight: 700, color: '#38bdf8' }}>{rangeDecayMeters} Meters</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={rangeDecayMeters}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setRangeDecayMeters(val);
                    handleApplyRfSimulation(undefined, undefined, val);
                  }}
                  style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
                />
              </div>

              {/* Multi-Hop Fallback Toggle */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  padding: '8px 10px',
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
                    Autonomous Multi-Hop Fallback
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>
                    Auto-reroute packets via nearby relays when direct signal drops
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = !multiHopFallback;
                    setMultiHopFallback(next);
                    handleApplyRfSimulation(undefined, undefined, undefined, next);
                  }}
                  style={{
                    backgroundColor: multiHopFallback ? '#10b981' : '#334155',
                    border: 'none',
                    borderRadius: 14,
                    width: 42,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    padding: 2,
                    cursor: 'pointer',
                    justifyContent: multiHopFallback ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      backgroundColor: '#fff',
                      borderRadius: '50%',
                    }}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Card 4: Last Ping Broadcast HUD Results */}
          {lastPingResult && (
            <div
              style={{
                backgroundColor: 'rgba(2, 132, 199, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
                  🎯 Ping Broadcast Receipt: {lastPingResult.pingId}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#4ade80' }}>
                  RTT: {lastPingResult.totalRoundTripMs} ms
                </span>
              </div>

              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
                Responses: {lastPingResult.successfulPongs} / {lastPingResult.totalPings} | Loss:{' '}
                {lastPingResult.lossRatePct}%
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lastPingResult.responses.map(resp => (
                  <div
                    key={resp.responderDid}
                    style={{
                      backgroundColor: 'rgba(0,0,0,0.25)',
                      padding: '6px 10px',
                      borderRadius: 6,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 11,
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{resp.responderHandle}</span>
                      <span style={{ marginLeft: 6, color: '#94a3b8' }}>
                        ({resp.routedViaMultiHop ? `Multi-Hop Relay (${resp.hopCount} hops)` : 'Direct Link'})
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#fbbf24', fontWeight: 600 }}>{resp.rttMs} ms</span>
                      <span style={{ color: '#4ade80' }}>✓ Pong</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Card 5: Connected Peers Matrix */}
          <div
            style={{
              backgroundColor: '#0f172a',
              borderRadius: 12,
              padding: 14,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                👥 Connected Mesh Peers ({telemetry?.peers.length ?? 0})
              </span>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>Dynamic RSSI & Relay Telemetry</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {telemetry?.peers.map(peer => {
                const isRelayed = peer.status === 'MULTI_HOP_FALLBACK';
                const isUnreachable = peer.status === 'UNREACHABLE';

                return (
                  <div
                    key={peer.peerDid}
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      border: `1px solid ${
                        isUnreachable
                          ? 'rgba(239, 68, 68, 0.3)'
                          : isRelayed
                          ? 'rgba(168, 85, 247, 0.4)'
                          : 'rgba(56, 189, 248, 0.2)'
                      }`,
                      borderRadius: 10,
                      padding: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                          {peer.displayName}
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>
                          {peer.handle}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {renderSignalBars(peer.signalBars, peer.status)}
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color:
                              peer.status === 'CONNECTED'
                                ? '#4ade80'
                                : peer.status === 'DEGRADED'
                                ? '#fbbf24'
                                : peer.status === 'MULTI_HOP_FALLBACK'
                                ? '#c084fc'
                                : '#ef4444',
                          }}
                        >
                          {peer.effectiveRssiDbm} dBm
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        fontSize: 10,
                        color: '#94a3b8',
                        gap: 4,
                        paddingTop: 4,
                        borderTop: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      <div>
                        <span style={{ color: '#64748b' }}>Hops: </span>
                        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
                          {peer.hopCount === 0 ? 'Dead' : peer.hopCount === 1 ? '1 (Direct)' : `${peer.hopCount} (Relay)`}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: '#64748b' }}>Distance: </span>
                        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
                          {peer.effectiveDistanceMeters}m
                        </span>
                      </div>
                      <div>
                        <span style={{ color: '#64748b' }}>Relayed: </span>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                          {peer.bytesRelayed} B
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#64748b' }}>
                      Noise PubKey: {peer.noiseXxKey}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
