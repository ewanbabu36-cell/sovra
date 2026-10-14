import { sovraDb } from './database-engine.ts';

const users = sovraDb.getAllUsers();
console.log('Total users in sovraDb:', users.length);
for (const u of users) {
  console.log(` - ${u.handle} | ${u.displayName || u.name} | DID: ${u.did} | token: ${u.sessionToken ? 'YES' : 'NO'}`);
}
