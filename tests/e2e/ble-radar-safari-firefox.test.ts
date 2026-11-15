import { describe, it, expect, beforeEach } from 'vitest';
import { sovraBleMesh } from '../../scripts/ble-mesh-engine.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Web Bluetooth Radar & BLE Mesh Multi-Transport (Safari iOS & Firefox)', () => {
  const scriptsViewPath = path.resolve('scripts/views/scripts.view.ts');
  const devServerPath = path.resolve('scripts/dev-server.ts');
  let scriptsContent: string;
  let devServerContent: string;

  beforeEach(() => {
    scriptsContent = fs.readFileSync(scriptsViewPath, 'utf-8');
    devServerContent = fs.readFileSync(devServerPath, 'utf-8');
  });

  describe('1. Static Code Analysis & Bug Fix Verification', () => {
    it('does not contain the false-positive Macintosh check that blocked Chrome on macOS', () => {
      // The old bug was: const isApple = /iPhone|iPad|iPod|Macintosh/i.test(...)
      // Which wrongly marked Chrome on Mac as isApple and disabled Web Bluetooth.
      expect(scriptsContent).not.toMatch(/isApple\s*=\s*\/iPhone\|iPad\|iPod\|Macintosh\/i/);
      expect(scriptsContent).not.toMatch(/navigator\.userAgent.*Macintosh.*isApple/);
    });

    it('implements accurate isIOS and isSafari platform detection', () => {
      expect(scriptsContent).toContain('const isIOS = /iPhone|iPad|iPod/i.test(ua) || (platform === \'MacIntel\' && maxTouchPoints > 1);');
      expect(scriptsContent).toContain('const isSafari = /^((?!chrome|android).)*safari/i.test(ua)');
      expect(scriptsContent).toContain('const isFirefox = /Firefox/i.test(ua);');
    });

    it('detects native iOS CoreBluetooth bridge (window.webkit.messageHandlers.sovraBleBridge)', () => {
      expect(scriptsContent).toContain('window.webkit.messageHandlers.sovraBleBridge');
      expect(scriptsContent).toContain('window.SovraNativeBleBridge');
      expect(scriptsContent).toContain('IOS_COREBLUETOOTH_NATIVE');
    });

    it('supports Bluefy and WebBLE browsers on iOS that inject Web Bluetooth', () => {
      expect(scriptsContent).toContain('hasBluefyOrWebBle');
    });

    it('wires /api/mesh/lan-beacon endpoint in dev-server.ts for Safari iOS and Firefox', () => {
      expect(devServerContent).toContain("url.pathname === '/api/mesh/lan-beacon'");
      expect(devServerContent).toContain("transport = (parsed.transport === 'BLE_GATT_5.3'");
      expect(devServerContent).toContain("'LAN_WEBRTC_MESH'");
    });
  });

  describe('2. Backend LAN Beacon Registration & Multi-Transport Engine', () => {
    it('registers a LAN / WebRTC proximity beacon into sovraBleMesh with LAN_WEBRTC_MESH transport', () => {
      const testPeerDid = 'did:key:z6MksSafariLanTest' + Date.now();
      const beacon = sovraBleMesh.registerBeacon({
        peerDid: testPeerDid,
        handle: '@safari_mesh_user',
        displayName: 'Safari iOS Mesh Node',
        rssiDbm: -54,
        txPowerDbm: -59,
        batteryPct: 88,
        transport: 'LAN_WEBRTC_MESH',
      });

      expect(beacon).toBeDefined();
      expect(beacon.peerDid).toBe(testPeerDid);
      expect(beacon.transport).toBe('LAN_WEBRTC_MESH');
      expect(beacon.signalQuality).toBe('EXCELLENT');
      expect(beacon.distanceMeters).toBeGreaterThan(0);

      // Verify that scanNearbyPeers returns the registered LAN peer
      const scannedPeers = sovraBleMesh.scanNearbyPeers({ maxDistanceMeters: 50 });
      const found = scannedPeers.find(p => p.peerDid === testPeerDid);
      expect(found).toBeDefined();
      expect(found?.transport).toBe('LAN_WEBRTC_MESH');
    });

    it('allows hybrid P2P subnet and WebRTC peers to co-exist alongside BLE GATT peers', () => {
      const gattPeerDid = 'did:key:z6MksGattAndroid' + Date.now();
      const lanPeerDid = 'did:key:z6MksFirefoxLan' + Date.now();

      sovraBleMesh.registerBeacon({
        peerDid: gattPeerDid,
        handle: '@android_gatt',
        displayName: 'Android GATT Node',
        rssiDbm: -50,
        txPowerDbm: -59,
        transport: 'BLE_GATT_5.3',
      });

      sovraBleMesh.registerBeacon({
        peerDid: lanPeerDid,
        handle: '@firefox_lan',
        displayName: 'Firefox LAN Node',
        rssiDbm: -62,
        txPowerDbm: -59,
        transport: 'LAN_WEBRTC_MESH',
      });

      const peers = sovraBleMesh.scanNearbyPeers({ maxDistanceMeters: 100 });
      const gatt = peers.find(p => p.peerDid === gattPeerDid);
      const lan = peers.find(p => p.peerDid === lanPeerDid);

      expect(gatt?.transport).toBe('BLE_GATT_5.3');
      expect(lan?.transport).toBe('LAN_WEBRTC_MESH');
    });
  });

  describe('3. Platform Capability Logic Simulation', () => {
    // Evaluates detectCapabilities logic extracted from scripts.view.ts in isolated environments

    function runDetectCapabilities(env: {
      hasWebBluetooth: boolean;
      ua: string;
      platform: string;
      maxTouchPoints: number;
      hasNativeBridge?: boolean;
    }) {
      const { hasWebBluetooth, ua, platform, maxTouchPoints, hasNativeBridge } = env;

      const isIOS = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
      const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
      const isFirefox = /Firefox/i.test(ua);

      const hasNativeIosBridge = Boolean(hasNativeBridge);
      const hasBluefyOrWebBle = isIOS && hasWebBluetooth;
      const isPhysicalBleSupported = (hasWebBluetooth && (!isSafari || hasBluefyOrWebBle) && !isFirefox) || hasNativeIosBridge;

      let transportMode = 'LAN_WEBRTC_MESH';
      if (hasNativeIosBridge) {
        transportMode = 'IOS_COREBLUETOOTH_NATIVE';
      } else if (hasWebBluetooth && !isSafari && !isFirefox) {
        transportMode = 'BLE_PHYSICAL_RF';
      } else if (hasBluefyOrWebBle) {
        transportMode = 'BLE_PHYSICAL_RF';
      } else if (isIOS) {
        transportMode = 'IOS_MULTI_TRANSPORT_LAN_WEBRTC';
      } else if (isFirefox) {
        transportMode = 'FIREFOX_MULTI_TRANSPORT_LAN_WEBRTC';
      }

      return {
        hasWebBluetooth,
        isIOS,
        isSafari,
        isFirefox,
        hasNativeIosBridge,
        hasBluefyOrWebBle,
        isFallbackRequired: !isPhysicalBleSupported,
        transportMode,
      };
    }

    it('identifies Safari on iPhone as iOS_MULTI_TRANSPORT_LAN_WEBRTC with fallback active', () => {
      const caps = runDetectCapabilities({
        hasWebBluetooth: false, // Apple blocks navigator.bluetooth
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      });

      expect(caps.isIOS).toBe(true);
      expect(caps.isSafari).toBe(true);
      expect(caps.isFirefox).toBe(false);
      expect(caps.isFallbackRequired).toBe(true);
      expect(caps.transportMode).toBe('IOS_MULTI_TRANSPORT_LAN_WEBRTC');
    });

    it('identifies Mozilla Firefox as FIREFOX_MULTI_TRANSPORT_LAN_WEBRTC with fallback active', () => {
      const caps = runDetectCapabilities({
        hasWebBluetooth: false, // Mozilla blocks navigator.bluetooth
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
        platform: 'Win32',
        maxTouchPoints: 0,
      });

      expect(caps.isIOS).toBe(false);
      expect(caps.isFirefox).toBe(true);
      expect(caps.isFallbackRequired).toBe(true);
      expect(caps.transportMode).toBe('FIREFOX_MULTI_TRANSPORT_LAN_WEBRTC');
    });

    it('allows Google Chrome on macOS to use BLE_PHYSICAL_RF without false-positive Apple blocking', () => {
      const caps = runDetectCapabilities({
        hasWebBluetooth: true, // Chrome Mac supports Web Bluetooth
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      });

      expect(caps.isIOS).toBe(false);
      expect(caps.isSafari).toBe(false);
      expect(caps.isFirefox).toBe(false);
      expect(caps.isFallbackRequired).toBe(false);
      expect(caps.transportMode).toBe('BLE_PHYSICAL_RF');
    });

    it('identifies iOS Native Container with CoreBluetooth bridge as IOS_COREBLUETOOTH_NATIVE', () => {
      const caps = runDetectCapabilities({
        hasWebBluetooth: false,
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) SovraNativeApp/1.0',
        platform: 'iPhone',
        maxTouchPoints: 5,
        hasNativeBridge: true, // SovraBleBridge.mm linked in WKWebView
      });

      expect(caps.hasNativeIosBridge).toBe(true);
      expect(caps.isFallbackRequired).toBe(false);
      expect(caps.transportMode).toBe('IOS_COREBLUETOOTH_NATIVE');
    });

    it('identifies Bluefy Web Bluetooth browser on iOS as BLE_PHYSICAL_RF', () => {
      const caps = runDetectCapabilities({
        hasWebBluetooth: true, // Bluefy injects navigator.bluetooth
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Bluefy/1.7.0',
        platform: 'iPhone',
        maxTouchPoints: 5,
      });

      expect(caps.isIOS).toBe(true);
      expect(caps.hasBluefyOrWebBle).toBe(true);
      expect(caps.isFallbackRequired).toBe(false);
      expect(caps.transportMode).toBe('BLE_PHYSICAL_RF');
    });
  });
});
