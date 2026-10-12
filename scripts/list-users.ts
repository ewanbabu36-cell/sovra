import { SqliteSocialDatabaseEngine } from './database-sqlite.ts';

const db = new SqliteSocialDatabaseEngine();
const users = db.getAllUsers();
console.log('Total registered users:', users.length);
console.log('Users list:');
users.forEach(u => console.log(`  - ${u.handle} (${u.displayName || u.name}) | DID: ${u.did}`));
