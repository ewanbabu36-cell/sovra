/**
 * @file apps/sovra-mobile/src/components/BackupSeedModal.tsx
 * BIP-39 12-Word Mnemonic Backup & Self-Custody Verification Modal.
 *
 * Implements:
 * 1. Numbered 12-word seed phrase layout with privacy blur/reveal toggle.
 * 2. 1-click clipboard copy with security warning regarding clipboard snooping.
 * 3. 3-word verification quiz (e.g. Word #3, #7, #11) before marking wallet as backed up.
 * 4. Persistent backup status storage.
 */

import React, { useState, useMemo } from 'react';

export interface BackupSeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  mnemonic: string;
  onBackupConfirmed?: () => void;
}

export const BackupSeedModal: React.FC<BackupSeedModalProps> = ({
  isOpen,
  onClose,
  mnemonic,
  onBackupConfirmed,
}) => {
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [quizStep, setQuizStep] = useState(false);
  const [answer1, setAnswer1] = useState('');
  const [answer2, setAnswer2] = useState('');
  const [answer3, setAnswer3] = useState('');
  const [quizError, setQuizError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const words = useMemo(() => {
    return mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }, [mnemonic]);

  // Deterministic quiz word indexes: 3 (idx 2), 7 (idx 6), 11 (idx 10)
  const targetIdx1 = 2; // Word #3
  const targetIdx2 = 6; // Word #7
  const targetIdx3 = 10; // Word #11

  if (!isOpen) return null;

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(words.join(' '));
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleVerifyQuiz = () => {
    setQuizError(null);
    const a1 = answer1.trim().toLowerCase();
    const a2 = answer2.trim().toLowerCase();
    const a3 = answer3.trim().toLowerCase();

    if (a1 !== words[targetIdx1] || a2 !== words[targetIdx2] || a3 !== words[targetIdx3]) {
      setQuizError('One or more words do not match your seed phrase. Please double check and try again.');
      return;
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('sovra_wallet_backed_up', 'true');
      } catch {}
    }
    setIsSuccess(true);
    if (onBackupConfirmed) onBackupConfirmed();
    setTimeout(() => {
      setIsSuccess(false);
      setQuizStep(false);
      onClose();
    }, 1500);
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
            <span style={{ fontSize: 20 }}>🛡️</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Backup Recovery Phrase</span>
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

        {!quizStep ? (
          <>
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
              Your 12-word recovery phrase is the <strong style={{ color: '#38bdf8' }}>only master key</strong> to your wallet and assets. Store it securely offline. Anyone with these words can take your funds.
            </div>

            {/* Word Grid with Blur/Reveal */}
            <div
              style={{
                position: 'relative',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
                padding: 12,
                backgroundColor: '#1e293b',
                borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {words.map((word, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: '#0f172a',
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    filter: isRevealed ? 'none' : 'blur(5px)',
                    transition: 'filter 0.3s ease',
                  }}
                >
                  <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700, width: 16 }}>
                    {idx + 1}.
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', letterSpacing: 0.2 }}>
                    {word}
                  </span>
                </div>
              ))}

              {!isRevealed && (
                <div
                  onClick={() => setIsRevealed(true)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(15, 23, 42, 0.75)',
                    borderRadius: 16,
                    cursor: 'pointer',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 24 }}>👁️</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#f8fafc' }}>
                    Tap to Reveal Seed Phrase
                  </span>
                </div>
              )}
            </div>

            {/* Actions: Reveal Toggle & Copy */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setIsRevealed(!isRevealed)}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 12,
                  backgroundColor: '#1e293b',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#f8fafc',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>{isRevealed ? '🙈 Blur' : '👁️ Reveal'}</span>
              </button>
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 12,
                  backgroundColor: copied ? '#059669' : '#1e293b',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#f8fafc',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>{copied ? '✓' : '📋'}</span>
                <span>{copied ? 'Copied!' : 'Copy Phrase'}</span>
              </button>
            </div>

            <div style={{ fontSize: 10, color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(245, 158, 11, 0.25)' }}>
              ⚠️ <strong>Security Notice:</strong> Avoid saving your seed phrase in unencrypted notes or cloud storage. Write it down on paper.
            </div>

            {/* Next: Verification Quiz */}
            <button
              type="button"
              onClick={() => {
                setIsRevealed(false);
                setQuizStep(true);
              }}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 12,
                backgroundColor: '#00a884',
                color: '#fff',
                border: 'none',
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                boxShadow: '0 4px 12px rgba(0, 168, 132, 0.35)',
              }}
            >
              <span>Verify &amp; Confirm Backup ➔</span>
            </button>
          </>
        ) : (
          /* Quiz Step: Confirm words #3, #7, #11 */
          <>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              Confirm your backup by entering the corresponding words below:
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>Word #{targetIdx1 + 1}</label>
                <input
                  type="text"
                  value={answer1}
                  onChange={e => setAnswer1(e.target.value)}
                  placeholder={`Enter word #${targetIdx1 + 1}`}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: '#1e293b',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    fontSize: 13,
                    marginTop: 4,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>Word #{targetIdx2 + 1}</label>
                <input
                  type="text"
                  value={answer2}
                  onChange={e => setAnswer2(e.target.value)}
                  placeholder={`Enter word #${targetIdx2 + 1}`}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: '#1e293b',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    fontSize: 13,
                    marginTop: 4,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>Word #{targetIdx3 + 1}</label>
                <input
                  type="text"
                  value={answer3}
                  onChange={e => setAnswer3(e.target.value)}
                  placeholder={`Enter word #${targetIdx3 + 1}`}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: '#1e293b',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    fontSize: 13,
                    marginTop: 4,
                  }}
                />
              </div>
            </div>

            {quizError && (
              <div style={{ fontSize: 11, color: '#f87171', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '8px 12px', borderRadius: 8 }}>
                {quizError}
              </div>
            )}

            {isSuccess && (
              <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', backgroundColor: 'rgba(52, 211, 153, 0.15)', padding: '10px 12px', borderRadius: 8, textAlign: 'center' }}>
                ✓ Seed Phrase Verified! Wallet marked as securely backed up.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setQuizStep(false)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 10,
                  backgroundColor: '#1e293b',
                  color: '#94a3b8',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleVerifyQuiz}
                style={{
                  flex: 2,
                  padding: '10px 0',
                  borderRadius: 10,
                  backgroundColor: '#10b981',
                  color: '#0f172a',
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Confirm Verification
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
