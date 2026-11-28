/**
 * @file scripts/seed-genesis-content.ts
 * Idempotently populates Sovra's Genesis Curated Content (13 verified channels + 26+ posts + catalog videos)
 * into active storage (JSON + SQLite WAL) so first-time users never experience an Empty Room.
 */

import { sovraDb } from './database-engine.ts';

function main(): void {
  const result = sovraDb.seedGenesisCuratedContent();
  console.log('============================================================');
  console.log('   SOVRA GENESIS CURATED CONTENT SEEDER');
  console.log('============================================================');
  console.log(`Channels Active:    ${result.totalChannels} (Verified: ${result.verifiedChannels}, Added: ${result.channelsAdded})`);
  console.log(`Genesis Posts Live: ${result.totalPosts} (Added: ${result.postsAdded})`);
  console.log(`Videos Catalog:     ${result.totalVideos}`);
  console.log('============================================================');
}

if (process.argv[1] && process.argv[1].endsWith('seed-genesis-content.ts')) {
  main();
}
