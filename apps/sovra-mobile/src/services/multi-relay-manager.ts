/**
 * @file apps/sovra-mobile/src/services/multi-relay-manager.ts
 * Censorship-Resistant Multi-Relay Connection Manager for Sovra Mobile Client.
 *
 * Implements:
 * 1. Multi-Relay Fallback Swarm: Primary tunnel, offshore seed gateways, local LAN, and custom relays.
 * 2. Automated Failover: Instantly rotates to the next healthy relay if an ISP blocks or shuts down a node.
 * 3. Latency & Health Probing: Actively monitors ping latency and health of all bootstrap relays.
 * 4. User-Defined Custom Relays: Like Nostr, users can add their own private VPS or community node anytime.
 * 5. Zero Single Point of Failure: No single server, domain, or IP can take the network down.
 */

export interface RelayEndpoint {
  id: string;
  name: string;
  url: string;
  region: 'primary' | 'offshore_eu' | 'offshore_ch' | 'local_mesh' | 'localhost' | 'custom';
  status: 'connected' | 'connecting' | 'degraded' | 'offline';
  latencyMs?: number;
  lastChecked?: number;
  isCustom?: boolean;
}

export interface StunServerConfig {
  id: string;
  url: string;
  provider: 'Google' | 'Cloudflare' | 'Mozilla' | 'Twilio' | 'SelfHosted';
  isFreePermanent: boolean;
  purpose: string;
  status: 'active' | 'probing' | 'reachable';
}

export const HARDCODED_FREE_STUN_SERVERS: readonly StunServerConfig[] = [
  {
    id: 'stun_google_1',
    url: 'stun:stun.l.google.com:19302',
    provider: 'Google',
    isFreePermanent: true,
    purpose: 'Free Public NAT Hole-Punch (Primary)',
    status: 'active',
  },
  {
    id: 'stun_google_2',
    url: 'stun:stun1.l.google.com:19302',
    provider: 'Google',
    isFreePermanent: true,
    purpose: 'Free Public NAT Hole-Punch (Fallback)',
    status: 'active',
  },
  {
    id: 'stun_cloudflare',
    url: 'stun:stun.cloudflare.com:3478',
    provider: 'Cloudflare',
    isFreePermanent: true,
    purpose: 'Global Anycast Zero-Domain STUN',
    status: 'active',
  },
  {
    id: 'stun_mozilla',
    url: 'stun:stun.services.mozilla.com',
    provider: 'Mozilla',
    isFreePermanent: true,
    purpose: 'Open-Web Foundation Free STUN',
    status: 'active',
  },
];

export interface DhtBootstrapSeed {
  id: string;
  name: string;
  multiaddrOrIp: string;
  protocol: 'kademlia_dht' | 'libp2p_webrtc' | 'bitswap';
  isPermanent: boolean;
}

export const HARDCODED_PUBLIC_DHT_SEEDS: readonly DhtBootstrapSeed[] = [
  {
    id: 'dht_seed_global_1',
    name: 'Global Mainline Kademlia Seed 1',
    multiaddrOrIp: '142.250.190.46:19302',
    protocol: 'kademlia_dht',
    isPermanent: true,
  },
  {
    id: 'dht_seed_global_2',
    name: 'Cloudflare Anycast IP Mesh Seed',
    multiaddrOrIp: '104.16.132.229:3478',
    protocol: 'kademlia_dht',
    isPermanent: true,
  },
  {
    id: 'dht_seed_libp2p_star',
    name: 'Public Libp2p Decentralized Bootstrap',
    multiaddrOrIp: '/dns4/node0.libp2p.io/tcp/443/wss',
    protocol: 'libp2p_webrtc',
    isPermanent: true,
  },
];

const CUSTOM_RELAYS_STORAGE_KEY = 'sovra_custom_relays_v1';
const DISCOVERED_RELAYS_STORAGE_KEY = 'sovra_discovered_relays_v1';
const ACTIVE_RELAY_STORAGE_KEY = 'sovra_active_relay_url_v1';
const RELAY_SPKI_PINS_STORAGE_KEY = 'sovra_relay_spki_pins_v1';
const CUSTOM_STUN_STORAGE_KEY = 'sovra_custom_stun_v1';
const TOR_SOCKS5_STORAGE_KEY = 'sovra_tor_socks5';
const MAX_DISCOVERED_RELAYS = 32;

function loadSpkiPinsMap(): Record<string, string> {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(RELAY_SPKI_PINS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
  } catch {}
  return {};
}

async function nativeAndroidHttpFetch(
  fullUrl: string,
  init: RequestInit | undefined,
  spkiPin: string | undefined,
  timeoutMs: number,
): Promise<Response | null> {
  if (typeof window === 'undefined') return null;
  const bridge = (window as any).SovraHttpNative;
  if (!bridge || typeof bridge.requestAsync !== 'function') return null;

  let torSocks = '';
  try {
    torSocks = window.localStorage?.getItem(TOR_SOCKS5_STORAGE_KEY) || '';
  } catch {}

  const method = (init?.method || 'GET').toUpperCase();
  const headersObj: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headersObj[k] = v; });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) headersObj[k] = String(v);
    } else {
      Object.assign(headersObj, init.headers as Record<string, string>);
    }
  }
  const bodyStr = typeof init?.body === 'string' ? init.body : '';

  return await new Promise<Response>((resolve, reject) => {
    const reqId = `sh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener('sovraHttpResponse', onResp as any);
      reject(new Error(`Native HTTP timeout (${timeoutMs}ms) for ${fullUrl}`));
    }, timeoutMs);

    const onResp = (ev: any) => {
      const d = ev?.detail;
      if (!d || d.requestId !== reqId) return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('sovraHttpResponse', onResp as any);
      if (d.error) {
        reject(new Error(String(d.error)));
        return;
      }
      let responseBody: BodyInit = String(d.body ?? '');
      if (typeof d.bodyBase64 === 'string' && d.bodyBase64.length > 0) {
        try {
          if (typeof Buffer !== 'undefined') {
            responseBody = new Uint8Array(Buffer.from(d.bodyBase64, 'base64'));
          } else {
            const bin = atob(d.bodyBase64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            responseBody = arr;
          }
        } catch {}
      }
      resolve(
        new Response(responseBody, {
          status: Number(d.status || 200),
          headers: (d.headers && typeof d.headers === 'object') ? d.headers : { 'Content-Type': 'application/json' },
        }),
      );
    };

    window.addEventListener('sovraHttpResponse', onResp as any);
    try {
      bridge.requestAsync(
        reqId,
        fullUrl,
        method,
        JSON.stringify(headersObj),
        bodyStr,
        spkiPin || '',
        torSocks,
        timeoutMs,
      );
    } catch (e) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        window.removeEventListener('sovraHttpResponse', onResp as any);
        reject(e);
      }
    }
  });
}

// Default zero-domain local bootstrap + fallback community relays
const DEFAULT_BOOTSTRAP_RELAYS: Omit<RelayEndpoint, 'status'>[] = [
  {
    id: 'relay_localhost',
    name: 'Local Node Daemon (Loopback)',
    url: 'http://localhost:3001',
    region: 'localhost',
  },
  {
    id: 'relay_local_lan',
    name: 'Direct IPv4 Local Mesh Relay',
    url: 'http://127.0.0.1:3001',
    region: 'local_mesh',
  },
  {
    id: 'relay_offshore_eu',
    name: 'Community Seed Node 1 (Fallback)',
    url: 'https://seed1.sovra.network',
    region: 'offshore_eu',
  },
  {
    id: 'relay_offshore_ch',
    name: 'Community Seed Node 2 (Fallback)',
    url: 'https://seed2.sovra.network',
    region: 'offshore_ch',
  },
];

export class MultiRelayManager {
  private static instance: MultiRelayManager | null = null;
  private relays: RelayEndpoint[] = [];
  private activeRelayIndex = 0;
  private listeners: Set<(relays: RelayEndpoint[], active: RelayEndpoint) => void> = new Set();
  private isProbing = false;
  private manualPinUntil = 0;
  private zeroDomainOnly = true;
  private lastPexSyncAt = 0;
  private spkiPins: Record<string, string> = loadSpkiPinsMap();
  private customStunUrls: string[] = (() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(CUSTOM_STUN_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch {}
    return [];
  })();

  private constructor() {
    this.initRelays();
    this.startBackgroundProbing();
  }

  public static getInstance(): MultiRelayManager {
    if (!MultiRelayManager.instance) {
      MultiRelayManager.instance = new MultiRelayManager();
    }
    return MultiRelayManager.instance;
  }

  private initRelays(): void {
    // 1. Add browser/WebView serving origin first if served from a zero-domain community host (IP/LAN/.onion)
    const initialList: RelayEndpoint[] = [];
    if (typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http')) {
      const originClean = window.location.origin.replace(/\/+$/, '');
      if (this.isZeroDomainRelay(originClean)) {
        initialList.push({
          id: 'relay_page_origin',
          name: `Serving Community Node (${window.location.hostname})`,
          url: originClean,
          region: 'local_mesh',
          status: 'connecting',
        });
      }
    }

    // 2. Add configured env URL if present
    const envUrl = typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL;
    if (envUrl && !DEFAULT_BOOTSTRAP_RELAYS.some(r => r.url === envUrl)) {
      initialList.push({
        id: 'relay_env_custom',
        name: 'Configured Network Relay',
        url: envUrl.replace(/\/+$/, ''),
        region: 'primary',
        status: 'connecting',
      });
    }

    // 2. Add default bootstrap relays
    for (const r of DEFAULT_BOOTSTRAP_RELAYS) {
      initialList.push({
        ...r,
        url: r.url.replace(/\/+$/, ''),
        status: 'connecting',
      });
    }

    // 3. Load user-added custom relays and PEX-discovered volunteer relays
    const custom = this.loadStoredRelays(CUSTOM_RELAYS_STORAGE_KEY);
    const discovered = this.loadStoredRelays(DISCOVERED_RELAYS_STORAGE_KEY);
    for (const c of [...custom, ...discovered]) {
      if (!initialList.some(r => r.url === c.url)) {
        initialList.push(c);
      }
    }

    this.relays = initialList;

    if (typeof process !== 'undefined' && process.env?.SOVRA_ALLOW_DNS === 'true') {
      this.zeroDomainOnly = false;
    } else if (typeof process !== 'undefined' && process.env?.SOVRA_NO_DNS === 'true') {
      this.zeroDomainOnly = true;
    }

    // Check if user previously selected a preferred active relay
    const savedActiveUrl = this.getStorageItem(ACTIVE_RELAY_STORAGE_KEY);
    if (savedActiveUrl) {
      const idx = this.relays.findIndex(r => r.url === savedActiveUrl);
      if (idx >= 0) this.activeRelayIndex = idx;
    }
  }

  public setZeroDomainOnly(enabled: boolean): void {
    this.zeroDomainOnly = enabled;
    const active = this.getActiveRelay();
    if (enabled && active && !this.isZeroDomainRelay(active.url)) {
      const idx = this.relays.findIndex(r => this.isZeroDomainRelay(r.url));
      if (idx >= 0) {
        this.activeRelayIndex = idx;
      }
    }
    this.notifyListeners();
  }

  public isZeroDomainOnly(): boolean {
    return this.zeroDomainOnly;
  }

  private getEligibleRelays(): Array<{ relay: RelayEndpoint; index: number }> {
    const indexed = this.relays.map((relay, index) => ({ relay, index }));
    if (!this.zeroDomainOnly) return indexed;
    return indexed.filter(item => this.isZeroDomainRelay(item.relay.url));
  }

  public setRelaySpkiPin(relayUrl: string, spkiSha256Hex: string): void {
    const cleanUrl = relayUrl.trim().replace(/\/+$/, '');
    const cleanPin = spkiSha256Hex.trim().toLowerCase();
    if (!cleanUrl || !/^[0-9a-f]{64}$/.test(cleanPin)) return;
    this.spkiPins[cleanUrl] = cleanPin;
    this.setStorageItem(RELAY_SPKI_PINS_STORAGE_KEY, JSON.stringify(this.spkiPins));
    try {
      const bridge = typeof window !== 'undefined' ? (window as any).SovraHttpNative : null;
      bridge?.registerSpkiPin?.(cleanUrl, cleanPin);
    } catch {}
  }

  public setTorSocks5Proxy(socksUri: string): void {
    const clean = socksUri.trim();
    if (clean && !/^socks5h?:\/\//i.test(clean)) {
      throw new Error('Tor SOCKS5 URI must start with socks5h:// or socks5://');
    }
    if (!clean) {
      if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(TOR_SOCKS5_STORAGE_KEY); } catch {}
      }
      return;
    }
    this.setStorageItem(TOR_SOCKS5_STORAGE_KEY, clean);
  }

  public getTorSocks5Proxy(): string {
    return this.getStorageItem(TOR_SOCKS5_STORAGE_KEY) || '';
  }

  /**
   * Fetches an arbitrary relay/mirror HTTP/HTTPS/.onion URL routing automatically through
   * Android `SovraHttpNative` (SPKI TLS pinning + Tor SOCKS5 proxy + binary base64) when inside APK.
   */
  public async nativeFetch(
    fullUrl: string,
    init?: RequestInit,
    timeoutMs = 8000,
  ): Promise<Response> {
    const cleanBase = (() => {
      try {
        const u = new URL(fullUrl);
        return `${u.protocol}//${u.host}`;
      } catch {
        return fullUrl;
      }
    })();
    const spkiPin = this.getRelaySpkiPin(cleanBase) || this.getRelaySpkiPin(fullUrl);
    const nativeRes = await nativeAndroidHttpFetch(fullUrl, init, spkiPin, timeoutMs);
    if (nativeRes) return nativeRes;
    return fetch(fullUrl, init);
  }

  public getRelaySpkiPin(relayUrl: string): string | undefined {
    return this.spkiPins[relayUrl.trim().replace(/\/+$/, '')];
  }

  public addCustomStunServer(stunUrl: string): void {
    const clean = stunUrl.trim();
    if (!clean.startsWith('stun:')) return;
    if (!this.customStunUrls.includes(clean)) {
      this.customStunUrls.push(clean);
      this.setStorageItem(CUSTOM_STUN_STORAGE_KEY, JSON.stringify(this.customStunUrls));
    }
  }

  /**
   * Imports signed peer URLs and optional self-signed TLS SPKI SHA-256 certificate pins from a SignedBootstrapBundle.
   */
  public importBootstrapBundle(bundle: {
    peers?: ReadonlyArray<{ httpUrl?: string; spkiSha256?: string }>;
  }, sourceLabel = 'Signed Bundle'): number {
    const urls: string[] = [];
    for (const p of bundle?.peers ?? []) {
      if (p?.httpUrl) {
        urls.push(p.httpUrl);
        if (p.spkiSha256) {
          this.setRelaySpkiPin(p.httpUrl, p.spkiSha256);
        }
      }
    }
    return this.importBootstrapUrls(urls, sourceLabel);
  }

  /**
   * Zero-Domain STUN servers: excludes third-party Google/Cloudflare/Mozilla when zeroDomainOnly is active.
   */
  public getZeroDomainStunServers(): Array<{ url: string }> {
    const custom = this.customStunUrls.map(url => ({ url }));
    if (this.zeroDomainOnly) return custom;
    return [
      ...custom,
      ...HARDCODED_FREE_STUN_SERVERS.map(s => ({ url: s.url })),
    ];
  }

  /**
   * Zero-Domain DHT seeds: excludes third-party hardcoded IPs and /dns4/node0.libp2p.io when zeroDomainOnly is active.
   */
  public getZeroDomainDhtSeeds(): readonly DhtBootstrapSeed[] {
    if (this.zeroDomainOnly) return [];
    return HARDCODED_PUBLIC_DHT_SEEDS;
  }

  /**
   * Zero-Domain WebRTC ICE config: returns only local/community operator STUN when zeroDomainOnly is active.
   */
  public getZeroDomainRtcIceServers(): Array<{ urls: string | string[] }> {
    if (this.zeroDomainOnly) {
      return this.customStunUrls.map(urls => ({ urls }));
    }
    return [...this.customStunUrls.map(urls => ({ urls })), ...this.getRtcIceServers()];
  }

  /**
   * Imports direct IPv4/IPv6/onion HTTP relay URLs from a verified SignedBootstrapBundle or PEX peer list.
   */
  public importBootstrapUrls(urls: readonly string[], sourceLabel = 'Community Bundle'): number {
    let added = 0;
    for (const raw of urls) {
      const cleanUrl = String(raw || '').trim().replace(/\/+$/, '');
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) continue;
      if (this.zeroDomainOnly && !this.isZeroDomainRelay(cleanUrl)) continue;
      if (this.relays.some(r => r.url === cleanUrl)) continue;
      const host = new URL(cleanUrl).hostname;
      this.relays.push({
        id: `pex_bundle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `${sourceLabel} (${host})`,
        url: cleanUrl,
        region: this.isZeroDomainRelay(cleanUrl) ? 'local_mesh' : 'custom',
        status: 'connecting',
      });
      added++;
    }
    if (added > 0) {
      this.saveDiscoveredRelays();
      this.notifyListeners();
    }
    return added;
  }

  public getActiveBaseUrl(): string {
    return this.getActiveRelay().url;
  }

  public getActiveRelay(): RelayEndpoint {
    const candidate = this.relays[this.activeRelayIndex];
    if (candidate && (!this.zeroDomainOnly || this.isZeroDomainRelay(candidate.url))) {
      return candidate;
    }
    const eligible = this.getEligibleRelays();
    return eligible[0]?.relay || this.relays[0]!;
  }

  public getAllRelays(): RelayEndpoint[] {
    return [...this.relays];
  }

  public setActiveRelay(idOrUrl: string): void {
    const idx = this.relays.findIndex(r => r.id === idOrUrl || r.url === idOrUrl);
    if (idx >= 0) {
      this.activeRelayIndex = idx;
      this.manualPinUntil = Date.now() + 60_000;
      this.setStorageItem(ACTIVE_RELAY_STORAGE_KEY, this.relays[idx]!.url);
      this.notifyListeners();
    }
  }

  /**
   * Returns true if a relay endpoint uses zero-domain direct addressing (IPv4/IPv6 literal, localhost, or .onion).
   */
  public isZeroDomainRelay(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return (
        host === 'localhost' ||
        host.endsWith('.onion') ||
        /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
        host.includes(':')
      );
    } catch {
      return false;
    }
  }

  /**
   * Returns up to limit relays sorted by zero-domain direct routing first and lowest measured latency.
   */
  public getFastestRelays(limit = 3): RelayEndpoint[] {
    return this.getEligibleRelays()
      .map(item => item.relay)
      .sort((a, b) => {
        const aDirect = this.isZeroDomainRelay(a.url) ? 0 : 1;
        const bDirect = this.isZeroDomainRelay(b.url) ? 0 : 1;
        const latA = (a.latencyMs ?? 500) + aDirect * 40;
        const latB = (b.latencyMs ?? 500) + bDirect * 40;
        return latA - latB;
      })
      .slice(0, Math.max(1, limit));
  }

  public async addCustomRelay(url: string, name?: string): Promise<RelayEndpoint> {
    const cleanUrl = url.trim().replace(/\/+$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      throw new Error('Relay URL must begin with http:// or https://');
    }

    const existing = this.relays.find(r => r.url === cleanUrl);
    if (existing) return existing;

    const newRelay: RelayEndpoint = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name?.trim() || `Custom Node (${new URL(cleanUrl).hostname})`,
      url: cleanUrl,
      region: 'custom',
      status: 'connecting',
      isCustom: true,
    };

    this.relays.push(newRelay);
    this.saveCustomRelays();

    // Probe latency immediately
    await this.pingRelay(newRelay);
    this.notifyListeners();
    return newRelay;
  }

  public removeCustomRelay(id: string): void {
    this.relays = this.relays.filter(r => r.id !== id);
    this.saveCustomRelays();
    if (this.activeRelayIndex >= this.relays.length) {
      this.activeRelayIndex = 0;
    }
    this.notifyListeners();
  }

  public static readonly FAST_TIMEOUT_MS = 1500;

  private async tryFetchRelay(
    relay: RelayEndpoint,
    cleanPath: string,
    init?: RequestInit,
    timeoutMs: number = MultiRelayManager.FAST_TIMEOUT_MS,
  ): Promise<Response> {
    const fullUrl = `${relay.url}${cleanPath}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const mergedInit: RequestInit = {
      ...init,
      signal: controller.signal,
    };

    try {
      const spkiPin = this.getRelaySpkiPin(relay.url);
      const nativeRes = await nativeAndroidHttpFetch(fullUrl, init, spkiPin, timeoutMs);
      const res = nativeRes ?? (await fetch(fullUrl, mergedInit));
      clearTimeout(timeoutId);

      if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 530) {
        throw new Error(`HTTP ${res.status} Bad Gateway on ${relay.name}`);
      }
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * Resilient Fetch with fast 1.5s timeout and concurrent multi-relay failover race.
   * If the active relay is offline, blocked, or slow (>1.5s), concurrently races candidate relays.
   */
  public async fetchWithFallback(path: string, init?: RequestInit, _maxAttempts?: number): Promise<Response> {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const activeRelay = this.getActiveRelay();

    // 1. Fast attempt on active relay (1.5s timeout)
    try {
      const res = await this.tryFetchRelay(activeRelay, cleanPath, init, MultiRelayManager.FAST_TIMEOUT_MS);
      activeRelay.status = 'connected';
      return res;
    } catch (activeErr) {
      activeRelay.status = 'offline';
      console.warn(`[MultiRelayManager] Active relay (${activeRelay.name}) failed or timed out:`, (activeErr as Error).message);
    }

    // 2. Fast non-blocking concurrent fallback race across remaining eligible candidate relays
    const fallbackCandidates = this.getEligibleRelays().filter(item => item.relay.id !== activeRelay.id);

    if (fallbackCandidates.length === 0) {
      throw new Error(`Active relay ${activeRelay.name} failed and no fallback relays available.`);
    }

    const candidatePromises = fallbackCandidates.map(async ({ relay, index }) => {
      try {
        const res = await this.tryFetchRelay(relay, cleanPath, init, MultiRelayManager.FAST_TIMEOUT_MS);
        relay.status = 'connected';
        if (index !== this.activeRelayIndex) {
          this.activeRelayIndex = index;
          this.setStorageItem(ACTIVE_RELAY_STORAGE_KEY, relay.url);
          this.notifyListeners();
        }
        return res;
      } catch (err) {
        relay.status = 'offline';
        throw err;
      }
    });

    try {
      // Promise.any fulfills with the first candidate that succeeds
      return await Promise.any(candidatePromises);
    } catch {
      throw new Error('All bootstrap and community relays unreachable within 1.5s timeout. Check network connectivity.');
    }
  }

  /**
   * Pings a specific relay to measure latency and health with fast 1.5s timeout.
   */
  public async pingRelay(relay: RelayEndpoint): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), MultiRelayManager.FAST_TIMEOUT_MS);

      const spkiPin = this.getRelaySpkiPin(relay.url);
      const nativeRes = await nativeAndroidHttpFetch(
        `${relay.url}/api/status`,
        { method: 'GET' },
        spkiPin,
        MultiRelayManager.FAST_TIMEOUT_MS,
      );
      const res = nativeRes ?? (await fetch(`${relay.url}/api/status`, {
        method: 'GET',
        signal: controller.signal,
      }));
      clearTimeout(tid);

      const latency = Date.now() - start;
      relay.lastChecked = Date.now();
      relay.latencyMs = latency;

      if (res.ok) {
        relay.status = 'connected';
        return { ok: true, latencyMs: latency };
      } else {
        relay.status = 'degraded';
        return { ok: false, latencyMs: latency };
      }
    } catch {
      relay.status = 'offline';
      relay.lastChecked = Date.now();
      return { ok: false, latencyMs: 9999 };
    }
  }

  /**
   * Pings all registered bootstrap, PEX-discovered, and custom relays in parallel,
   * and triggers Peer Exchange (PEX) discovery from live volunteer nodes.
   */
  public async pingAllRelays(): Promise<void> {
    if (this.isProbing) return;
    this.isProbing = true;

    try {
      const targets = this.getEligibleRelays().map(i => i.relay);
      await Promise.allSettled(targets.map(r => this.pingRelay(r)));

      const active = this.getActiveRelay();
      const healthy = targets
        .filter(r => r.status === 'connected')
        .sort((a, b) => {
          const aZero = this.isZeroDomainRelay(a.url) ? 0 : 1;
          const bZero = this.isZeroDomainRelay(b.url) ? 0 : 1;
          const scoreA = (a.latencyMs ?? 9999) + aZero * 40;
          const scoreB = (b.latencyMs ?? 9999) + bZero * 40;
          return scoreA - scoreB;
        });

      const best = healthy[0];
      if (best) {
        const activeLatency = active.latencyMs ?? 9999;
        const bestLatency = best.latencyMs ?? 9999;
        const unpinned = Date.now() > this.manualPinUntil;
        const activeTunnelPenalty = !this.isZeroDomainRelay(active.url) && this.isZeroDomainRelay(best.url);
        if (
          active.status === 'offline' ||
          (this.zeroDomainOnly && !this.isZeroDomainRelay(active.url)) ||
          (unpinned && best.id !== active.id && (activeLatency > bestLatency + 150 || (activeTunnelPenalty && bestLatency <= 100)))
        ) {
          this.activeRelayIndex = this.relays.findIndex(r => r.id === best.id);
          this.setStorageItem(ACTIVE_RELAY_STORAGE_KEY, best.url);
        }
      }

      if (healthy.length > 0 && Date.now() - this.lastPexSyncAt > 60_000) {
        this.lastPexSyncAt = Date.now();
        this.syncPeerExchangeFromRelays().catch(() => {});
      }
    } finally {
      this.isProbing = false;
      this.notifyListeners();
    }
  }

  /**
   * Queries connected volunteer relays (/api/peers & /api/seeds) via Peer Exchange (PEX)
   * and registers newly discovered zero-domain community relays automatically.
   */
  public async syncPeerExchangeFromRelays(seedBaseUrl?: string): Promise<number> {
    const endpointsToQuery = seedBaseUrl
      ? [seedBaseUrl.replace(/\/+$/, '')]
      : this.getEligibleRelays()
          .filter(i => i.relay.status === 'connected' || this.isZeroDomainRelay(i.relay.url))
          .slice(0, 3)
          .map(i => i.relay.url);

    let addedCount = 0;
    for (const baseUrl of endpointsToQuery) {
      for (const path of ['/api/peers', '/api/seeds']) {
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), MultiRelayManager.FAST_TIMEOUT_MS);
          const res = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
          clearTimeout(tid);
          if (!res.ok) continue;
          const data: any = await res.json();
          if (data?.self?.stunEndpoint && typeof data.self.stunEndpoint === 'string') {
            this.addCustomStunServer(data.self.stunEndpoint);
          }
          if (data?.self?.httpUrl && data?.self?.spkiSha256) {
            this.setRelaySpkiPin(String(data.self.httpUrl), String(data.self.spkiSha256));
          }
          const candidateUrls = new Set<string>();
          if (data?.self?.httpUrl) candidateUrls.add(String(data.self.httpUrl));
          if (Array.isArray(data?.peers)) {
            for (const p of data.peers) {
              if (p?.httpUrl) candidateUrls.add(String(p.httpUrl));
            }
          }
          for (const rawUrl of candidateUrls) {
            const cleanUrl = rawUrl.trim().replace(/\/+$/, '');
            if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) continue;
            if (this.zeroDomainOnly && !this.isZeroDomainRelay(cleanUrl)) continue;
            if (this.relays.some(r => r.url === cleanUrl)) continue;
            const currentPex = this.relays.filter(r => r.id.startsWith('pex_'));
            if (currentPex.length >= MAX_DISCOVERED_RELAYS) break;
            const host = new URL(cleanUrl).hostname;
            const entry: RelayEndpoint = {
              id: `pex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: `PEX Volunteer (${host})`,
              url: cleanUrl,
              region: this.isZeroDomainRelay(cleanUrl) ? 'local_mesh' : 'custom',
              status: 'connecting',
            };
            this.relays.push(entry);
            addedCount++;
          }
        } catch {}
      }
    }

    if (addedCount > 0) {
      this.saveDiscoveredRelays();
      this.notifyListeners();
    }
    return addedCount;
  }

  /**
   * Returns STUN servers safe for the current network mode.
   * Under zeroDomainOnly=true (default), returns ONLY user/volunteer self-hosted STUN servers
   * (zero Google, Cloudflare, or Mozilla public servers unless explicitly opted in).
   */
  public getStunServers(): readonly StunServerConfig[] {
    const custom: StunServerConfig[] = this.customStunUrls.map((url, idx) => ({
      id: `custom_stun_${idx + 1}`,
      url: /^(stun|stuns|turn|turns):/i.test(url) ? url : `stun:${url}`,
      provider: 'SelfHosted',
      isFreePermanent: true,
      purpose: 'Zero-Domain Volunteer/Operator STUN',
      status: 'active',
    }));
    if (this.zeroDomainOnly) {
      return custom;
    }
    return [...custom, ...HARDCODED_FREE_STUN_SERVERS];
  }

  /**
   * Returns DHT bootstrap seeds without centralized domain leakage in zero-domain mode.
   * Excludes third-party Google/Cloudflare IPs and /dns4/node0.libp2p.io when zeroDomainOnly=true.
   */
  public getPublicDhtSeeds(): readonly DhtBootstrapSeed[] {
    const importedSeeds: DhtBootstrapSeed[] = this.relays
      .filter(r => this.isZeroDomainRelay(r.url) && r.id !== 'relay_localhost' && r.id !== 'relay_local_lan')
      .map((r, idx) => ({
        id: `zero_domain_seed_${idx + 1}`,
        name: r.name,
        multiaddrOrIp: r.url,
        protocol: 'kademlia_dht',
        isPermanent: false,
      }));
    if (this.zeroDomainOnly) {
      return importedSeeds;
    }
    return [...importedSeeds, ...HARDCODED_PUBLIC_DHT_SEEDS];
  }

  /**
   * Returns WebRTC ICE servers for RTCPeerConnection({ iceServers }).
   * In zero-domain mode, omits all third-party STUN servers unless operator STUN endpoints are configured.
   */
  public getRtcIceServers(): Array<{ urls: string | string[] }> {
    return this.getStunServers().map(s => ({ urls: s.url }));
  }

  /**
   * Returns true if zero-domain relays/seeds (or opted-in fallback seeds) are available.
   */
  public isAutonomousSwarmReady(): boolean {
    if (this.zeroDomainOnly) {
      return this.getEligibleRelays().length > 0;
    }
    return HARDCODED_FREE_STUN_SERVERS.length > 0 && HARDCODED_PUBLIC_DHT_SEEDS.length > 0;
  }

  /**
   * Probes P2P/ICE infrastructure health respecting zeroDomainOnly gating.
   */
  public getAutonomousMeshStatus(): {
    stunCount: number;
    dhtSeedCount: number;
    isZeroDomainAutonomous: boolean;
    iceServers: Array<{ urls: string | string[] }>;
    stunProviders: string[];
  } {
    const stuns = this.getStunServers();
    const seeds = this.getPublicDhtSeeds();
    return {
      stunCount: stuns.length,
      dhtSeedCount: seeds.length,
      isZeroDomainAutonomous: this.isAutonomousSwarmReady(),
      iceServers: this.getRtcIceServers(),
      stunProviders: Array.from(new Set(stuns.map(s => s.provider))),
    };
  }

  public subscribe(listener: (relays: RelayEndpoint[], active: RelayEndpoint) => void): () => void {
    this.listeners.add(listener);
    listener(this.getAllRelays(), this.getActiveRelay());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const relays = this.getAllRelays();
    const active = this.getActiveRelay();
    for (const l of this.listeners) {
      try {
        l(relays, active);
      } catch {}
    }
  }

  private startBackgroundProbing(): void {
    // Initial ping after 1 second
    setTimeout(() => {
      this.pingAllRelays().catch(() => {});
    }, 1000);

    // Periodic ping every 45 seconds
    setInterval(() => {
      this.pingAllRelays().catch(() => {});
    }, 45000);
  }

  private loadStoredRelays(key: string): RelayEndpoint[] {
    try {
      const raw = this.getStorageItem(key);
      if (!raw) return [];
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    } catch {}
    return [];
  }

  private saveCustomRelays(): void {
    const custom = this.relays.filter(r => r.isCustom);
    this.setStorageItem(CUSTOM_RELAYS_STORAGE_KEY, JSON.stringify(custom));
  }

  private saveDiscoveredRelays(): void {
    const pex = this.relays.filter(r => r.id.startsWith('pex_')).slice(-MAX_DISCOVERED_RELAYS);
    this.setStorageItem(DISCOVERED_RELAYS_STORAGE_KEY, JSON.stringify(pex));
  }

  private getStorageItem(key: string): string | null {
    if (typeof localStorage !== 'undefined') {
      try {
        return localStorage.getItem(key);
      } catch {}
    }
    return null;
  }

  private setStorageItem(key: string, val: string): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, val);
      } catch {}
    }
  }
}

export const multiRelayManager = MultiRelayManager.getInstance();
