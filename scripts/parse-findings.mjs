import fs from 'node:fs';

const findings = JSON.parse(fs.readFileSync('scripts/audit-findings.json', 'utf8'));

console.log('=== AUTH_BYPASS_SECRETS ===');
findings.filter(f => f.pattern === 'AUTH_BYPASS_SECRETS').forEach(f => {
  console.log(`${f.file}:${f.line} -> ${f.snippet}`);
});

console.log('\n=== CLIENT_CONTROLLED_ACTOR ===');
findings.filter(f => f.pattern === 'CLIENT_CONTROLLED_ACTOR').forEach(f => {
  console.log(`${f.file}:${f.line} -> ${f.snippet}`);
});

console.log('\n=== MOCK_STUB_DUMMY_FAKE in production paths (non-tests) ===');
findings.filter(f => f.pattern === 'MOCK_STUB_DUMMY_FAKE' && !f.file.includes('test')).forEach(f => {
  console.log(`${f.file}:${f.line} -> ${f.snippet}`);
});

console.log('\n=== HARDCODED_DATA_INITIAL in production paths (non-tests) ===');
findings.filter(f => f.pattern === 'HARDCODED_DATA_INITIAL' && !f.file.includes('test')).forEach(f => {
  console.log(`${f.file}:${f.line} -> ${f.snippet}`);
});
