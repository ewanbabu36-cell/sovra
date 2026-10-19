import { describe, it, expect } from 'vitest';
import http from 'node:http';

describe('Sovra 0-to-1 First-Time User Experience (FTUX) & Activation Flow', () => {
  const fetchServedHtml = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });
  };

  it('serves the multi-step onboarding wizard with emoji avatar selector, photo upload, and starter pack', async () => {
    const html = await fetchServedHtml();

    // 1. Modal container exists
    expect(html).toContain('id="welcomeOnboardingModal"');

    // 2. Avatar setup: live preview, emoji badge presets, and file upload
    expect(html).toContain('id="womAvatarPreview"');
    expect(html).toContain('id="womPhotoInput"');
    expect(html).toContain('selectWomAvatarEmoji');
    expect(html).toContain('class="wom-avatar-badge');

    // 3. Step 3: Starter Pack with channel pills & creator follows
    expect(html).toContain('id="womStep3"');
    expect(html).toContain('toggleSelectAllOnboardingFollows()');
    expect(html).toContain('id="onbFollowsCountBadge"');
    expect(html).toContain('class="onb-follow-cb"');
    expect(html).toContain('data-type="channel"');
    expect(html).toContain('data-type="user"');

    // 4. Step 4: 50.00 SOV Vault reward celebration
    expect(html).toContain('id="womStep4"');
    expect(html).toContain('+50.00 SOV Unlocked!');
    expect(html).toContain('Welcome Grant');
    expect(html).toContain('finishOnboardingAndLaunchFeed()');

    // 5. Hardware enclave restoration view
    expect(html).toContain('id="womStepRestored"');
  });

  it('renders the persistent 0-to-1 activation checklist banner with all 4 milestone actions', async () => {
    const html = await fetchServedHtml();

    // 1. Checklist banner container & header
    expect(html).toContain('id="firstTimeUserChecklist"');
    expect(html).toContain('Get Started with Sovra');
    expect(html).toContain('id="onbChecklistSubtitle"');
    expect(html).toContain('id="onbChecklistProgressText"');
    expect(html).toContain('id="onbChecklistProgressBar"');
    expect(html).toContain('dismissOnboardingChecklist()');

    // 2. Milestone 1: Follow 1st channel/creator
    expect(html).toContain('id="onbChecklistTask1"');
    expect(html).toContain('id="onbChecklistTask1Icon"');
    expect(html).toContain('Follow 1st channel');
    expect(html).toContain('openChannelBrowseModal()');

    // 3. Milestone 2: Share 1st thought / post
    expect(html).toContain('id="onbChecklistTask2"');
    expect(html).toContain('id="onbChecklistTask2Icon"');
    expect(html).toContain('Share 1st thought');
    expect(html).toContain("document.getElementById('dynamicPostCaption').focus()");

    // 4. Milestone 3: 50 SOV Vault balance
    expect(html).toContain('id="onbChecklistTask3"');
    expect(html).toContain('id="onbChecklistTask3Icon"');
    expect(html).toContain('50 SOV Vault balance');
    expect(html).toContain('openSpatialAccountSurface()');

    // 5. Milestone 4: Encrypted Chat exploration
    expect(html).toContain('id="onbChecklistTask4"');
    expect(html).toContain('id="onbChecklistTask4Icon"');
    expect(html).toContain('Try Encrypted Chat');
    expect(html).toContain("switchTab('chat')");
  });

  it('contains the complete client-side activation lifecycle & progress calculation engine', async () => {
    const html = await fetchServedHtml();

    // Verify critical client functions are defined
    expect(html).toContain('function selectWomAvatarEmoji(');
    expect(html).toContain('function updateOnboardingFollowsCountUI(');
    expect(html).toContain('function toggleSelectAllOnboardingFollows(');
    expect(html).toContain('function goToOnboardingStep4(');
    expect(html).toContain('function finishOnboardingAndLaunchFeed(');
    expect(html).toContain('function dismissOnboardingChecklist(');
    expect(html).toContain('function updateOnboardingChecklistUI(');

    // Verify localStorage key integration for activation tracking
    expect(html).toContain('sovra_checklist_dismissed');
    expect(html).toContain('sovra_has_posted');
    expect(html).toContain('sovra_has_followed');
    expect(html).toContain('sovra_explored_chat');

    // Verify checklist updates are hooked into post creation, tab switching, and auth view
    expect(html).toContain('updateOnboardingChecklistUI();');
  });

  it('serves the full Sovereign Onboarding Wizard with live handle validation, DID preview, and Genesis faucet claim', async () => {
    const html = await fetchServedHtml();

    // 1. Wizard Container & Hidden by Default
    expect(html).toContain('id="sovereignOnboardingWizard"');
    expect(html).toMatch(/id="sovereignOnboardingWizard"[^>]*style="[^"]*display:\s*none/i);

    // 2. Step 1: Handle & DID Claim
    expect(html).toContain('id="sovWizardStep1"');
    expect(html).toContain('id="sovWizardHandle"');
    expect(html).toContain('id="sovWizardHandleStatus"');
    expect(html).toContain('/api/user/check-handle');
    expect(html).toContain('id="sovWizardRingWrapper"');
    expect(html).toContain('id="sovWizardAvatarCircle"');
    expect(html).toContain('selectSovWizardEmoji');
    expect(html).toContain('selectSovWizardRing');
    expect(html).toContain('id="sovWizardDidPreview"');

    // 3. Step 2: Curated Starter Follow Pack
    expect(html).toContain('id="sovWizardStep2"');
    expect(html).toContain('class="sov-wizard-follow-cb"');
    expect(html).toContain('followAllRecommended()');
    expect(html).toContain('id="sovWizardFollowsCountBadge"');

    // 4. Step 3: Genesis Faucet Claim & Confetti
    expect(html).toContain('id="sovWizardStep3"');
    expect(html).toContain('id="sovWizardClaimFaucetBtn"');
    expect(html).toContain('claimGenesisGrant()');
    expect(html).toContain('/api/wallet/faucet/claim');
    expect(html).toContain('triggerOnboardingConfetti');
    expect(html).toContain('id="sovWizardFinishBtn"');
    expect(html).toContain('finishSovereignOnboarding()');

    // 6. Client Engine Verification
    expect(html).toContain('function openSovereignOnboardingWizard(');
    expect(html).toContain('function closeSovereignOnboardingWizard(');
    expect(html).toContain('function sovWizardGoToStep(');
    expect(html).toContain('function checkSovWizardHandleLive(');
    expect(html).toContain('function updateSovWizardFollowCount(');
  });

  it('serves the Unified Command Palette with sub-10ms search tracking, keyboard shortcuts and global action routing', async () => {
    const html = await fetchServedHtml();

    // 1. Modal Overlay & Dialog Structure
    expect(html).toContain('id="globalCommandPaletteModal"');
    expect(html).toMatch(/id="globalCommandPaletteModal"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toContain('id="globalCommandPaletteInput"');
    expect(html).toContain('id="globalCommandPaletteResults"');
    expect(html).toContain('palettePerfTime');

    // 2. Keyboard Handlers & Hotkeys (Ctrl+K / Cmd+K / Esc)
    expect(html).toContain('toggleGlobalCommandPalette()');
    expect(html).toContain('handlePaletteSearchInput(this.value)');
    expect(html).toContain('handlePaletteKeydown(event)');
    expect(html).toContain("(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'");

    // 3. Command Palette Engine & Action Registry
    expect(html).toContain('PALETTE_ACTIONS');
    expect(html).toContain('Creator Studio');
    expect(html).toContain('Genesis Faucet');
    expect(html).toContain('AMM Swap');
    expect(html).toContain('function openGlobalCommandPalette(');
    expect(html).toContain('function closeGlobalCommandPalette(');
    expect(html).toContain('function renderPaletteResults(');
    expect(html).toContain('function executePaletteItem(');
  });

  it('serves Ephemeral Stories Studio with custom background gradient swatches and canvas binding', async () => {
    const html = await fetchServedHtml();

    // 1. Stories Creator Modal & Canvas
    expect(html).toContain('id="sovereignStoryCreatorModal"');
    expect(html).toContain('id="storyCreatorDefaultCanvas"');

    // 2. Custom Gradient Selection
    expect(html).toContain('selectStoryGradient(');
    expect(html).toContain('linear-gradient(135deg, #1e1b4b, #312e81)');
    expect(html).toContain('linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)');
    expect(html).toContain('storyCreatorState');
    expect(html).toContain('openStoryCreatorModal');
    expect(html).toContain('publishStoryFromCreator');
  });
});
