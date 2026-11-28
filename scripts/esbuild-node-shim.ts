/**
 * @file scripts/esbuild-node-shim.ts
 * Shared browser/WebView Node-builtin shim plugin for Sovra esbuild bundles.
 * Implements real synchronous RFC 6234 SHA-256 (never returns all-zero placeholders).
 */

export function createBrowserNodeShimPlugin(options: { includeMobileBuiltins?: boolean } = {}) {
  const filter = options.includeMobileBuiltins
    ? /^(node:)?(fs|path|crypto|fs\/promises|os|buffer|util|events|http|https|net|dgram|tls|http2|zlib|stream|url|child_process)$/
    : /^(node:)?(fs|path|crypto|net|http|https|tls|dgram|fs\/promises|os|buffer|util|events|child_process)/;

  const cryptoShimContents = `
    const browserCrypto = typeof crypto !== 'undefined' ? crypto : {};
    const SHA256_K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);
    function sha256Sync(input) {
      const data = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
      const bitLen = BigInt(data.length) * 8n;
      const withOneLen = data.length + 1 + 8;
      const rem = withOneLen % 64;
      const paddedLen = withOneLen + (rem === 0 ? 0 : 64 - rem);
      const buf = new Uint8Array(paddedLen);
      buf.set(data, 0);
      buf[data.length] = 0x80;
      const dv = new DataView(buf.buffer);
      dv.setBigUint64(paddedLen - 8, bitLen, false);
      let h0=0x6a09e667, h1=0xbb67ae85, h2=0x3c6ef372, h3=0xa54ff53a, h4=0x510e527f, h5=0x9b05688c, h6=0x1f83d9ab, h7=0x5be0cd19;
      const w = new Uint32Array(64);
      const rotr = (x, n) => (x >>> n) | (x << (32 - n));
      for (let i = 0; i < paddedLen; i += 64) {
        for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
        for (let t = 16; t < 64; t++) {
          const s0 = rotr(w[t-15], 7) ^ rotr(w[t-15], 18) ^ (w[t-15] >>> 3);
          const s1 = rotr(w[t-2], 17) ^ rotr(w[t-2], 19) ^ (w[t-2] >>> 10);
          w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0;
        }
        let a=h0, b=h1, c=h2, d=h3, e=h4, f=h5, g=h6, h=h7;
        for (let t = 0; t < 64; t++) {
          const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
          const ch = (e & f) ^ ((~e) & g);
          const temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
          const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const temp2 = (S0 + maj) >>> 0;
          h = g; g = f; f = e; e = (d + temp1) >>> 0;
          d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
      }
      const out = new Uint8Array(32);
      const outDv = new DataView(out.buffer);
      [h0,h1,h2,h3,h4,h5,h6,h7].forEach((val, idx) => outDv.setUint32(idx * 4, val, false));
      return out;
    }
    export default browserCrypto;
    export const webcrypto = browserCrypto;
    export const subtle = browserCrypto.subtle;
    export function getRandomValues(arr) { return browserCrypto.getRandomValues ? browserCrypto.getRandomValues(arr) : arr; }
    export function randomUUID() {
      if (browserCrypto.randomUUID) return browserCrypto.randomUUID();
      if (!browserCrypto.getRandomValues) {
        throw new Error('CSPRNG unavailable: crypto.getRandomValues is required');
      }
      const b = new Uint8Array(16);
      browserCrypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
    }
    export function randomBytes(size) {
      const b = new Uint8Array(size);
      if (browserCrypto.getRandomValues) browserCrypto.getRandomValues(b);
      return b;
    }
    export function createHash(alg) {
      if (alg && String(alg).toLowerCase().replace('-', '') !== 'sha256') {
        throw new Error('Browser shim only supports sha256 synchronous hashing; unsupported: ' + alg);
      }
      const chunks = [];
      return {
        update(buf) {
          chunks.push(buf instanceof Uint8Array ? buf : new TextEncoder().encode(String(buf)));
          return this;
        },
        digest(enc) {
          let total = 0;
          for (const c of chunks) total += c.length;
          const merged = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { merged.set(c, off); off += c.length; }
          const out = sha256Sync(merged);
          if (enc === 'hex') return Array.from(out).map(b => b.toString(16).padStart(2, '0')).join('');
          return out;
        }
      };
    }
  `;

  return {
    name: 'node-builtins-shim',
    setup(build: any) {
      build.onResolve({ filter }, (args: any) => ({ path: args.path, namespace: 'node-shim' }));
      build.onLoad({ filter: /.*/, namespace: 'node-shim' }, (args: any) => {
        if (args.path === 'node:crypto' || args.path === 'crypto') {
          return { contents: cryptoShimContents, loader: 'js' };
        }
        if (/^(node:)?(net|http|https|tls)$/.test(args.path)) {
          return {
            contents: `
              export function isIPv4(input) {
                if (typeof input !== 'string') return false;
                const p = input.split('.');
                if (p.length !== 4) return false;
                return p.every(s => /^(0|[1-9]\\d{0,2})$/.test(s) && Number(s) <= 255);
              }
              export function isIPv6(input) {
                if (typeof input !== 'string' || !input.includes(':')) return false;
                if (input.split('::').length > 2) return false;
                return /^[0-9a-fA-F:]+(%[a-zA-Z0-9_.-]+)?$/.test(input);
              }
              export function isIP(input) { return isIPv4(input) ? 4 : (isIPv6(input) ? 6 : 0); }
              export function createServer() { return { listen() {}, on() {}, close() {} }; }
              export function createConnection() { return { on() {}, write() {}, end() {}, destroy() {} }; }
              export function connect() { return createConnection(); }
              export function request() { return { on() {}, write() {}, end() {}, destroy() {} }; }
              export function get() { return request(); }
              export default { isIP, isIPv4, isIPv6, createServer, createConnection, connect, request, get };
            `,
            loader: 'js',
          };
        }
        if (/^(node:)?os$/.test(args.path)) {
          return {
            contents: `
              export function networkInterfaces() { return {}; }
              export function platform() { return 'browser'; }
              export default { networkInterfaces, platform };
            `,
            loader: 'js',
          };
        }
        if (args.path.includes('dgram')) {
          return {
            contents: `
              export function createSocket() { return { on() {}, bind() {}, send() {}, close() {}, addMembership() {}, setMulticastLoopback() {}, setMulticastTTL() {} }; }
              export default { createSocket };
            `,
            loader: 'js',
          };
        }
        if (args.path.includes('child_process')) {
          return {
            contents: `
              export function execSync() { throw new Error('child_process unsupported in browser'); }
              export function spawn() { throw new Error('child_process unsupported in browser'); }
              export default { execSync, spawn };
            `,
            loader: 'js',
          };
        }
        if (args.path.includes('path')) {
          return {
            contents: `
              export const join = (...args) => args.filter(Boolean).join('/');
              export const resolve = (...args) => args.filter(Boolean).join('/');
              export const basename = (p) => String(p || '').split(/[\\\\/]/).pop() || '';
              export const dirname = (p) => String(p || '').split(/[\\\\/]/).slice(0, -1).join('/') || '.';
              export default { join, resolve, basename, dirname };
            `,
            loader: 'js',
          };
        }
        if (args.path.includes('fs')) {
          return {
            contents: `
              export const promises = {
                readFile: async () => new Uint8Array(0),
                writeFile: async () => {},
                unlink: async () => {},
                mkdir: async () => {},
                readdir: async () => [],
              };
              export const existsSync = () => false;
              export const readFileSync = () => '';
              export const writeFileSync = () => {};
              export const mkdirSync = () => {};
              export const copyFileSync = () => {};
              export const renameSync = () => {};
              export const unlinkSync = () => {};
              export default { promises, existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, unlinkSync };
            `,
            loader: 'js',
          };
        }
        return {
          contents: `
            export default {};
            export const createServer = () => ({ listen: () => {}, close: () => {} });
            export const existsSync = () => false;
            export const readFileSync = () => '';
            export const writeFileSync = () => {};
            export const mkdirSync = () => {};
          `,
          loader: 'js',
        };
      });
    },
  };
}
