/**
 * @file apps/sovra-app/src/modules/wallet-crypto.ts
 * Sovra Modular Client: Sovereign Cryptographic Wallet & Token Transacting
 */

export interface WalletState {
  did: string;
  balanceSov: number;
  tokens: Record<string, number>;
}

export function initWalletCryptoModule(): void {
  if (typeof window === 'undefined') return;

  (window as any).SovraWalletEngine = {
    async transferSov(recipientDidOrHandle: string, amountSov: number): Promise<{ ok: boolean; txHash?: string; error?: string }> {
      try {
        const res = await fetch('/api/wallet/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: recipientDidOrHandle,
            amount: Number(amountSov),
          }),
        });
        const data = await res.json();
        return data;
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },

    openTipModal(targetType: string, targetId: string, meta: { creatorName?: string; creatorHandle?: string } = {}): void {
      const modal = document.getElementById('sovereignTipModal');
      if (modal) {
        modal.style.display = 'flex';
        const nameEl = document.getElementById('tipTargetCreatorName');
        if (nameEl) nameEl.textContent = meta.creatorName || meta.creatorHandle || 'Creator';
      }
    },

    closeTipModal(): void {
      const modal = document.getElementById('sovereignTipModal');
      if (modal) modal.style.display = 'none';
    },
  };

  // Global aliases for HTML template onclicks
  (window as any).openCreatorSovTipModal = function(targetType: string, targetId: string, meta?: any): void {
    (window as any).SovraWalletEngine.openTipModal(targetType, targetId, meta);
  };
  (window as any).closeCreatorSovTipModal = function(): void {
    (window as any).SovraWalletEngine.closeTipModal();
  };

  (window as any).verifyMerkleReceipt = async function(cid: string, rootHash: string): Promise<void> {
    const modal = document.getElementById('merkleProofModal');
    if (modal) modal.style.display = 'flex';
    const cidEl = document.getElementById('merkleCidDisplay');
    if (cidEl) cidEl.textContent = cid;
  };
  (window as any).closeMerkleProofModal = function(): void {
    const modal = document.getElementById('merkleProofModal');
    if (modal) modal.style.display = 'none';
  };

  console.log('[Sovra] Wallet & Crypto module initialized.');
}
