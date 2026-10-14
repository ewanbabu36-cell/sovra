import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 2: Background Audio, Lock-Screen MediaSession & Web Audio DSP Reels Mixer', () => {
  const devServerPath = path.resolve(process.cwd(), 'scripts/dev-server.ts');
  const source = fs.readFileSync(devServerPath, 'utf-8');

  it('includes Phase 2 Background Audio & Spatial Mixer Studio HTML controls', () => {
    expect(source).toContain('id="reelBgAudioToggleBtn"');
    expect(source).toContain('id="reelBgAudioBtnLabel"');
    expect(source).toContain('id="audioSheetBgToggleBtn"');
    expect(source).toContain('id="audioEqPresetGroup"');
    expect(source).toContain('data-eq="flat"');
    expect(source).toContain('data-eq="bass"');
    expect(source).toContain('data-eq="vocal"');
    expect(source).toContain('data-eq="spatial"');
    expect(source).toContain('id="reelOriginalGainSlider"');
    expect(source).toContain('id="reelSynthBeatToggleBtn"');
  });

  it('includes the Global Floating Background Audio Mini-Player Bar (#sovraBgAudioMiniBar)', () => {
    expect(source).toContain('id="sovraBgAudioMiniBar"');
    expect(source).toContain('id="bgMiniBarTitle"');
    expect(source).toContain('id="bgMiniBarSubtitle"');
    expect(source).toContain('id="bgMiniBarEqBadge"');
    expect(source).toContain('id="bgMiniBarPlayBtn"');
    expect(source).toContain('bgAudioPrevTrack()');
    expect(source).toContain('bgAudioTogglePlay()');
    expect(source).toContain('bgAudioNextTrack()');
    expect(source).toContain('stopSovraBackgroundAudio()');
    expect(source).toContain('returnToBgAudioSourceTab()');
  });

  it('implements window.SovraBackgroundAudioEngine with Web Audio API BiquadFilterNode DSP chain', () => {
    expect(source).toContain('window.SovraBackgroundAudioEngine = {');
    expect(source).toContain('createBiquadFilter()');
    expect(source).toContain("this.lowShelfNode.type = 'lowshelf'");
    expect(source).toContain("this.midPeakNode.type = 'peaking'");
    expect(source).toContain("this.highShelfNode.type = 'highshelf'");
    expect(source).toContain('createMediaElementSource(activeVideo)');
    expect(source).toContain('applyEqFilterValues: function(preset)');
  });

  it('wires W3C navigator.mediaSession lock-screen metadata and hardware transport controls', () => {
    expect(source).toContain('function syncSovraMediaSession()');
    expect(source).toContain('navigator.mediaSession.metadata = new MediaMetadata');
    expect(source).toContain("navigator.mediaSession.setActionHandler('play'");
    expect(source).toContain("navigator.mediaSession.setActionHandler('pause'");
    expect(source).toContain("navigator.mediaSession.setActionHandler('previoustrack'");
    expect(source).toContain("navigator.mediaSession.setActionHandler('nexttrack'");
  });

  it('preserves Reels and Watch audio playback across tab switches when Background Audio is enabled', () => {
    expect(source).toContain('window.SovraBackgroundAudioEngine.activateMiniBar(\'reels\')');
    expect(source).toContain('window.SovraBackgroundAudioEngine.activateMiniBar(\'youtube\')');
    expect(source).toContain('window.SovraBackgroundAudioEngine.hideMiniBar()');
  });
});
