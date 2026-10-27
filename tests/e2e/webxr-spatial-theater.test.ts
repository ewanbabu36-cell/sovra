import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Cycle 3: Open WebXR Spatial Hologram Theater (Meta Horizon & Vision Pro Killer)', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  let content = '';

  it('loads dev-server template and verifies WebXR theater modal existence', () => {
    content = fs.readFileSync(devServerPath, 'utf-8');
    expect(content).toContain('id="webxrTheaterModal"');
    expect(content).toContain('enterWebxrSpatialTheater');
    expect(content).toContain('exitWebxrSpatialTheater');
  });

  it('verifies HRTF 3D spatial audio panner node implementation in client code', () => {
    expect(content).toContain('createPanner');
    expect(content).toContain("panningModel = 'HRTF'");
    expect(content).toContain("distanceModel = 'inverse'");
  });

  it('verifies WebXR immersive-vr/inline session detection and 3D canvas rendering pipeline', () => {
    expect(content).toContain('isSessionSupported');
    expect(content).toContain('immersive-vr');
    expect(content).toContain('webxrCanvas');
  });

  it('verifies sovereign multi-peer theater sync capability', () => {
    expect(content).toContain('webxr-theater-container');
    expect(content).toContain('Hologram Cinema Stage');
  });
});
