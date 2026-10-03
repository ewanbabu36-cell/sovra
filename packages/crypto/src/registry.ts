/**
 * Cryptographic Dependencies Registry & Security Justification
 * Every cryptographic dependency planned for Phase 2 implementation must be audited here.
 */

export interface VettedCryptoDependency {
  readonly library: string;
  readonly targetVersion: string;
  readonly specification: string;
  readonly securityRationale: string;
  readonly platformCompatibility: string;
  readonly maintenanceStatus: 'active' | 'audited' | 'deprecated';
}

export const APPROVED_CRYPTO_LIBRARIES: readonly VettedCryptoDependency[] = [
  {
    library: '@noble/curves',
    targetVersion: '^1.8.0',
    specification: 'RFC 8032 (Ed25519) & RFC 7748 (X25519)',
    securityRationale:
      'Audited by Cure53; zero dependencies; constant-time operations; resists timing attacks; pure TypeScript/JavaScript.',
    platformCompatibility: 'Node.js 20+, Modern Browsers, React Native, Electron',
    maintenanceStatus: 'audited',
  },
  {
    library: '@noble/hashes',
    targetVersion: '^1.7.0',
    specification: 'FIPS 180-4 (SHA-256), RFC 5869 (HKDF), BLAKE3 specification',
    securityRationale:
      'Audited by Cure53; zero external dependencies; high performance; audited constant-time implementations.',
    platformCompatibility: 'Node.js 20+, Modern Browsers, React Native, Electron',
    maintenanceStatus: 'audited',
  },
  {
    library: '@noble/ciphers',
    targetVersion: '^1.2.0',
    specification: 'RFC 8439 (ChaCha20-Poly1305), NIST SP 800-38D (AES-GCM)',
    securityRationale:
      'Audited by Cure53; memory safe; constant-time authenticated encryption; pure TypeScript.',
    platformCompatibility: 'Node.js 20+, Modern Browsers, React Native, Electron',
    maintenanceStatus: 'audited',
  },
] as const;
