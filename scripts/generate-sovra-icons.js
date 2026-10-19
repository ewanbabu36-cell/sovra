import fs from 'node:fs';
import zlib from 'node:zlib';

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    for (let j = 0; j < 8; j++) {
      const bit = (crc ^ byte) & 1;
      crc = (crc >>> 1) ^ (bit ? 0xEDB88320 : 0);
      byte >>>= 1;
    }
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Cubic Bezier evaluation
function evalBezier(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

// Sovra 'S' Spine Bezier Definition (in 512x512 space)
const BEZIER_SEGMENTS = [
  // Segment 1: Top hook from top-right around to top apex
  { p0: { x: 335, y: 195 }, p1: { x: 335, y: 135 }, p2: { x: 300, y: 110 }, p3: { x: 256, y: 110 } },
  // Segment 2: Top loop from top apex around left down towards center
  { p0: { x: 256, y: 110 }, p1: { x: 195, y: 110 }, p2: { x: 165, y: 145 }, p3: { x: 165, y: 195 } },
  // Segment 3: S-crossover from top-left into center
  { p0: { x: 165, y: 195 }, p1: { x: 165, y: 240 }, p2: { x: 215, y: 260 }, p3: { x: 256, y: 275 } },
  // Segment 4: S-crossover from center towards bottom-right
  { p0: { x: 256, y: 275 }, p1: { x: 298, y: 290 }, p2: { x: 347, y: 310 }, p3: { x: 347, y: 355 } },
  // Segment 5: Bottom loop from right around bottom apex
  { p0: { x: 347, y: 355 }, p1: { x: 347, y: 405 }, p2: { x: 315, y: 440 }, p3: { x: 256, y: 440 } },
  // Segment 6: Bottom hook from bottom apex up into bottom-left terminal
  { p0: { x: 256, y: 440 }, p1: { x: 200, y: 440 }, p2: { x: 165, y: 415 }, p3: { x: 165, y: 360 } },
];

// Precompute polyline segments
const POLYLINE = [];
const SAMPLES_PER_SEGMENT = 24;
for (const seg of BEZIER_SEGMENTS) {
  for (let i = 0; i < SAMPLES_PER_SEGMENT; i++) {
    const t0 = i / SAMPLES_PER_SEGMENT;
    const t1 = (i + 1) / SAMPLES_PER_SEGMENT;
    const pt0 = evalBezier(seg.p0, seg.p1, seg.p2, seg.p3, t0);
    const pt1 = evalBezier(seg.p0, seg.p1, seg.p2, seg.p3, t1);
    POLYLINE.push({ ax: pt0.x, ay: pt0.y, bx: pt1.x, by: pt1.y });
  }
}

function distToPolyline(px, py) {
  let minDist = Infinity;
  for (let i = 0; i < POLYLINE.length; i++) {
    const seg = POLYLINE[i];
    const d = distToSegment(px, py, seg.ax, seg.ay, seg.bx, seg.by);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function generateSovraPng(width, height, isMaskable = false) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = 1 + width * 4;
  const rawData = Buffer.alloc(rowBytes * height);

  const scale = 512 / width;
  const ribbonRadius = 39; // Bold half-width in 512 space (stroke width = 78)
  const coreRadius = 9;    // Specular center line

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0;

    for (let x = 0; x < width; x++) {
      let accR = 0, accG = 0, accB = 0, accA = 0;

      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const subX = (x + (sx + 0.5) / 2) * scale;
          const subY = (y + (sy + 0.5) / 2) * scale;

          const nx = (subX - 256) / 256;
          const ny = (subY - 256) / 256;
          const distCenter = Math.hypot(nx, ny);

          // 1. Background
          const tV = (ny + 1) * 0.5;
          let bgR = Math.round(9 * (1 - tV) + 4 * tV);
          let bgG = Math.round(15 * (1 - tV) + 7 * tV);
          let bgB = Math.round(32 * (1 - tV) + 16 * tV);
          let bgA = 255;

          // Radial center glow
          if (distCenter < 0.85) {
            const glow = Math.pow(1 - distCenter / 0.85, 2);
            bgR = Math.min(255, bgR + Math.round(55 * glow));
            bgG = Math.min(255, bgG + Math.round(90 * glow));
            bgB = Math.min(255, bgB + Math.round(180 * glow));
          }

          // Squircle container clipping (if not maskable)
          if (!isMaskable) {
            const squircleDist = Math.pow(Math.pow(Math.abs(nx), 4.2) + Math.pow(Math.abs(ny), 4.2), 1 / 4.2);
            if (squircleDist > 0.98) {
              const borderFade = Math.max(0, Math.min(1, (1.02 - squircleDist) / 0.04));
              bgA = Math.round(255 * borderFade);
            }
            if (squircleDist >= 0.92 && squircleDist <= 0.98) {
              const stroke = 1 - Math.abs(squircleDist - 0.95) / 0.03;
              bgR = Math.min(255, bgR + Math.round(35 * stroke));
              bgG = Math.min(255, bgG + Math.round(70 * stroke));
              bgB = Math.min(255, bgB + Math.round(120 * stroke));
            }
          }

          // 2. Sovereign Neat & Clean Bold Capital 'S' Ribbon
          const dCurve = distToPolyline(subX, subY);

          if (dCurve < ribbonRadius + 2.5) {
            const edgeFade = Math.max(0, Math.min(1, (ribbonRadius + 2.5 - dCurve) / 2.5));

            // Dynamic gradient along Y:
            // Top (Cyan #00f0ff) -> Mid (Indigo #6366f1) -> Bottom (Magenta #ec4899)
            const gradT = Math.max(0, Math.min(1, (subY - 110) / 330));
            let sR, sG, sB;

            if (gradT < 0.45) {
              const t = gradT / 0.45;
              sR = Math.round(0 * (1 - t) + 99 * t);
              sG = Math.round(240 * (1 - t) + 102 * t);
              sB = Math.round(255 * (1 - t) + 241 * t);
            } else {
              const t = (gradT - 0.45) / 0.55;
              sR = Math.round(99 * (1 - t) + 236 * t);
              sG = Math.round(102 * (1 - t) + 72 * t);
              sB = Math.round(241 * (1 - t) + 153 * t);
            }

            // Specular luminous core highlight
            if (dCurve < coreRadius) {
              const coreT = 1 - dCurve / coreRadius;
              sR = Math.round(sR * (1 - coreT * 0.75) + 255 * coreT * 0.75);
              sG = Math.round(sG * (1 - coreT * 0.75) + 255 * coreT * 0.75);
              sB = Math.round(sB * (1 - coreT * 0.75) + 255 * coreT * 0.75);
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

      const px = rowOffset + 1 + x * 4;
      rawData[px] = Math.round(accR / 4);
      rawData[px + 1] = Math.round(accG / 4);
      rawData[px + 2] = Math.round(accB / 4);
      rawData[px + 3] = Math.round(accA / 4);
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

export const SOVRA_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="sovraBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080e1e"/>
      <stop offset="50%" stop-color="#050811"/>
      <stop offset="100%" stop-color="#020409"/>
    </linearGradient>

    <!-- Center Radiant Glow -->
    <radialGradient id="centerGlow" cx="50%" cy="50%" r="48%">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.38"/>
      <stop offset="45%" stop-color="#00f0ff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Upper Sovereign 'S' Ribbon Gradient: Electric Cyan to Indigo -->
    <linearGradient id="sUpperRibbon" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#00f0ff"/>
      <stop offset="50%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>

    <!-- Lower Sovereign 'S' Ribbon Gradient: Indigo to Vibrant Magenta -->
    <linearGradient id="sLowerRibbon" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="50%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>

    <!-- Specular Highlight Core Line -->
    <linearGradient id="specularCore" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#c084fc" stop-opacity="0.8"/>
    </linearGradient>
  </defs>

  <!-- 1. Squircle Container -->
  <rect width="512" height="512" rx="118" fill="url(#sovraBg)"/>
  <rect width="508" height="508" x="2" y="2" rx="116" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>
  <rect width="504" height="504" x="4" y="4" rx="114" fill="none" stroke="rgba(0,240,255,0.22)" stroke-width="1.5"/>

  <!-- 2. Ambient Radiant Aura -->
  <circle cx="256" cy="256" r="185" fill="url(#centerGlow)"/>

  <!-- 3. Dynamic Sovereign Bold Capital 'S' Ribbon -->
  <!-- Top Loop -->
  <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275"
        fill="none" stroke="url(#sUpperRibbon)" stroke-width="78" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Bottom Loop -->
  <path d="M 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
        fill="none" stroke="url(#sLowerRibbon)" stroke-width="78" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Specular Core Centerline -->
  <path d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
        fill="none" stroke="url(#specularCore)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
</svg>`;

// Generate files
const icon192 = generateSovraPng(192, 192, false);
const icon512 = generateSovraPng(512, 512, false);
const iconMaskable = generateSovraPng(512, 512, true);
const iconApple = generateSovraPng(180, 180, false);

fs.writeFileSync('public-icon-192.png', icon192);
fs.writeFileSync('public-icon-512.png', icon512);
fs.writeFileSync('public-icon-maskable.png', iconMaskable);
fs.writeFileSync('public-icon-apple.png', iconApple);
fs.writeFileSync('public-icon.svg', SOVRA_SVG_ICON);

fs.writeFileSync('icon-192.png', icon192);
fs.writeFileSync('icon-512.png', icon512);
fs.writeFileSync('icon-maskable.png', iconMaskable);
fs.writeFileSync('apple-touch-icon.png', iconApple);
fs.writeFileSync('icon.svg', SOVRA_SVG_ICON);

console.log('✅ Generated neat, clean bold capital S icons (192, 512, maskable, apple, svg)');

