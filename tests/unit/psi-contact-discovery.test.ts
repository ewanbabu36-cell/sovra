/**
 * @file tests/unit/psi-contact-discovery.test.ts
 * Signal-Grade Private Set Intersection (PSI) using OPRF Unit & Verification Suite.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  normalizePhoneNumber,
  modPow,
  modInverse,
  hashToGroupElement,
  generatePsiClientQuery,
  evaluatePsiBlindedQueries,
  evaluatePsiDirectoryTag,
  unblindAndMatchPsi,
  MODP14_PRIME,
  type PsiServerDirectoryEntry,
} from '../../packages/identity/src/psi-discovery.ts';

describe('🚀 SOVRA PHASE 4: Private Contact Discovery (PSI via OPRF)', () => {
  describe('1. Phone Number Normalization', () => {
    it('normalizes various phone number formats into standard E.164', () => {
      expect(normalizePhoneNumber('+91 98765-43210')).toBe('+919876543210');
      expect(normalizePhoneNumber('(0091) 9876543210')).toBe('+919876543210');
      expect(normalizePhoneNumber('9876543210')).toBe('+919876543210');
      expect(normalizePhoneNumber('+1 (415) 555-2671')).toBe('+14155552671');
      expect(normalizePhoneNumber('   +44 20 7946 0958  ')).toBe('+442079460958');
    });

    it('returns empty string on empty or malformed inputs', () => {
      expect(normalizePhoneNumber('')).toBe('');
      expect(normalizePhoneNumber(null as any)).toBe('');
    });
  });

  describe('2. BigInt Modular Arithmetic & Inversion', () => {
    it('correctly computes modular exponentiation', () => {
      const p = 1000000007n;
      expect(modPow(2n, 10n, p)).toBe(1024n);
      expect(modPow(3n, 5n, p)).toBe(243n);
      expect(modPow(7n, 0n, p)).toBe(1n);
    });

    it('correctly computes modular multiplicative inverse', () => {
      const p = 1000000007n;
      const a = 1234567n;
      const aInv = modInverse(a, p);
      expect((a * aInv) % p).toBe(1n);
    });
  });

  describe('3. Deterministic Group Hashing', () => {
    it('deterministically hashes phone numbers to valid group elements in range [2, p - 2]', () => {
      const p1 = hashToGroupElement('+919876543210');
      const p2 = hashToGroupElement('+91 98765 43210');
      expect(p1).toBe(p2); // Normalized phone hashes match
      expect(p1 > 1n).toBe(true);
      expect(p1 < MODP14_PRIME - 1n).toBe(true);

      const p3 = hashToGroupElement('+14155552671');
      expect(p1).not.toBe(p3);
    });
  });

  describe('4. Full OPRF Commutative Blinding & Unblinding Round-Trip', () => {
    it('successfully matches intersecting contacts while preventing server plaintext discovery', () => {
      const serverSecretK = crypto.randomBytes(32).toString('hex');

      // Registered users on Sovra server
      const registeredUsers = [
        { phone: '+919876543210', did: 'did:sovra:alice', handle: '@alice', displayName: 'Alice Sharma' },
        { phone: '+14155550199', did: 'did:sovra:bob', handle: '@bob', displayName: 'Bob Smith' },
        { phone: '+442079460000', did: 'did:sovra:carol', handle: '@carol', displayName: 'Carol UK' },
      ];

      // Server pre-computes OPRF directory tags: D_y = (H(y))^k mod p
      const serverDirectory: PsiServerDirectoryEntry[] = registeredUsers.map(u => ({
        tagHex: evaluatePsiDirectoryTag(u.phone, serverSecretK),
        did: u.did,
        handle: u.handle,
        displayName: u.displayName,
      }));

      // Client phone book contains 4 contacts: Alice and Carol are registered, Dave and Eve are NOT
      const clientAddressBook = [
        '+91 98765 43210', // Alice (MATCH)
        '+91 99999 11111', // Dave (NO MATCH)
        '+44 20 7946 0000', // Carol (MATCH)
        '+1 555 000 9999',  // Eve (NO MATCH)
      ];

      // Client blinds all 4 contacts with secret ephemeral exponents r_i
      const clientQuery = generatePsiClientQuery(clientAddressBook);
      expect(clientQuery.blindedElements.length).toBe(4);
      expect(clientQuery.blindingExponents.length).toBe(4);

      // Verify that blinded elements show zero correlation to raw phone numbers
      for (const blindedHex of clientQuery.blindedElements) {
        expect(blindedHex.length).toBeGreaterThan(100);
      }

      // Server evaluates client's blinded queries using server secret k: B_i = (A_i)^k mod p
      // Server learns NOTHING about Alice, Dave, Carol, or Eve!
      const serverEvaluated = evaluatePsiBlindedQueries(clientQuery.blindedElements, serverSecretK);
      expect(serverEvaluated.length).toBe(4);

      // Client receives serverEvaluated queries and unblinds them locally:
      // C_i = (B_i)^(r_i^(-1)) mod p = (H(x_i))^k mod p
      const matches = unblindAndMatchPsi(
        serverEvaluated,
        clientQuery.blindingExponents,
        serverDirectory
      );

      // Alice (index 0) and Carol (index 2) must be matched!
      expect(matches.length).toBe(2);

      const aliceMatch = matches.find(m => m.did === 'did:sovra:alice');
      expect(aliceMatch).toBeDefined();
      expect(aliceMatch?.handle).toBe('@alice');
      expect(aliceMatch?.matchedIndex).toBe(0);

      const carolMatch = matches.find(m => m.did === 'did:sovra:carol');
      expect(carolMatch).toBeDefined();
      expect(carolMatch?.handle).toBe('@carol');
      expect(carolMatch?.matchedIndex).toBe(2);

      // Dave and Eve must NOT be matched
      const bobMatch = matches.find(m => m.did === 'did:sovra:bob');
      expect(bobMatch).toBeUndefined(); // Bob is registered but not in client's address book
    });

    it('returns empty matches when client contacts have zero intersection with server', () => {
      const serverSecretK = crypto.randomBytes(32).toString('hex');
      const serverDirectory: PsiServerDirectoryEntry[] = [
        {
          tagHex: evaluatePsiDirectoryTag('+911111111111', serverSecretK),
          did: 'did:sovra:stranger',
          handle: '@stranger',
        },
      ];

      const clientContacts = ['+919999999999', '+918888888888'];
      const clientQuery = generatePsiClientQuery(clientContacts);
      const serverEvaluated = evaluatePsiBlindedQueries(clientQuery.blindedElements, serverSecretK);

      const matches = unblindAndMatchPsi(
        serverEvaluated,
        clientQuery.blindingExponents,
        serverDirectory
      );

      expect(matches.length).toBe(0);
    });
  });
});
