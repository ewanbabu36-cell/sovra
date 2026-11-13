/**
 * @file apps/sovra-mobile/src/components/ImportSeedModal.tsx
 * BIP-39 Mnemonic Import & Self-Custody Restoration Modal.
 *
 * Implements:
 * 1. 12-to-24 word input with auto-trimming and whitespace normalization.
 * 2. Real-time BIP-39 dictionary validation and SHA-256 checksum verification.
 * 3. Deterministic keypair restoration and secure keystore upgrade.
 */

import React, { useState, useMemo } from 'react';
import { validateMnemonic, generateWalletFromMnemonic } from '@sovra/crypto';

export interface ImportSeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: (wallet: any) => void;
}

export const ImportSeedModal: React.FC<ImportSeedModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [phrase, setPhrase] = useState('');
  const [accountIndex, setAccountIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const wordCount = useMemo(() => {
    return phrase.trim().split(/\s+/).filter(Boolean).length;
  }, [phrase]);

  const isValidMnemonic = useMemo(() => {
    if (wordCount !== 12 && wordCount !== 24) return false;
    return validateMnemonic(phrase);
  }, [phrase, wordCount]);

  if (!isOpen) return null;

  const handleImport = async () => {
    setError(null);
    const cleanPhrase = phrase.trim().toLowerCase().split(/\s+/).join(' ');

    if (!cleanPhrase) {
      setError('Please paste or type your recovery seed phrase.');
      return;
    }

    if (!isValidMnemonic) {
      setError('Invalid seed phrase. Please ensure all 12 or 24 words are spelled correctly and in order.');
      return;
    }

    setIsImporting(true);
    try {
      const wallet = generateWalletFromMnemonic(cleanPhrase, accountIndex);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('sovra_mesh_priv_key', wallet.privKeyHex);
          localStorage.setItem('sovra_mesh_did', wallet.address);
          localStorage.setItem('sovra_active_mnemonic', cleanPhrase);
          localStorage.setItem('sovra_active_account_index', String(accountIndex));
          localStorage.setItem('sovra_wallet_backed_up', 'true');
        } catch {}
      }

      if (onImportSuccess) {
        onImportSuccess(wallet);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to import wallet from mnemonic');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.88)',
        backdropFilter: 'blur(12px)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: '#0f172a',
          borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.15)',
          padding: 24,
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 25px 50px rgba(0,0,0,0.85)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          color: '#f8fafc',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>📥</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Import Seed Phrase</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
          Restore an existing sovereign wallet by entering your 12 or 24-word BIP-39 recovery phrase separated by spaces.
        </div>

        <div>
          <textarea
            rows={4}
            value={phrase}
            onChange={e => setPhrase(e.target.value)}
            placeholder="e.g. abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 14,
              backgroundColor: '#1e293b',
              border: isValidMnemonic ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: 13,
              lineHeight: 1.6,
              resize: 'none',
              fontFamily: 'monospace',
            }}
          />

          {/* Validation Status Badge */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, fontSize: 11 }}>
            <span style={{ color: wordCount === 12 || wordCount === 24 ? '#38bdf8' : '#94a3b8' }}>
              Words: {wordCount} / 12 or 24
            </span>
            {isValidMnemonic ? (
              <span style={{ color: '#34d399', fontWeight: 700 }}>
                ✓ Valid BIP-39 Seed Phrase
              </span>
            ) : wordCount >= 12 ? (
              <span style={{ color: '#f87171' }}>
                ✗ Checksum or dictionary failure
              </span>
            ) : null}
          </div>
        </div>

        {/* Account Derivation Index */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: '#1e293b', borderRadius: 12 }}>
          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>Account Derivation:</span>
          <select
            value={accountIndex}
            onChange={e => setAccountIndex(Number(e.target.value))}
            style={{
              backgroundColor: '#0f172a',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              borderRadius: 8,
              padding: '4px 8px',
              fontSize: 12,
            }}
          >
            <option value={0}>Account 1 - Personal (m/44'/999'/0'/0')</option>
            <option value={1}>Account 2 - Creator (m/44'/999'/1'/0')</option>
            <option value={2}>Account 3 - Vault (m/44'/999'/2'/0')</option>
          </select>
        </div>

        {error && (
          <div style={{ fontSize: 11, color: '#f87171', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '8px 12px', borderRadius: 8 }}>
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleImport}
          disabled={!isValidMnemonic || isImporting}
          style={{
            width: '100%',
            padding: '12px 0',
            borderRadius: 12,
            backgroundColor: isValidMnemonic ? '#00a884' : '#334155',
            color: '#fff',
            border: 'none',
            fontSize: 13,
            fontWeight: 800,
            cursor: isValidMnemonic ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            boxShadow: isValidMnemonic ? '0 4px 14px rgba(0, 168, 132, 0.35)' : 'none',
          }}
        >
          <span>{isImporting ? 'Importing...' : 'Restore Wallet ➔'}</span>
        </button>
      </div>
    </div>
  );
};
