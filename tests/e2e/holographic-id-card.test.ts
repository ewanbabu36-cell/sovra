import { describe, it, expect } from 'vitest';

describe('Sovra Holographic Gyroscope-Reactive ID Card Suite', () => {
  const BASE_URL = 'http://localhost:3001';

  it('serves the Holographic 3D ID Card modal and perspective stage', async () => {
    const res = await fetch(BASE_URL);
    expect(res.status).toBe(200);
    const html = await res.text();

    // Verify modal container and perspective stage
    expect(html).toContain('id="sovereignIdCardModal"');
    expect(html).toContain('class="holo-card-perspective-stage"');
    expect(html).toContain('id="holoIdCardContainer"');
    expect(html).toContain('class="holo-card-3d"');
  });

  it('contains all 4 optical holographic shader layers for iridescent shimmer', async () => {
    const res = await fetch(BASE_URL);
    const html = await res.text();

    // 1. Rainbow Prismatic Diffraction Foil Shader
    expect(html).toContain('class="holo-card-foil-shader"');
    expect(html).toContain('id="holoFoilShader"');
    expect(html).toContain('--holo-foil-deg');
    expect(html).toContain('--holo-foil-pos');
    expect(html).toContain('mix-blend-mode: color-dodge');

    // 2. Specular Light Glare Reflection
    expect(html).toContain('class="holo-card-specular-flare"');
    expect(html).toContain('id="holoSpecularFlare"');
    expect(html).toContain('--holo-glare-x');
    expect(html).toContain('--holo-glare-y');

    // 3. Laser Guilloché Security Watermark Pattern
    expect(html).toContain('class="holo-card-laser-guilloche"');

    // 4. Holographic Scanline Wave
    expect(html).toContain('class="holo-card-scanline"');
    expect(html).toContain('@keyframes holoCardScanline');
  });

  it('contains elevated 3D floating elements: EMV hardware chip, verified seal, QR plate, and terminal', async () => {
    const res = await fetch(BASE_URL);
    const html = await res.text();

    // EMV chip and network badge
    expect(html).toContain('class="holo-emv-chip"');
    expect(html).toContain('class="holo-network-badge"');
    expect(html).toContain('SOVRA MESH &bull; ED25519');

    // Avatar and Verified Sovereign Seal
    expect(html).toContain('class="holo-avatar-inner"');
    expect(html).toContain('class="holo-verified-seal"');
    expect(html).toContain('ED25519 VERIFIED');

    // 3D Floating QR plate
    expect(html).toContain('class="holo-qr-plate"');
    expect(html).toContain('id="idCardQrContainer"');
    expect(html).toContain('PEER DISCOVERY &bull; BLE / P2P NOISE PROTOCOL');

    // Cryptographic proof terminal and tilt readout
    expect(html).toContain('class="holo-crypto-panel"');
    expect(html).toContain('id="idCardSigStatus"');
    expect(html).toContain('id="holoTiltAngleDisplay"');
    expect(html).toContain('RFC 8032 Ed25519');
  });

  it('includes complete client-side gyroscope and tilt physics engine', async () => {
    const res = await fetch(BASE_URL);
    const html = await res.text();

    // Verify engine functions and state
    expect(html).toContain('let holoCardTiltState =');
    expect(html).toContain('function initHolographicIdCardTilt()');
    expect(html).toContain('function bindHoloGyroscope()');
    expect(html).toContain('function toggleHoloGyroscope()');
    expect(html).toContain('function startHoloCardAnimationLoop()');

    // Verify deviceorientation gyroscope event handling
    expect(html).toContain("window.addEventListener('deviceorientation', handleOrientation");
    expect(html).toContain('DeviceOrientationEvent.requestPermission');

    // Verify spring lerp and 3D transforms
    expect(html).toContain('rotateX(');
    expect(html).toContain('rotateY(');
    expect(html).toContain('scale3d(1.02, 1.02, 1.02)');
  });

  it('provides mode switching between Live 3D, Orbit Float, and Flat 2D with toolbar controls', async () => {
    const res = await fetch(BASE_URL);
    const html = await res.text();

    expect(html).toContain('id="holoGyroToggleBtn"');
    expect(html).toContain('id="holoTiltModeStatus"');
    expect(html).toContain('class="holo-card-toolbar"');
    expect(html).toContain('class="holo-card-radar-pulse"');
  });
});
