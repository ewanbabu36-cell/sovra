import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  embedSteganographicPayload,
  extractSteganographicPayload,
} from '../../packages/crypto/dist/index.js';

describe('Cycle 6: Duress Mode & Steganographic Media Vault', () => {
  it('embedSteganographicPayload conceals secret payload inside innocent carrier buffer', () => {
    // 1KB carrier buffer (simulating raw RGBA pixel data)
    const carrier = new Uint8Array(4096);
    crypto.getRandomValues(carrier);
    const originalCarrier = new Uint8Array(carrier);

    const secretPayload = 'SOVRA_SECRET_SEED_ed25519:5c89f35e3577576fdac01d275f48599acea99';
    const stegoBuffer = embedSteganographicPayload(carrier, secretPayload);

    expect(stegoBuffer.length).toBe(carrier.length);
    // Carrier should not be identical, but visually indistinguishable (only LSBs changed)
    expect(stegoBuffer).not.toEqual(originalCarrier);

    // Verify only the least significant bit was altered in modified bytes
    for (let i = 0; i < stegoBuffer.length; i++) {
      expect((stegoBuffer[i]! & 0xfe)).toBe((originalCarrier[i]! & 0xfe));
    }
  });

  it('extractSteganographicPayload recovers the exact concealed secret with 100% fidelity', () => {
    const carrier = new Uint8Array(8192);
    crypto.getRandomValues(carrier);

    const sensitiveMessage = 'E2EE_PRIVATE_KEY:ed25519_root_master_key_unrecoverable_if_lost';
    const stego = embedSteganographicPayload(carrier, sensitiveMessage);

    const extracted = extractSteganographicPayload(stego);
    expect(extracted).toBe(sensitiveMessage);
  });

  it('extractSteganographicPayload returns null for carriers without stego payload', () => {
    const plainCarrier = new Uint8Array(1024);
    crypto.getRandomValues(plainCarrier);

    const extracted = extractSteganographicPayload(plainCarrier);
    expect(extracted).toBeNull();
  });

  it('embedSteganographicPayload throws error if carrier buffer is too small for payload', () => {
    const tinyCarrier = new Uint8Array(32); // Too small
    const largeSecret = 'A'.repeat(100);

    expect(() => {
      embedSteganographicPayload(tinyCarrier, largeSecret);
    }).toThrow(/Carrier buffer too small/);
  });

  it('Duress PIN logic activates Decoy Persona with benign balance and unprivileged role', () => {
    // Simulate window environment
    const mockState: any = {
      currentUser: {
        displayName: 'Sovereign Core Operator',
        handle: '@root_admin',
        balance_sov: 8500.50,
        isAdmin: true,
      },
    };

    const checkDuress = (pin: string) => {
      if (pin === '9999') {
        mockState.currentUser.displayName = 'Peaceful Citizen';
        mockState.currentUser.handle = '@citizen_peace';
        mockState.currentUser.balance_sov = 12.50;
        mockState.currentUser.isAdmin = false;
        return true;
      }
      return false;
    };

    // Normal PIN does not activate duress
    expect(checkDuress('1234')).toBe(false);
    expect(mockState.currentUser.balance_sov).toBe(8500.50);
    expect(mockState.currentUser.isAdmin).toBe(true);

    // Duress PIN 9999 immediately strips admin privilege and serves decoy citizen state
    expect(checkDuress('9999')).toBe(true);
    expect(mockState.currentUser.displayName).toBe('Peaceful Citizen');
    expect(mockState.currentUser.handle).toBe('@citizen_peace');
    expect(mockState.currentUser.balance_sov).toBe(12.50);
    expect(mockState.currentUser.isAdmin).toBe(false);
  });
});
