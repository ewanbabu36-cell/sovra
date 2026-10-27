/**
 * @file tests/reliability/cloud-deployment-artifacts.test.ts
 * SOVRA CLOUD DEPLOYMENT ARTIFACTS VALIDATION SUITE
 *
 * Programmatically validates production container definitions, Docker Compose stacks,
 * Caddy reverse proxy configurations, and Kubernetes manifests for structural validity,
 * security hardening (non-root, dropped caps), probe bindings, and volume persistence.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Sovra Cloud Deployment Artifacts Validation Suite', () => {
  const rootDir = path.resolve(__dirname, '../../');

  it('validates Dockerfile.production security and multi-stage build structure', () => {
    const dockerfilePath = path.join(rootDir, 'docker/Dockerfile.production');
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    // Multi-stage verification
    expect(content).toMatch(/FROM node:22-alpine AS builder/i);
    expect(content).toMatch(/FROM node:22-alpine AS runner/i);

    // Hardening: Non-root execution
    expect(content).toMatch(/USER node/i);

    // Ports exposed
    expect(content).toMatch(/EXPOSE 3001 4001/);

    // Healthcheck defined
    expect(content).toMatch(/HEALTHCHECK/);
    expect(content).toMatch(/\/readyz/);

    // Persistent storage volume declared
    expect(content).toMatch(/VOLUME \["\/app\/\.sovra-storage-prod"\]/);
  });

  it('validates docker-compose.production.yml multi-service stack and healthchecks', () => {
    const composePath = path.join(rootDir, 'docker/docker-compose.production.yml');
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, 'utf8');

    // Services defined
    expect(content).toMatch(/sovra-node:/);
    expect(content).toMatch(/caddy-proxy:/);

    // Volume bindings
    expect(content).toMatch(/sovra-prod-storage:/);
    expect(content).toMatch(/caddy-data:/);

    // Healthcheck and dependency ordering
    expect(content).toMatch(/healthcheck:/);
    expect(content).toMatch(/service_healthy/);

    // Ports mapped
    expect(content).toMatch(/"4001:4001"/); // P2P
    expect(content).toMatch(/"80:80"/);
    expect(content).toMatch(/"443:443"/);
  });

  it('validates Caddyfile reverse proxy, security headers, and SSE bypass', () => {
    const caddyPath = path.join(rootDir, 'docker/Caddyfile');
    expect(fs.existsSync(caddyPath)).toBe(true);
    const content = fs.readFileSync(caddyPath, 'utf8');

    // OWASP Security headers
    expect(content).toMatch(/Strict-Transport-Security/);
    expect(content).toMatch(/X-Content-Type-Options/);
    expect(content).toMatch(/X-Frame-Options/);

    // Compression
    expect(content).toMatch(/encode zstd gzip/);

    // Realtime SSE buffering bypass
    expect(content).toMatch(/flush_interval -1/);
    expect(content).toMatch(/\/api\/realtime\/stream/);

    // Media byte-range support
    expect(content).toMatch(/Accept-Ranges/);

    // Reverse proxy upstream
    expect(content).toMatch(/reverse_proxy sovra-node:3001/);
  });

  it('validates Kubernetes deployment manifest structure and security context', () => {
    const k8sPath = path.join(rootDir, 'deploy/kubernetes/sovra-node.yaml');
    expect(fs.existsSync(k8sPath)).toBe(true);
    const content = fs.readFileSync(k8sPath, 'utf8');

    // K8s Resources
    expect(content).toMatch(/kind: StatefulSet/);
    expect(content).toMatch(/kind: Service/);
    expect(content).toMatch(/kind: Ingress/);

    // Security context: Non-root user
    expect(content).toMatch(/runAsNonRoot: true/);
    expect(content).toMatch(/allowPrivilegeEscalation: false/);

    // Probes configured
    expect(content).toMatch(/livenessProbe:/);
    expect(content).toMatch(/readinessProbe:/);
    expect(content).toMatch(/path: \/readyz/);
    expect(content).toMatch(/path: \/livez/);

    // Storage claim template
    expect(content).toMatch(/volumeClaimTemplates:/);
    expect(content).toMatch(/storage: 50Gi/);

    // Dual services: ClusterIP for HTTP and LoadBalancer for P2P
    expect(content).toMatch(/type: ClusterIP/);
    expect(content).toMatch(/type: LoadBalancer/);
  });

  it('validates turnkey VPS docker-compose.prod.yml stack and WAL volume configuration', () => {
    const composePath = path.join(rootDir, 'deploy/docker-compose.prod.yml');
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, 'utf8');

    // Services
    expect(content).toMatch(/sovra-node:/);
    expect(content).toMatch(/caddy-proxy:/);

    // Ports
    expect(content).toMatch(/"4001:4001"/); // P2P
    expect(content).toMatch(/"3001:3001"/); // HTTP
    expect(content).toMatch(/"3443:3443"/); // HTTPS WebRTC
    expect(content).toMatch(/"80:80"/);
    expect(content).toMatch(/"443:443"/);

    // Volume & Limits
    expect(content).toMatch(/sovra-data-wal:/);
    expect(content).toMatch(/memory: 4096M/);
    expect(content).toMatch(/healthcheck:/);
  });

  it('validates production systemd service unit file with sandboxing and resource caps', () => {
    const servicePath = path.join(rootDir, 'deploy/sovra-node.service');
    expect(fs.existsSync(servicePath)).toBe(true);
    const content = fs.readFileSync(servicePath, 'utf8');

    // Unit definition
    expect(content).toMatch(/\[Unit\]/);
    expect(content).toMatch(/Description=Sovra Sovereign Node/);

    // Production resource limits
    expect(content).toMatch(/LimitNOFILE=65536/);
    expect(content).toMatch(/MemoryMax=4G/);
    expect(content).toMatch(/Restart=always/);

    // Sandboxing flags
    expect(content).toMatch(/NoNewPrivileges=true/);
    expect(content).toMatch(/ProtectSystem=full/);
    expect(content).toMatch(/ProtectHome=true/);
    expect(content).toMatch(/PrivateTmp=true/);
  });

  it('validates turnkey idempotent VPS install.sh bash installer script', () => {
    const scriptPath = path.join(rootDir, 'deploy/install.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const content = fs.readFileSync(scriptPath, 'utf8');

    // Shell header & flags
    expect(content).toMatch(/^#!/);
    expect(content).toMatch(/set -euo pipefail/);

    // Root check
    expect(content).toMatch(/EUID/);

    // Firewall ports
    expect(content).toMatch(/ufw allow 4001\/tcp/);
    expect(content).toMatch(/ufw allow 3001\/tcp/);
    expect(content).toMatch(/ufw allow 3443\/tcp/);
    expect(content).toMatch(/ufw allow 80\/tcp/);
    expect(content).toMatch(/ufw allow 443\/tcp/);

    // Runtimes & systemd integration
    expect(content).toMatch(/docker/);
    expect(content).toMatch(/nodejs/);
    expect(content).toMatch(/sovra-node\.service/);
  });
});
