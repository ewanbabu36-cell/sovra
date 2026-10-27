import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ============================================================================
// 1. BESPOKE SOVRA VECTOR BRAND ASSETS (SVG)
// ============================================================================

export const SOVRA_SVG_DEFS = `
  <defs>
    <!-- Deep Cosmic Obsidian Background -->
    <linearGradient id="sovraBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080e1e"/>
      <stop offset="50%" stop-color="#050811"/>
      <stop offset="100%" stop-color="#020409"/>
    </linearGradient>

    <!-- Radiant Ambient Back-Aura -->
    <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.45"/>
      <stop offset="45%" stop-color="#00f0ff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Upper Sovereign 'S' Ribbon: Pure Electric Cyan to Indigo -->
    <linearGradient id="sUpperRibbon" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#00f5ff"/>
      <stop offset="45%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>

    <!-- Lower Sovereign 'S' Ribbon: Royal Indigo to Radiant Magenta/Rose -->
    <linearGradient id="sLowerRibbon" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="45%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#f43f5e"/>
    </linearGradient>

    <!-- Specular Highlight Spine (Refractive Gemstone Core) -->
    <linearGradient id="specularCore" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#c084fc" stop-opacity="0.8"/>
    </linearGradient>

    <!-- Subtle Titanium Glass Rim Gradient -->
    <linearGradient id="glassRim" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.22)"/>
      <stop offset="50%" stop-color="rgba(56,189,248,0.3)"/>
      <stop offset="100%" stop-color="rgba(99,102,241,0.15)"/>
    </linearGradient>

    <!-- Wordmark Luxury Typography Gradient -->
    <linearGradient id="wordmarkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#f1f5f9"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
`;

export const SOVRA_SVG_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
${SOVRA_SVG_DEFS}
  <!-- 1. Obsidian Squircle Chassis -->
  <rect width="512" height="512" rx="118" fill="url(#sovraBg)"/>
  <rect width="508" height="508" x="2" y="2" rx="116" fill="none" stroke="url(#glassRim)" stroke-width="2"/>
  <rect width="502" height="502" x="5" y="5" rx="113" fill="none" stroke="rgba(0,240,255,0.18)" stroke-width="1.2"/>

  <!-- 2. Ambient Radiant Center Aura -->
  <circle cx="256" cy="256" r="195" fill="url(#centerGlow)"/>

  <!-- 3. Dynamic Sovereign 'S' Möbius Ribbon -->
  <!-- Top Loop -->
  <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275"
        fill="none" stroke="url(#sUpperRibbon)" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Bottom Loop -->
  <path d="M 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
        fill="none" stroke="url(#sLowerRibbon)" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Specular Core Centerline -->
  <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
        fill="none" stroke="url(#specularCore)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>

  <!-- 4. Luminous Mesh Terminal Nodes -->
  <circle cx="335" cy="195" r="10" fill="#00f5ff" opacity="0.9"/>
  <circle cx="335" cy="195" r="5" fill="#ffffff"/>
  <circle cx="165" cy="360" r="10" fill="#f43f5e" opacity="0.9"/>
  <circle cx="165" cy="360" r="5" fill="#ffffff"/>
</svg>`;

export const SOVRA_SVG_MARK_TRANSPARENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
${SOVRA_SVG_DEFS}
  <!-- Ambient Aura -->
  <circle cx="256" cy="256" r="185" fill="url(#centerGlow)"/>

  <!-- Top Loop -->
  <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275"
        fill="none" stroke="url(#sUpperRibbon)" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Bottom Loop -->
  <path d="M 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
        fill="none" stroke="url(#sLowerRibbon)" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Specular Core Centerline -->
  <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
        fill="none" stroke="url(#specularCore)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>

  <!-- Luminous Mesh Terminal Nodes -->
  <circle cx="335" cy="195" r="10" fill="#00f5ff" opacity="0.9"/>
  <circle cx="335" cy="195" r="5" fill="#ffffff"/>
  <circle cx="165" cy="360" r="10" fill="#f43f5e" opacity="0.9"/>
  <circle cx="165" cy="360" r="5" fill="#ffffff"/>
</svg>`;

export const SOVRA_SVG_LOGO_HORIZONTAL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 160" width="600" height="160">
${SOVRA_SVG_DEFS}
  <!-- Mark Scaled (120x120 at x=20, y=20) -->
  <g transform="translate(20, 20) scale(0.234375)">
    <rect width="512" height="512" rx="118" fill="url(#sovraBg)"/>
    <rect width="508" height="508" x="2" y="2" rx="116" fill="none" stroke="url(#glassRim)" stroke-width="3"/>
    <circle cx="256" cy="256" r="195" fill="url(#centerGlow)"/>
    <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275"
          fill="none" stroke="url(#sUpperRibbon)" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
          fill="none" stroke="url(#sLowerRibbon)" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
          fill="none" stroke="url(#specularCore)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
    <circle cx="335" cy="195" r="10" fill="#00f5ff"/>
    <circle cx="335" cy="195" r="5" fill="#ffffff"/>
    <circle cx="165" cy="360" r="10" fill="#f43f5e"/>
    <circle cx="165" cy="360" r="5" fill="#ffffff"/>
  </g>

  <!-- Typography: SOVRA Wordmark -->
  <text x="165" y="94" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif"
        font-size="64" font-weight="900" letter-spacing="4" fill="url(#wordmarkGrad)">SOVRA</text>

  <!-- Sovereign Mesh Micro Pill Badge -->
  <rect x="168" y="112" width="144" height="24" rx="6" fill="rgba(56, 189, 248, 0.12)" stroke="rgba(56, 189, 248, 0.35)" stroke-width="1"/>
  <text x="178" y="128" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        font-size="11" font-weight="700" letter-spacing="1.6" fill="#38bdf8">SOVEREIGN MESH</text>
</svg>`;

export const SOVRA_SVG_SPLASH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
${SOVRA_SVG_DEFS}
  <!-- Dark Obsidian Void Background -->
  <rect width="1080" height="1920" fill="url(#sovraBg)"/>
  <circle cx="540" cy="850" r="420" fill="url(#centerGlow)"/>

  <!-- Center Sovereign Emblem (380x380 at x=350, y=660) -->
  <g transform="translate(350, 660) scale(0.7421875)">
    <rect width="512" height="512" rx="118" fill="url(#sovraBg)"/>
    <rect width="508" height="508" x="2" y="2" rx="116" fill="none" stroke="url(#glassRim)" stroke-width="3"/>
    <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275"
          fill="none" stroke="url(#sUpperRibbon)" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
          fill="none" stroke="url(#sLowerRibbon)" stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
          fill="none" stroke="url(#specularCore)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
    <circle cx="335" cy="195" r="10" fill="#00f5ff"/>
    <circle cx="335" cy="195" r="5" fill="#ffffff"/>
    <circle cx="165" cy="360" r="10" fill="#f43f5e"/>
    <circle cx="165" cy="360" r="5" fill="#ffffff"/>
  </g>

  <text x="540" y="1140" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif"
        font-size="64" font-weight="900" letter-spacing="7" fill="url(#wordmarkGrad)">SOVRA</text>

  <text x="540" y="1190" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        font-size="18" font-weight="600" letter-spacing="4" fill="#38bdf8" opacity="0.9">SOVEREIGN P2P MESH</text>

  <text x="540" y="1800" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        font-size="13" font-weight="600" letter-spacing="3" fill="#64748b">ENCRYPTED • DECENTRALIZED • UNSTOPPABLE</text>
</svg>`;

// ============================================================================
// 2. ULTRA-FAST SPATIAL-ACCELERATED PNG RASTERIZER
// ============================================================================

export function generateValidPngBuffer(width: number, height: number, isMaskable = false): Buffer {
  function crc32(buf: Buffer): number {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      let byte = buf[i];
      for (let j = 0; j < 8; j++) {
        const bit = (crc ^ byte) & 1;
        crc = (crc >>> 1) ^ (bit ? 0xedb88320 : 0);
        byte >>>= 1;
      }
    }
    return (crc ^ -1) >>> 0;
  }

  function makeChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crc]);
  }

  function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function evalBezier(p0: any, p1: any, p2: any, p3: any, t: number) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
      y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
    };
  }

  const BEZIER_SEGMENTS = [
    { p0: { x: 335, y: 195 }, p1: { x: 335, y: 135 }, p2: { x: 300, y: 110 }, p3: { x: 256, y: 110 } },
    { p0: { x: 256, y: 110 }, p1: { x: 195, y: 110 }, p2: { x: 165, y: 145 }, p3: { x: 165, y: 195 } },
    { p0: { x: 165, y: 195 }, p1: { x: 165, y: 240 }, p2: { x: 215, y: 260 }, p3: { x: 256, y: 275 } },
    { p0: { x: 256, y: 275 }, p1: { x: 298, y: 290 }, p2: { x: 347, y: 310 }, p3: { x: 347, y: 355 } },
    { p0: { x: 347, y: 355 }, p1: { x: 347, y: 405 }, p2: { x: 315, y: 440 }, p3: { x: 256, y: 440 } },
    { p0: { x: 256, y: 440 }, p1: { x: 200, y: 440 }, p2: { x: 165, y: 415 }, p3: { x: 165, y: 360 } },
  ];

  const POLYLINE: { ax: number; ay: number; bx: number; by: number; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  const SAMPLES = 16;
  for (const seg of BEZIER_SEGMENTS) {
    for (let i = 0; i < SAMPLES; i++) {
      const pt0 = evalBezier(seg.p0, seg.p1, seg.p2, seg.p3, i / SAMPLES);
      const pt1 = evalBezier(seg.p0, seg.p1, seg.p2, seg.p3, (i + 1) / SAMPLES);
      POLYLINE.push({
        ax: pt0.x,
        ay: pt0.y,
        bx: pt1.x,
        by: pt1.y,
        minX: Math.min(pt0.x, pt1.x) - 45,
        maxX: Math.max(pt0.x, pt1.x) + 45,
        minY: Math.min(pt0.y, pt1.y) - 45,
        maxY: Math.max(pt0.y, pt1.y) + 45,
      });
    }
  }

  // Fast bounding box for entire ribbon
  const RIBBON_MIN_X = 115;
  const RIBBON_MAX_X = 395;
  const RIBBON_MIN_Y = 65;
  const RIBBON_MAX_Y = 485;

  function distToPoly(px: number, py: number): number {
    if (px < RIBBON_MIN_X || px > RIBBON_MAX_X || py < RIBBON_MIN_Y || py > RIBBON_MAX_Y) {
      return 100; // Far outside ribbon stroke
    }
    let m = Infinity;
    for (let i = 0; i < POLYLINE.length; i++) {
      const seg = POLYLINE[i];
      if (px < seg.minX || px > seg.maxX || py < seg.minY || py > seg.maxY) continue;
      const d = distToSegment(px, py, seg.ax, seg.ay, seg.bx, seg.by);
      if (d < m) {
        m = d;
        if (m < 2) break; // close enough to core
      }
    }
    return m;
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const scale = 512 / width;
  const ribbonR = 37;
  const coreR = 8.5;
  const rowBytes = 1 + width * 4;
  const rawData = Buffer.alloc(rowBytes * height);

  // Use 1 sample per pixel for large dimensions (>= 512), 2x2 supersampling for small icons (< 512)
  const isHighRes = width >= 512;
  const subSamples = isHighRes ? 1 : 2;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      let accR = 0, accG = 0, accB = 0, accA = 0;
      for (let sy = 0; sy < subSamples; sy++) {
        for (let sx = 0; sx < subSamples; sx++) {
          const subX = (x + (sx + 0.5) / subSamples) * scale;
          const subY = (y + (sy + 0.5) / subSamples) * scale;
          const nx = (subX - 256) / 256;
          const ny = (subY - 256) / 256;
          const distCenter = Math.hypot(nx, ny);

          const tV = (ny + 1) * 0.5;
          let bgR = Math.round(8 * (1 - tV) + 2 * tV);
          let bgG = Math.round(14 * (1 - tV) + 4 * tV);
          let bgB = Math.round(30 * (1 - tV) + 10 * tV);
          let bgA = 255;

          if (distCenter < 0.88) {
            const glow = Math.pow(1 - distCenter / 0.88, 2);
            bgR = Math.min(255, bgR + Math.round(65 * glow));
            bgG = Math.min(255, bgG + Math.round(95 * glow));
            bgB = Math.min(255, bgB + Math.round(195 * glow));
          }

          if (!isMaskable) {
            const squircleDist = Math.pow(Math.pow(Math.abs(nx), 4.2) + Math.pow(Math.abs(ny), 4.2), 1 / 4.2);
            if (squircleDist > 0.98) {
              const borderFade = Math.max(0, Math.min(1, (1.02 - squircleDist) / 0.04));
              bgA = Math.round(255 * borderFade);
            }
            if (squircleDist >= 0.92 && squircleDist <= 0.98) {
              const stroke = 1 - Math.abs(squircleDist - 0.95) / 0.03;
              bgR = Math.min(255, bgR + Math.round(45 * stroke));
              bgG = Math.min(255, bgG + Math.round(85 * stroke));
              bgB = Math.min(255, bgB + Math.round(140 * stroke));
            }
          }

          const dCurve = distToPoly(subX, subY);
          if (dCurve < ribbonR + 2.5) {
            const edgeFade = Math.max(0, Math.min(1, (ribbonR + 2.5 - dCurve) / 2.5));
            const gradT = Math.max(0, Math.min(1, (subY - 110) / 330));
            let sR, sG, sB;
            if (gradT < 0.45) {
              const t = gradT / 0.45;
              sR = Math.round(0 * (1 - t) + 99 * t);
              sG = Math.round(245 * (1 - t) + 102 * t);
              sB = Math.round(255 * (1 - t) + 241 * t);
            } else {
              const t = (gradT - 0.45) / 0.55;
              sR = Math.round(99 * (1 - t) + 244 * t);
              sG = Math.round(102 * (1 - t) + 63 * t);
              sB = Math.round(241 * (1 - t) + 94 * t);
            }
            if (dCurve < coreR) {
              const coreT = 1 - dCurve / coreR;
              sR = Math.round(sR * (1 - coreT * 0.8) + 255 * coreT * 0.8);
              sG = Math.round(sG * (1 - coreT * 0.8) + 255 * coreT * 0.8);
              sB = Math.round(sB * (1 - coreT * 0.8) + 255 * coreT * 0.8);
            }
            bgR = Math.round(bgR * (1 - edgeFade) + sR * edgeFade);
            bgG = Math.round(bgG * (1 - edgeFade) + sG * edgeFade);
            bgB = Math.round(bgB * (1 - edgeFade) + sB * edgeFade);
          }

          accR += bgR;
          accG += bgG;
          accB += bgB;
          accA += bgA;
        }
      }
      const div = subSamples * subSamples;
      const px = rowOffset + 1 + x * 4;
      rawData[px] = Math.round(accR / div);
      rawData[px + 1] = Math.round(accG / div);
      rawData[px + 2] = Math.round(accB / div);
      rawData[px + 3] = Math.round(accA / div);
    }
  }

  const idat = zlib.deflateSync(rawData, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// ============================================================================
// 3. GENERATION TASK RUNNER
// ============================================================================

export function generateAllBrandAssets() {
  const rootDir = process.cwd();
  const mobileAssetsDir = path.join(rootDir, 'apps', 'sovra-mobile', 'assets');
  const publicDir = path.join(rootDir, 'public');

  if (!fs.existsSync(mobileAssetsDir)) {
    fs.mkdirSync(mobileAssetsDir, { recursive: true });
  }
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  console.log('💎 Generating Sovereign Vector Brand Assets (SVG)...');
  fs.writeFileSync(path.join(publicDir, 'sovra-icon.svg'), SOVRA_SVG_MARK, 'utf-8');
  fs.writeFileSync(path.join(publicDir, 'sovra-icon-transparent.svg'), SOVRA_SVG_MARK_TRANSPARENT, 'utf-8');
  fs.writeFileSync(path.join(publicDir, 'sovra-logo.svg'), SOVRA_SVG_LOGO_HORIZONTAL, 'utf-8');
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), SOVRA_SVG_MARK, 'utf-8');

  console.log('📱 Generating Mobile App Assets (apps/sovra-mobile/assets/)...');
  // 1024x1024 App Master Icon
  const icon1024 = generateValidPngBuffer(1024, 1024, false);
  fs.writeFileSync(path.join(mobileAssetsDir, 'icon.png'), icon1024);

  // 1024x1024 Android Adaptive Foreground Icon
  const adaptive1024 = generateValidPngBuffer(1024, 1024, true);
  fs.writeFileSync(path.join(mobileAssetsDir, 'adaptive-icon.png'), adaptive1024);

  // Splash Screen
  fs.writeFileSync(path.join(mobileAssetsDir, 'splash.png'), icon1024);
  fs.writeFileSync(path.join(mobileAssetsDir, 'splash.svg'), SOVRA_SVG_SPLASH, 'utf-8');

  // Favicon 48x48
  const fav48 = generateValidPngBuffer(48, 48, false);
  fs.writeFileSync(path.join(mobileAssetsDir, 'favicon.png'), fav48);

  console.log('🌐 Generating PWA & Web Raster Icons...');
  const icon512 = generateValidPngBuffer(512, 512, false);
  const icon192 = generateValidPngBuffer(192, 192, false);
  const iconApple = generateValidPngBuffer(180, 180, false);
  const iconMaskable = generateValidPngBuffer(512, 512, true);

  fs.writeFileSync(path.join(rootDir, 'icon-512.png'), icon512);
  fs.writeFileSync(path.join(rootDir, 'icon-192.png'), icon192);
  fs.writeFileSync(path.join(rootDir, 'icon-maskable.png'), iconMaskable);
  fs.writeFileSync(path.join(rootDir, 'apple-touch-icon.png'), iconApple);

  fs.writeFileSync(path.join(publicDir, 'icon-512.png'), icon512);
  fs.writeFileSync(path.join(publicDir, 'icon-192.png'), icon192);
  fs.writeFileSync(path.join(publicDir, 'icon-maskable.png'), iconMaskable);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), iconApple);

  console.log('✅ All Brand Assets generated successfully!');
}

if (process.argv[1] && process.argv[1].endsWith('generate-brand-assets.ts')) {
  generateAllBrandAssets();
}
