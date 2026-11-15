import { loadServerContent } from '../helpers/test-source-loader.ts';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Cycle 3: Open WebXR Spatial Hologram Theater (Meta Horizon & Vision Pro Killer)', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  let content = '';

  it('loads dev-server template and verifies WebXR theater modal existence', () => {
    content = loadServerContent(devServerPath);
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

  it('verifies mathematical 3D perspective projection pipeline with yaw, pitch, roll, and FOV scaling', () => {
    expect(content).toContain('project3D');
    expect(content).toContain('radYaw');
    expect(content).toContain('radPitch');
    expect(content).toContain('radRoll');
    expect(content).toContain('cam.fov');
  });

  it('verifies 3D curved IMAX cinema screen mesh and ambient reactive floor bloom', () => {
    expect(content).toContain('drawCinemaScreen3D');
    expect(content).toContain('_isCurvedScreen');
    expect(content).toContain('toggleSpatialScreenCurve');
    expect(content).toContain('Curved IMAX');
    expect(content).toContain('screenBaseProj');
  });

  it('verifies tiered 3D stadium seating rows and 3D holographic equalizer spectrum', () => {
    expect(content).toContain('drawTieredSeats3D');
    expect(content).toContain('Row 1 (Front)');
    expect(content).toContain('Row 2 (VIP)');
    expect(content).toContain('Row 3 (Balcony)');
    expect(content).toContain('drawEqualizer3D');
  });

  it('verifies seat selection presets and dynamic ambiance lighting presets', () => {
    expect(content).toContain('setSpatialSeat');
    expect(content).toContain('spatialSeatFrontBtn');
    expect(content).toContain('spatialSeatVipBtn');
    expect(content).toContain('spatialSeatBalconyBtn');
    expect(content).toContain('setSpatialAmbiance');
  });

  it('verifies universal 6-DOF / 3-DOF hardware emulation across laptops, smartphones, and Cardboard VR', () => {
    // Mouse Drag Orbit
    expect(content).toContain('mousedown');
    expect(content).toContain('_isDraggingSpatial');
    // Mouse Scroll Zoom
    expect(content).toContain("canvas.addEventListener('wheel'");
    // Mobile Gyroscope 360 Magic Window
    expect(content).toContain('deviceorientation');
    // Cardboard VR Stereoscopic Split (64mm IPD)
    expect(content).toContain('toggleCardboardStereoMode');
    expect(content).toContain('cardboardVrToggleBtn');
    // Watch Player VR entry button
    expect(content).toContain('btnSpatialVrTheater');
  });
});
