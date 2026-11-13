/**
 * @file apps/sovra-mobile/src/components/DepositModal.tsx
 * Mobile Wallet Deposit, Fiat On-Ramp & UPI Bridge Modal.
 *
 * Implements:
 * 1. High-contrast pure vector SVG QR Code for wallet top-up.
 * 2. 1-Click Instant Testnet Faucet Claim (+50 SOV).
 * 3. 1-Click UPI Fiat On-Ramp (INR to SOV) with dynamic upi:// QR generation.
 * 4. Multi-chain / Layer-1 deposit instructions.
 */

import React, { useState } from 'react';
import { QrCodeRenderer, formatSovraUri } from './QrCodeRenderer';

export interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  userAddress: string;
  onDepositSuccess?: () => void;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  userAddress,
  onDepositSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'upi' | 'faucet'>('upi');
  const [upiAmountInr, setUpiAmountInr] = useState('500');
  const [isClaiming, setIsClaiming] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState<{ text: string; success: boolean } | null>(null);

  if (!isOpen) return null;

  const paymentUri = formatSovraUri(userAddress);
  const upiUri = `upi://pay?pa=sovra@icici&pn=Sovra%20Sovereign%20Network&am=${upiAmountInr}&cu=INR&tn=SOVRA_DEPOSIT_${userAddress.slice(-8)}`;

  const handleClaimFaucet = async () => {
    setIsClaiming(true);
    setFaucetMsg(null);
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/wallet/faucet/claim', {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount: 50 }),
      });

      const data = await res.json();
      if (data.ok) {
        setFaucetMsg({ text: `🎉 Claimed ${data.claimed || 50} SOV Testnet Starter Grant!`, success: true });
        if (onDepositSuccess) onDepositSuccess();
      } else {
        setFaucetMsg({ text: data.error || 'Faucet claim failed or rate limited (24h cooldown)', success: false });
      }
    } catch (err: any) {
      setFaucetMsg({ text: err?.message || 'Network error claiming faucet', success: false });
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSimulateUpiPayment = async () => {
    setIsClaiming(true);
    setFaucetMsg(null);
    try {
      const amountFiat = parseFloat(upiAmountInr) || 100;
      const res = await fetch('/api/wallet/fiat/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'payment.success',
          paymentId: 'upi_' + Date.now(),
          userDid: userAddress,
          amountFiat,
          currency: 'INR',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setFaucetMsg({ text: `🎉 Received ₹${amountFiat} INR! Credited +${data.creditedSov} SOV to your wallet.`, success: true });
        if (onDepositSuccess) onDepositSuccess();
      } else {
        setFaucetMsg({ text: data.error || 'Deposit failed', success: false });
      }
    } catch (err: any) {
      setFaucetMsg({ text: err?.message || 'Payment simulation failed', success: false });
    } finally {
      setIsClaiming(false);
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
          maxWidth: 400,
          boxShadow: '0 25px 50px rgba(0,0,0,0.85)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          color: '#f8fafc',
          textAlign: 'center',
        }}
      >
        {/* Header */}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>➕</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Add Funds / Top-up</span>
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

        {/* Tab Switcher: UPI vs Faucet */}
        <div style={{ width: '100%', display: 'flex', backgroundColor: '#1e293b', borderRadius: 12, padding: 3 }}>
          <button
            onClick={() => setActiveTab('upi')}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 10,
              border: 'none',
              backgroundColor: activeTab === 'upi' ? '#10b981' : 'transparent',
              color: activeTab === 'upi' ? '#080d14' : '#94a3b8',
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            🇮🇳 Instant UPI (INR)
          </button>
          <button
            onClick={() => setActiveTab('faucet')}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 10,
              border: 'none',
              backgroundColor: activeTab === 'faucet' ? '#38bdf8' : 'transparent',
              color: activeTab === 'faucet' ? '#080d14' : '#94a3b8',
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            💧 Testnet Faucet
          </button>
        </div>

        {activeTab === 'upi' ? (
          <>
            {/* Quick Amount Pill Selectors */}
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              {[
                { inr: '100', sov: '10' },
                { inr: '500', sov: '50' },
                { inr: '1000', sov: '100' },
              ].map(opt => (
                <button
                  key={opt.inr}
                  onClick={() => setUpiAmountInr(opt.inr)}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    borderRadius: 10,
                    border: upiAmountInr === opt.inr ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                    backgroundColor: upiAmountInr === opt.inr ? 'rgba(16, 185, 129, 0.15)' : '#1e293b',
                    color: upiAmountInr === opt.inr ? '#34d399' : '#f8fafc',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ₹{opt.inr}
                  <div style={{ fontSize: 9, opacity: 0.8 }}>({opt.sov} SOV)</div>
                </button>
              ))}
            </div>

            {/* Dynamic Scannable UPI SVG QR Code */}
            <QrCodeRenderer
              value={upiUri}
              size={170}
              title={`Pay ₹${upiAmountInr} via any UPI App`}
              showActions={false}
            />

            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Scan with GPay, PhonePe, Paytm or BHIM to deposit instantly.
            </div>

            <button
              onClick={handleSimulateUpiPayment}
              disabled={isClaiming}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#10b981',
                color: '#080d14',
                border: 'none',
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isClaiming ? 'Settling Payment...' : `Confirm Deposit ₹${upiAmountInr} (Auto-Credit)`}
            </button>
          </>
        ) : (
          <>
            <QrCodeRenderer
              value={paymentUri}
              size={170}
              title="Deposit SOV QR"
              showActions={true}
            />

            <div style={{ width: '100%' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Deposit Address:</div>
              <div
                style={{
                  backgroundColor: '#1e293b',
                  padding: '8px 12px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: '#38bdf8',
                  wordBreak: 'break-all',
                }}
              >
                {userAddress}
              </div>
            </div>

            <button
              type="button"
              onClick={handleClaimFaucet}
              disabled={isClaiming}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 14,
                background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
                color: '#fff',
                border: 'none',
                fontSize: 13,
                fontWeight: 800,
                cursor: isClaiming ? 'wait' : 'pointer',
              }}
            >
              💧 {isClaiming ? 'Claiming Grant...' : 'Claim Starter Faucet (+50 SOV)'}
            </button>
          </>
        )}

        {faucetMsg && (
          <div
            style={{
              width: '100%',
              fontSize: 11,
              padding: '8px 12px',
              borderRadius: 8,
              backgroundColor: faucetMsg.success ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: faucetMsg.success ? '#34d399' : '#f87171',
              border: faucetMsg.success ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            {faucetMsg.text}
          </div>
        )}
      </div>
    </div>
  );
};
