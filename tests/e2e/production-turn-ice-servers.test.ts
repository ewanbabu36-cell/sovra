import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { getIceServers } from '../../scripts/dev-server.ts';

describe('Production Coturn TURN Infrastructure & ICE Config Gate', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SOVRA_TURN_SERVERS;
    delete process.env.SOVRA_TURN_SECRET;
    delete process.env.SOVRA_TURN_USERNAME;
    delete process.env.SOVRA_TURN_CREDENTIAL;
    delete process.env.SOVRA_TURN_TTL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default public STUN servers when no TURN configuration is provided', () => {
    const servers = getIceServers();
    expect(servers.length).toBeGreaterThanOrEqual(4);
    expect(servers.some(s => typeof s.urls === 'string' && s.urls.includes('stun.l.google.com'))).toBe(true);
    // Should have no username or credential for STUN-only
    for (const server of servers) {
      expect(server.username).toBeUndefined();
      expect(server.credential).toBeUndefined();
    }
  });

  it('configures static TURN credentials when SOVRA_TURN_SERVERS and static credentials are set', () => {
    process.env.SOVRA_TURN_SERVERS = 'turn:turn.sovra.network:3478?transport=udp,turn:turn.sovra.network:3478?transport=tcp';
    process.env.SOVRA_TURN_USERNAME = 'prod-user';
    process.env.SOVRA_TURN_CREDENTIAL = 'prod-password-secure';

    const servers = getIceServers();
    const turnEntry = servers.find(s => Array.isArray(s.urls) && s.urls.some(u => u.includes('turn.sovra.network')));
    expect(turnEntry).toBeDefined();
    expect(turnEntry?.username).toBe('prod-user');
    expect(turnEntry?.credential).toBe('prod-password-secure');
    expect(turnEntry?.urls).toEqual([
      'turn:turn.sovra.network:3478?transport=udp',
      'turn:turn.sovra.network:3478?transport=tcp'
    ]);
  });

  it('generates short-lived HMAC-SHA1 credentials via Coturn REST API when SOVRA_TURN_SECRET is configured', () => {
    const secret = 'ultra-secure-turn-secret-key-32bytes';
    process.env.SOVRA_TURN_SERVERS = 'turn:turn.sovra.network:3478?transport=udp,turns:turn.sovra.network:5349?transport=tcp';
    process.env.SOVRA_TURN_SECRET = secret;
    process.env.SOVRA_TURN_TTL = '3600';

    const testDid = 'did:sovra:alice-production-identity';
    const beforeTimestamp = Math.floor(Date.now() / 1000);
    const servers = getIceServers(testDid);
    const afterTimestamp = Math.floor(Date.now() / 1000);

    const turnEntry = servers.find(s => Array.isArray(s.urls) && s.urls.some(u => u.includes('turn.sovra.network')));
    expect(turnEntry).toBeDefined();
    expect(turnEntry?.username).toBeDefined();
    expect(turnEntry?.credential).toBeDefined();

    // Verify username format: <expiry>:<identifier>
    const firstColonIndex = turnEntry!.username!.indexOf(':');
    expect(firstColonIndex).toBeGreaterThan(0);
    const expiryStr = turnEntry!.username!.slice(0, firstColonIndex);
    const identifier = turnEntry!.username!.slice(firstColonIndex + 1);
    const expiry = parseInt(expiryStr, 10);
    expect(identifier).toBe(testDid);
    expect(expiry).toBeGreaterThanOrEqual(beforeTimestamp + 3600);
    expect(expiry).toBeLessThanOrEqual(afterTimestamp + 3600);

    // Verify HMAC-SHA1 calculation
    const expectedHmac = crypto.createHmac('sha1', secret).update(turnEntry!.username!).digest('base64');
    expect(turnEntry?.credential).toBe(expectedHmac);
  });

  it('validates Coturn configuration files exist and contain required security flags', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const turnConfPath = path.resolve(__dirname, '../../docker/turnserver.conf');
    expect(fs.existsSync(turnConfPath)).toBe(true);

    const content = fs.readFileSync(turnConfPath, 'utf8');
    expect(content).toContain('listening-port=3478');
    expect(content).toContain('tls-listening-port=5349');
    expect(content).toContain('min-port=49152');
    expect(content).toContain('max-port=49200');
    expect(content).toContain('lt-cred-mech');
    expect(content).toContain('use-auth-secret');
    expect(content).toContain('fingerprint');
    expect(content).toContain('no-cli');
    expect(content).toContain('no-loopback-peers');
    expect(content).toContain('no-multicast-peers');

    const dockerComposePath = path.resolve(__dirname, '../../docker/docker-compose.production.yml');
    expect(fs.existsSync(dockerComposePath)).toBe(true);
    const composeContent = fs.readFileSync(dockerComposePath, 'utf8');
    expect(composeContent).toContain('coturn:');
    expect(composeContent).toContain('SOVRA_TURN_SERVERS');
    expect(composeContent).toContain('SOVRA_TURN_SECRET');

    const k8sManifestPath = path.resolve(__dirname, '../../deploy/kubernetes/sovra-coturn.yaml');
    expect(fs.existsSync(k8sManifestPath)).toBe(true);
    const k8sContent = fs.readFileSync(k8sManifestPath, 'utf8');
    expect(k8sContent).toContain('kind: Deployment');
    expect(k8sContent).toContain('coturn/coturn');
    expect(k8sContent).toContain('name: sovra-coturn');
    expect(k8sContent).toContain('port: 3478');
    expect(k8sContent).toContain('port: 5349');
  });
});
