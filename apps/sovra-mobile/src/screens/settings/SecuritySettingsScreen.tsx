/**
 * @file apps/sovra-mobile/src/screens/settings/SecuritySettingsScreen.tsx
 * Modular Security, Passkeys, ZK Contacts & Privacy Settings Screen.
 */

import React, { useState } from 'react';
import { discoverContacts, type ContactMatch } from '../../services/contact-discovery';

export interface SecuritySettingsScreenProps {
  readonly handle?: string;
  readonly profile?: any;
  readonly onOpenBackupSeed?: () => void;
  readonly onOpenBackup?: () => void;
  readonly onOpenImportSeed?: () => void;
  readonly onOpenImport?: () => void;
  readonly onLogout?: () => void;
  readonly onBack?: () => void;
}

export const SecuritySettingsScreen: React.FC<SecuritySettingsScreenProps> = ({
  handle,
  profile,
  onOpenBackupSeed,
  onOpenBackup,
  onOpenImportSeed,
  onOpenImport,
  onLogout = () => {},
  onBack,
}) => {
  const activeHandle = handle || profile?.handle || '@sovereign';
  const handleBackup = onOpenBackupSeed || onOpenBackup || (() => {});
  const handleImport = onOpenImportSeed || onOpenImport || (() => {});
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [discoveredContacts, setDiscoveredContacts] = useState<ContactMatch[]>([]);

  const handleSyncContacts = async () => {
    setIsSyncing(true);
    setSyncStatus('Reading & hashing contacts locally with SHA-256...');
    try {
      // Mock demo phone contacts normalized for test demonstration
      const sampleContacts = ['+919876543210', '+14155552671', 'alice@sovra.network', 'bob@sovra.network'];
      const res = await discoverContacts(sampleContacts);
      if (res.ok) {
        setDiscoveredContacts(res.matches);
        setSyncStatus(`Discovered ${res.matches.length} peer(s) on SOVRA network!`);
      } else {
        setSyncStatus(res.error || 'Discovery failed');
      }
    } catch (err: any) {
      setSyncStatus(err?.message || 'Sync error');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div style={{ padding: '16px 16px 80px 16px', color: '#f8fafc', maxWidth: 480, margin: '0 auto' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
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
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Security &amp; Privacy</h2>
      </div>

      {/* Passkey Biometrics Status Card */}
      <div
        style={{
          backgroundColor: '#1e293b',
          borderRadius: 16,
          padding: '16px',
          border: '1px solid rgba(255,255,255,0.08)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Hardware Passkey</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              TouchID / FaceID Biometric Enclave &bull; {activeHandle}
            </div>
          </div>
          <span style={{ color: '#10b981', fontSize: 12, fontWeight: 800 }}>ACTIVE ✓</span>
        </div>
      </div>

      {/* Signal-Grade ZK Private Contact Discovery */}
      <div
        style={{
          backgroundColor: '#1e293b',
          borderRadius: 16,
          padding: '16px',
          border: '1px solid rgba(255,255,255,0.08)',
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700 }}>Zero-Knowledge Contact Match</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, marginBottom: 12 }}>
          Find your friends anonymously. Phone numbers are hashed locally with SHA-256 and never transmitted in plaintext.
        </div>
        <button
          onClick={handleSyncContacts}
          disabled={isSyncing}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 10,
            color: '#38bdf8',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {isSyncing ? 'Hashing & Querying...' : '🔍 Sync Contacts Privately'}
        </button>

        {syncStatus && (
          <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 8, textAlign: 'center' }}>
            {syncStatus}
          </div>
        )}

        {discoveredContacts.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {discoveredContacts.map((c, i) => (
              <div
                key={c.did || i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: '#0f172a',
                  padding: '8px 10px',
                  borderRadius: 8,
                }}
              >
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{c.displayName}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{c.handle}</span>
                </div>
                <button
                  style={{
                    backgroundColor: '#10b981',
                    border: 'none',
                    color: '#fff',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Follow
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advanced Seed Phrase Cold Storage */}
      <div
        style={{
          backgroundColor: '#1e293b',
          borderRadius: 16,
          padding: '16px',
          border: '1px solid rgba(255,255,255,0.08)',
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Cold Storage Vault</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>
          Advanced recovery options for sovereign self-custody.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleBackup}
            style={{
              flex: 1,
              padding: '10px 0',
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              color: '#f8fafc',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🔑 Export Seed Phrase
          </button>
          <button
            onClick={handleImport}
            style={{
              flex: 1,
              padding: '10px 0',
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              color: '#94a3b8',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            📥 Import Seed Phrase
          </button>
        </div>
      </div>

      {/* Wipe / Logout */}
      <button
        onClick={onLogout}
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 12,
          color: '#ef4444',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Log Out &amp; Clear Device Session
      </button>
    </div>
  );
};
