import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { LocalDiskMediaDriver, SovraMediaStorageManager } from '../../scripts/media-storage-adapter.ts';

describe('Media Storage Adapter Engine', () => {
  const testStorageDir = path.resolve(process.cwd(), `.test-storage-adapter-${Date.now()}`);
  const postsDir = path.join(testStorageDir, 'posts');

  afterAll(() => {
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('saves and reads media via LocalDiskMediaDriver', async () => {
    const driver = new LocalDiskMediaDriver(postsDir);
    const testBuffer = Buffer.from('TEST_IMAGE_BYTES_12345');
    const cid = 'bafkreitestimagecid12345';

    const meta = await driver.save(cid, testBuffer, 'image/webp');
    expect(meta.cid).toBe(cid);
    expect(meta.sizeBytes).toBe(testBuffer.length);
    expect(meta.storageBackend).toBe('local');

    const exists = await driver.exists(cid);
    expect(exists).toBe(true);

    const read = await driver.read(cid);
    expect(read).not.toBeNull();
    expect(read?.buffer.toString()).toBe('TEST_IMAGE_BYTES_12345');
    expect(read?.mimeType).toBe('image/webp');

    const removed = await driver.delete(cid);
    expect(removed).toBe(true);
    expect(await driver.exists(cid)).toBe(false);
  });

  it('instantiates unified SovraMediaStorageManager factory', async () => {
    const manager = new SovraMediaStorageManager(testStorageDir);
    const driver = manager.getDriver();
    expect(driver).toBeDefined();

    const testVideo = Buffer.from('TEST_VIDEO_BYTES_67890');
    const vidCid = 'bafkreitestvideocid67890';
    const meta = await driver.save(vidCid, testVideo, 'video/mp4');
    expect(meta.cid).toBe(vidCid);
    expect(await driver.exists(vidCid)).toBe(true);
  });
});
