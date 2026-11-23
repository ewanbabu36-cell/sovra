import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const bundlePath = 'D:\\Sovra-backup-pre-phase15_2.bundle';
const encPath = 'D:\\Sovra-backup-pre-phase15_2.bundle.enc';

if (!fs.existsSync(bundlePath)) {
  console.error('Source bundle not found at:', bundlePath);
  process.exit(1);
}

const encryptionKey = process.env.SOVRA_BACKUP_ENCRYPTION_KEY || (process.env.NODE_ENV === 'test' ? 'sovra-cold-backup-vault-key-test-only' : '');
if (!encryptionKey) {
  console.error('Error: SOVRA_BACKUP_ENCRYPTION_KEY environment variable is required to securely derive backup encryption key.');
  process.exit(1);
}

const rawData = fs.readFileSync(bundlePath);
const salt = crypto.randomBytes(32);
const key = crypto.scryptSync(encryptionKey, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

const encrypted = Buffer.concat([cipher.update(rawData), cipher.final()]);
const tag = cipher.getAuthTag();

// Structure: [32-byte salt][12-byte IV][16-byte Auth Tag][Encrypted Data]
const payload = Buffer.concat([salt, iv, tag, encrypted]);
fs.writeFileSync(encPath, payload);

console.log('Successfully created encrypted backup:');
console.log('Path:', encPath);
console.log('Original size:', rawData.length, 'bytes');
console.log('Encrypted size:', payload.length, 'bytes');
console.log('SHA-256:', crypto.createHash('sha256').update(payload).digest('hex'));

// Verify round-trip decryption
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
if (!decrypted.equals(rawData)) {
  console.error('Decryption mismatch!');
  process.exit(1);
}
console.log('Decryption round-trip verified successfully! 100% byte-for-byte match.');
