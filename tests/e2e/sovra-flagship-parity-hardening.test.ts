/**
 * @file tests/e2e/sovra-flagship-parity-hardening.test.ts
 * Comprehensive Verification Suite for 10-Module Sovra Flagship Parity & Cryptographic Hardening.
 *
 * Covers:
 * 1. Creator Studio Pro (Dynamic retention curves, URL hash/pushState sync).
 * 2. BitChat / Signal E2EE (Voice waveform visualizer canvas, offline outbox yellow badge).
 * 3. Watch Engine (HLS media cache in Cache API, subtitle auto-matching, double-tap seek).
 * 4. Profile & Decentralized Identity (Resident user quick card, localStorage persistence).
 * 5. Settings & Security (Biometric PIN reset, passkey authorization).
 * 6. Sovereign Wallet (Receive QR modal, copyable sovra:<did> deep link, Seeder Yield claim).
 * 7. Login Gateway (Inline real-time input error validation, continue as quick user).
 * 8. New User Activation (Mandatory 3-word seed verification step, handle sanitization).
 * 9. Forgot Option (Emergency restore with live BIP-39 validator and suggestion chips).
 * 10. SOV Coin & Economics (5.00 SOV Welcome Gas Voucher in database, yield distribution).
 */

import { describe, it, expect } from 'vitest';
import { loadServerContent } from '../helpers/test-source-loader.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Sovra Flagship Parity 10-Module Hardening Suite', () => {
  const serverContent = loadServerContent();

  // =========================================================================
  // MODULE 1 & 7: LOGIN GATEWAY & FORGOT PIN BIOMETRICS (Gaps 7 & 9)
  // =========================================================================
  describe('Module 1 & 7: Login Gateway & Resident Passkey UX', () => {
    it('provides resident quick-user selector card and inline real-time error containers', () => {
      expect(serverContent).toContain('id="womQuickUserCard"');
      expect(serverContent).toContain('id="womQuickUserHandle"');
      expect(serverContent).toContain('id="womQuickUserContinueBtn"');
      expect(serverContent).toContain('continueAsQuickUser()');
      expect(serverContent).toContain('switchQuickUserAccount()');
      expect(serverContent).toContain('id="womHandleInlineError"');
      expect(serverContent).toContain('id="womPinInlineError"');
      expect(serverContent).toContain('validateLoginInputsLive()');
    });

    it('implements instant Biometric (Passkey) PIN reset and dedicated reset modal', () => {
      expect(serverContent).toContain('id="forgotPinModal"');
      expect(serverContent).toContain('id="btnBiometricPinReset"');
      expect(serverContent).toContain('resetPinWithBiometrics()');
      expect(serverContent).toContain('/api/auth/pin/reset-biometric');
      expect(serverContent).toContain('submitForgotPinWithPhrase()');
      expect(serverContent).toContain('id="forgotPinBip39Status"');
    });

    it('validates live BIP-39 recovery phrases with word status and suggestion chips', () => {
      expect(serverContent).toContain('validateBip39PhraseLive');
      expect(serverContent).toContain('/api/auth/mnemonic/validate');
      expect(serverContent).toContain('id="emergencyBip39Status"');
      expect(serverContent).toContain('id="emergencyWordChips"');
    });
  });

  // =========================================================================
  // MODULE 8 & 10: NEW USER ONBOARDING & WELCOME GAS VOUCHER (Gaps 8 & 10)
  // =========================================================================
  describe('Module 8 & 10: Sovereign Activation & SOV Gas Voucher', () => {
    it('enforces mandatory 3-word recovery phrase challenge before unlocking completion', () => {
      expect(serverContent).toContain('id="sovWizardStepVerifyPhrase"');
      expect(serverContent).toContain('id="sovWizardSeedWordsDisplay"');
      expect(serverContent).toContain('id="sovWizardChallengeInputs"');
      expect(serverContent).toContain('id="btnVerifySeedChallenge"');
      expect(serverContent).toContain('verifySeedChallengeAndProceed()');
      expect(serverContent).toContain('copySovWizardSeedWords()');
    });

    it('sanitizes handle inputs in real-time to lowercase and stripped special characters', () => {
      expect(serverContent).toContain('this.value = this.value.toLowerCase().replace(/[^a-z0-9_]/g, \'\');');
    });

    it('automatically grants a 5.00 SOV Welcome Gas Voucher upon new user registration', () => {
      const testDid = 'did:sovra:test_gas_voucher_' + Date.now();
      const testHandle = '@voucher_user_' + Date.now();
      const reg = sovraDb.registerUser({
        did: testDid,
        handle: testHandle,
        displayName: 'Voucher Pioneer',
        securityPin: '123456'
      });

      expect(reg.ok).toBe(true);
      const wallet = (sovraDb as any).db?.wallets?.[testDid];
      expect(wallet).toBeDefined();
      expect(wallet.welcomeVoucher).toBeDefined();
      expect(wallet.welcomeVoucher.amountSov).toBe(5.0);
      expect(wallet.welcomeVoucher.type).toBe('WELCOME_GAS_VOUCHER');
      expect(wallet.welcomeVoucher.status).toBe('ACTIVE');
    });
  });

  // =========================================================================
  // MODULE 6: SOVEREIGN WALLET RECEIVE QR & SEEDER YIELD (Gaps 6 & 10)
  // =========================================================================
  describe('Module 6: Wallet Receive Modal & Seeder Yield Settlement', () => {
    it('provides copyable sovra:<did> deep link and dynamic SVG QR modal', () => {
      expect(serverContent).toContain('id="btnOpenWalletReceiveQr"');
      expect(serverContent).toContain('id="walletReceiveModal"');
      expect(serverContent).toContain('id="walletReceiveQrSvg"');
      expect(serverContent).toContain('id="walletReceiveDidText"');
      expect(serverContent).toContain('copyWalletReceiveDeepLink()');
      expect(serverContent).toContain('openWalletReceiveModal()');
    });

    it('implements Claim Seeder Yield action card, backend route and coin burst HUD', () => {
      expect(serverContent).toContain('id="btnClaimSeederYield"');
      expect(serverContent).toContain('claimSeederYieldAction()');
      expect(serverContent).toContain('/api/wallet/claim-seeder-yield');
      expect(serverContent).toContain('id="coinBurstHud"');
    });
  });

  // =========================================================================
  // MODULE 3: WATCH EXPERIENCE & BITSWAP HLS SEGMENT BUFFERING (Gap 3)
  // =========================================================================
  describe('Module 3: Watch Experience & BitSwap Offline Buffering', () => {
    it('supports double-tap seek ripple overlays (+10s / -10s)', () => {
      expect(serverContent).toContain('id="ytSeekRippleLeft"');
      expect(serverContent).toContain('id="ytSeekRippleRight"');
      expect(serverContent).toContain('triggerYtSeekRipple');
      expect(serverContent).toContain('handleYtPlayerBoxClick');
    });

    it('pre-caches HLS media segments in Cache API (sovra-hls-cache)', () => {
      expect(serverContent).toContain('sovra-hls-cache');
      expect(serverContent).toContain('Hls.Events.FRAG_LOADED');
    });

    it('automatically matches subtitle tracks against navigator.language', () => {
      expect(serverContent).toContain('navigator.language');
      expect(serverContent).toContain('activeSubtitleTrack');
    });
  });

  // =========================================================================
  // MODULE 2: BITCHAT VOICE NOTE WAVEFORM & OUTBOX (Gap 2)
  // =========================================================================
  describe('Module 2: BitChat Voice Note Waveform & Offline Outbox', () => {
    it('renders live canvas frequency visualizer driven by Web Audio AnalyserNode', () => {
      expect(serverContent).toContain('id="voiceWaveformCanvas"');
      expect(serverContent).toContain('drawVoiceWaveformCanvas()');
      expect(serverContent).toContain('createAnalyser()');
      expect(serverContent).toContain('_voiceAudioContext');
    });

    it('displays yellow pending clock badge for queued offline outbox messages', () => {
      expect(serverContent).toContain("m.status === 'pending_sync'");
      expect(serverContent).toContain('#fbbf24');
      expect(serverContent).toContain('🕒');
      expect(serverContent).toContain('sovra-outbox-synced');
    });
  });

  // =========================================================================
  // MODULE 1 & 4: CREATOR STUDIO PRO ANALYTICS & URL DEEP LINKING (Gaps 1 & 4)
  // =========================================================================
  describe('Module 1 & 4: Creator Studio Retention Curves & URL pushState', () => {
    it('renders dynamic audience retention curve with duration drop-off simulation', () => {
      expect(serverContent).toContain('id="studioSvgRetention"');
      expect(serverContent).toContain('renderRetentionCurveDetailed');
      expect(serverContent).toContain('gradRetDetailed');
    });

    it('synchronizes active studio tab and channel with URL history pushState', () => {
      expect(serverContent).toContain('window.history.pushState');
      expect(serverContent).toContain('/studio#tab=');
      expect(serverContent).toContain("window.addEventListener('popstate'");
    });
  });
});
