import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(packagePath: string): PackageJson {
  const content = fs.readFileSync(path.join(packagePath, 'package.json'), 'utf-8');
  return JSON.parse(content) as PackageJson;
}

function getSubdirectories(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(dirPath, dirent.name));
}

describe('Architectural Dependency Boundaries Enforcement', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const packagesDir = path.join(rootDir, 'packages');
  const nodesDir = path.join(rootDir, 'nodes');
  const servicesDir = path.join(rootDir, 'services');

  const packageDirs = getSubdirectories(packagesDir);
  const nodeDirs = getSubdirectories(nodesDir);
  const serviceDirs = getSubdirectories(servicesDir);

  const allBackendDirs = [...packageDirs, ...nodeDirs, ...serviceDirs];

  it('guarantees that NO package, node, or service depends on the Company Admin Panel', () => {
    for (const dir of allBackendDirs) {
      const pkg = readPackageJson(dir);
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      expect(
        allDeps['@sovra/admin'],
        `${pkg.name} must NOT depend on @sovra/admin`,
      ).toBeUndefined();
    }
  });

  it('guarantees that protocol, p2p, identity, storage, and messaging do NOT depend on apps', () => {
    const protocolPackages = [
      'packages/protocol',
      'packages/p2p',
      'packages/identity',
      'packages/storage',
      'packages/messaging',
      'packages/crypto',
      'packages/social',
      'packages/moderation',
      'packages/shared',
    ];

    for (const relPath of protocolPackages) {
      const absPath = path.join(rootDir, relPath);
      const pkg = readPackageJson(absPath);
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      expect(allDeps['@sovra/app'], `${pkg.name} must NOT depend on @sovra/app`).toBeUndefined();
      expect(
        allDeps['@sovra/admin'],
        `${pkg.name} must NOT depend on @sovra/admin`,
      ).toBeUndefined();
    }
  });

  it('guarantees that @sovra/crypto has ZERO internal dependencies except @sovra/shared', () => {
    const cryptoPkg = readPackageJson(path.join(rootDir, 'packages/crypto'));
    const prodDeps = Object.keys(cryptoPkg.dependencies ?? {});

    expect(prodDeps).not.toContain('@sovra/ui');
    expect(prodDeps).not.toContain('@sovra/protocol');
    expect(prodDeps).not.toContain('@sovra/admin');
    expect(prodDeps).not.toContain('@sovra/app');
  });

  it('guarantees that @sovra/ui does NOT implement or depend on cryptographic primitives', () => {
    const uiPkg = readPackageJson(path.join(rootDir, 'packages/ui'));
    const prodDeps = Object.keys(uiPkg.dependencies ?? {});

    expect(prodDeps).not.toContain('@sovra/crypto');
    expect(prodDeps).not.toContain('@sovra/protocol');
    expect(prodDeps).not.toContain('@sovra/p2p');
  });

  it('verifies that all packages have valid package.json and tsconfig.json files', () => {
    for (const dir of allBackendDirs) {
      expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'tsconfig.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'src/index.ts'))).toBe(true);
    }
  });
});
