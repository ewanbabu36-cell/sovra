/**
 * @file apps/sovra-mobile/src/components/QrCodeRenderer.tsx
 * Pure TypeScript Zero-Dependency ISO/IEC 18004 Standard QR Code Generator & Renderer.
 *
 * Implements:
 * 1. Byte mode (8-bit) encoding with Reed-Solomon Error Correction (Level M).
 * 2. High-contrast pure vector SVG rendering with dark/light themes.
 * 3. Standard Sovra Payment URI parsing & formatting (`sovra:<address>?amount=<amount>&token=SOV`).
 * 4. 1-Click Copy, Native Web Share, and Canvas PNG Export.
 */

import React, { useRef, useState, useMemo } from 'react';

// ==========================================
// 1. Galois Field GF(256) & Reed-Solomon Engine
// ==========================================
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
let val = 1;
for (let i = 0; i < 255; i++) {
  GF_EXP[i] = val;
  GF_EXP[i + 255] = val;
  GF_LOG[val] = i;
  val = (val << 1) ^ (val >= 128 ? 0x11d : 0);
}

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x]! + GF_LOG[y]!]!;
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j]!, GF_EXP[i]!);
      next[j + 1] ^= poly[j]!;
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcc(data: Uint8Array, eccCount: number): Uint8Array {
  const gen = rsGeneratorPoly(eccCount);
  const buffer = new Uint8Array(data.length + eccCount);
  buffer.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = buffer[i]!;
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        buffer[i + j]! ^= gfMul(gen[j]!, coef);
      }
    }
  }
  buffer.set(data);
  return buffer.subarray(data.length);
}

// Version table: [version, totalBytes, dataBytes, eccBytesPerBlock, blocks]
// Level M configuration
const QR_SPECS: Array<{ version: number; totalBytes: number; dataBytes: number; ecc: number }> = [
  { version: 1, totalBytes: 26, dataBytes: 16, ecc: 10 },
  { version: 2, totalBytes: 44, dataBytes: 28, ecc: 16 },
  { version: 3, totalBytes: 70, dataBytes: 44, ecc: 26 },
  { version: 4, totalBytes: 100, dataBytes: 64, ecc: 36 },
  { version: 5, totalBytes: 134, dataBytes: 86, ecc: 48 },
  { version: 6, totalBytes: 172, dataBytes: 108, ecc: 64 },
  { version: 7, totalBytes: 196, dataBytes: 124, ecc: 72 },
  { version: 8, totalBytes: 242, dataBytes: 154, ecc: 88 },
  { version: 9, totalBytes: 292, dataBytes: 182, ecc: 110 },
  { version: 10, totalBytes: 346, dataBytes: 216, ecc: 130 },
];

/**
 * Encodes string to standard QR Code boolean matrix (true = dark, false = light).
 */
export function generateQrMatrix(text: string): boolean[][] {
  const utf8Bytes = new TextEncoder().encode(text);

  // Find lowest viable QR version
  const spec = QR_SPECS.find(s => utf8Bytes.length + 3 <= s.dataBytes) || QR_SPECS[QR_SPECS.length - 1]!;
  const version = spec.version;
  const size = version * 4 + 17;

  // Build bitstream: Mode (Byte = 0100) + CharCount (8 bits) + Data + Terminator
  const bits: number[] = [];
  const pushBits = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) {
      bits.push((value >>> i) & 1);
    }
  };

  pushBits(0b0100, 4); // Byte mode indicator
  pushBits(utf8Bytes.length, version <= 9 ? 8 : 16); // Character count
  for (const b of utf8Bytes) {
    pushBits(b, 8);
  }
  // Terminator (up to 4 zeroes)
  const remainingBits = spec.dataBytes * 8 - bits.length;
  pushBits(0, Math.min(4, Math.max(0, remainingBits)));

  // Byte align
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Pad bytes: alternating 0xEC (11101100) and 0x11 (00010001)
  const padPatterns = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < spec.dataBytes * 8) {
    pushBits(padPatterns[padIdx]!, 8);
    padIdx = (padIdx + 1) % 2;
  }

  // Convert bits to data codeword bytes
  const dataCodewords = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < spec.dataBytes; i++) {
    let byteVal = 0;
    for (let j = 0; j < 8; j++) {
      byteVal = (byteVal << 1) | bits[i * 8 + j]!;
    }
    dataCodewords[i] = byteVal;
  }

  // Generate ECC bytes
  const eccCodewords = rsComputeEcc(dataCodewords, spec.ecc);

  // Combine data + ECC
  const allCodewords = new Uint8Array(spec.totalBytes);
  allCodewords.set(dataCodewords);
  allCodewords.set(eccCodewords, dataCodewords.length);

  // Initialize empty grid & reservation matrix
  const matrix: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  const markReserved = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r]![c] = dark;
      reserved[r]![c] = true;
    }
  };

  // 1. Finder patterns (7x7) + Separators
  const placeFinder = (startR: number, startC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = startR + dr;
        const c = startC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
          const isEdge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const isCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          markReserved(r, c, isEdge || isCenter);
        } else {
          markReserved(r, c, false); // Separator
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // 2. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    markReserved(6, i, i % 2 === 0);
    markReserved(i, 6, i % 2 === 0);
  }

  // 3. Alignment patterns for Version >= 2
  if (version >= 2) {
    const alignCoords: number[] = [6, size - 7];
    for (const r of alignCoords) {
      for (const c of alignCoords) {
        if (reserved[r]![c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBorder = Math.abs(dr) === 2 || Math.abs(dc) === 2;
            const isCenter = dr === 0 && dc === 0;
            markReserved(r + dr, c + dc, isBorder || isCenter);
          }
        }
      }
    }
  }

  // 4. Dark module
  markReserved(4 * version + 9, 8, true);

  // 5. Reserve format info zones (around finders)
  for (let i = 0; i < 9; i++) {
    if (!reserved[8]![i]) markReserved(8, i, false);
    if (!reserved[i]![8]) markReserved(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8]![size - 1 - i]) markReserved(8, size - 1 - i, false);
    if (!reserved[size - 1 - i]![8]) markReserved(size - 1 - i, 8, false);
  }

  // 6. Data placement: 2-column zig-zag upward & downward
  const allBits: number[] = [];
  for (const b of allCodewords) {
    for (let bit = 7; bit >= 0; bit--) {
      allBits.push((b >>> bit) & 1);
    }
  }

  let bitIdx = 0;
  let up = true;
  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol--; // Skip vertical timing column
    const rows = up ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);
    for (const r of rows) {
      for (const c of [rightCol, rightCol - 1]) {
        if (!reserved[r]![c]) {
          const bitVal = bitIdx < allBits.length ? allBits[bitIdx]! : 0;
          bitIdx++;
          // Apply standard Mask 0: (row + col) % 2 == 0
          const mask = (r + c) % 2 === 0;
          matrix[r]![c] = Boolean(bitVal ^ (mask ? 1 : 0));
        }
      }
    }
    up = !up;
  }

  // 7. Write Format Information (Level M, Mask 0 = 0b10000 -> BCH 15,5 = 0x5412 XOR)
  // Format bit string for Level M, mask 0 = 101010000010010
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  // Top-left finder
  for (let i = 0; i < 6; i++) matrix[8]![i] = Boolean(formatBits[i]);
  matrix[8]![7] = Boolean(formatBits[6]);
  matrix[8]![8] = Boolean(formatBits[7]);
  matrix[7]![8] = Boolean(formatBits[8]);
  for (let i = 9; i < 15; i++) matrix[14 - i]![8] = Boolean(formatBits[i]);

  // Split across other finders
  for (let i = 0; i < 8; i++) matrix[size - 1 - i]![8] = Boolean(formatBits[i]);
  for (let i = 8; i < 15; i++) matrix[8]![size - 15 + i] = Boolean(formatBits[i]);

  return matrix;
}

// ==========================================
// 2. URI Helpers
// ==========================================

export function formatSovraUri(address: string, amount?: string, token: string = 'SOV'): string {
  const cleanAddr = address.trim();
  const queryParts: string[] = [];
  if (amount && Number(amount) > 0) queryParts.push(`amount=${encodeURIComponent(amount)}`);
  if (token && token !== 'SOV') queryParts.push(`token=${encodeURIComponent(token)}`);
  return queryParts.length > 0 ? `sovra:${cleanAddr}?${queryParts.join('&')}` : `sovra:${cleanAddr}`;
}

export function parseSovraUri(uri: string): { address: string; amount?: string; token?: string } {
  const clean = uri.trim();
  if (clean.toLowerCase().startsWith('sovra:')) {
    const raw = clean.slice(6);
    const [addressPart, queryPart] = raw.split('?');
    const result: { address: string; amount?: string; token?: string } = {
      address: addressPart || '',
    };
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      if (params.get('amount')) result.amount = params.get('amount')!;
      if (params.get('token')) result.token = params.get('token')!;
    }
    return result;
  }
  return { address: clean };
}

// ==========================================
// 3. React SVG QR Component
// ==========================================

export interface QrCodeRendererProps {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
  title?: string;
  showActions?: boolean;
  onCopySuccess?: () => void;
}

export const QrCodeRenderer: React.FC<QrCodeRendererProps> = ({
  value,
  size = 200,
  fgColor = '#0f172a',
  bgColor = '#ffffff',
  title = 'Sovra Payment QR',
  showActions = true,
  onCopySuccess,
}) => {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const matrix = useMemo(() => {
    try {
      return generateQrMatrix(value);
    } catch (err) {
      console.warn('[QrCodeRenderer] Matrix generation fallback:', err);
      return Array.from({ length: 21 }, () => new Array(21).fill(false));
    }
  }, [value]);

  const moduleCount = matrix.length;
  const cellSize = size / moduleCount;

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value);
      setCopied(true);
      if (onCopySuccess) onCopySuccess();
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({
          title: 'Sovra Sovereign Address',
          text: value,
          url: value.startsWith('sovra:') ? value : `sovra:${value}`,
        });
      } catch {}
    } else {
      handleCopy();
    }
  };

  const handleDownloadPng = () => {
    if (!svgRef.current) return;
    setDownloading(true);
    try {
      const svgData = new XMLSerializer().serializeToString(svgRef.current);
      const canvas = document.createElement('canvas');
      canvas.width = size * 2; // High-DPI 2x supersampling
      canvas.height = size * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        const a = document.createElement('a');
        a.download = `sovra-qr-${Date.now()}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
        setDownloading(false);
      };
      img.src = url;
    } catch {
      setDownloading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {/* High-Contrast SVG QR Container */}
      <div
        style={{
          width: size + 24,
          height: size + 24,
          backgroundColor: bgColor,
          borderRadius: 16,
          padding: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.2)',
        }}
      >
        <svg
          ref={svgRef}
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={title}
          style={{ shapeRendering: 'crispEdges' }}
        >
          <rect width={size} height={size} fill={bgColor} />
          {matrix.map((row, r) =>
            row.map((cell, c) =>
              cell ? (
                <rect
                  key={`${r}-${c}`}
                  x={c * cellSize}
                  y={r * cellSize}
                  width={cellSize + 0.05} // prevent sub-pixel gaps
                  height={cellSize + 0.05}
                  fill={fgColor}
                />
              ) : null,
            ),
          )}
        </svg>
      </div>

      {/* Action Buttons: Copy, Share, Save PNG */}
      {showActions && (
        <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'center' }}>
          <button
            onClick={handleCopy}
            type="button"
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              backgroundColor: copied ? '#059669' : '#1e293b',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.15)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              transition: 'background-color 0.2s',
            }}
          >
            <span>{copied ? '✓' : '📋'}</span>
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
          <button
            onClick={handleShare}
            type="button"
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              backgroundColor: '#1e293b',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.15)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <span>🔗</span>
            <span>Share</span>
          </button>
          <button
            onClick={handleDownloadPng}
            disabled={downloading}
            type="button"
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              border: '1px solid rgba(56,189,248,0.3)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <span>💾</span>
            <span>Save PNG</span>
          </button>
        </div>
      )}
    </div>
  );
};
