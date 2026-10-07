import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIRS_TO_SCAN = ['packages', 'apps', 'services', 'nodes', 'scripts', 'tests'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', '.sovra-storage-dev', 'build', '.cache']);

const PATTERNS = [
  { name: 'TODO_FIXME', regex: /\b(TODO|FIXME|XXX)\b/i },
  { name: 'MOCK_STUB_DUMMY_FAKE', regex: /\b(mock|mocked|stub|dummy|fake|placeholder)\b/i },
  { name: 'DEV_FALLBACK_TEST_ONLY', regex: /\b(test-only|dev-only|development fallback|NODE_ENV\s*!==\s*['"]production['"])\b/i },
  { name: 'HARDCODED_DATA_INITIAL', regex: /\b(INITIAL_|sample\s+data|demo\s+data|Math\.random)\b/i },
  { name: 'AUTH_BYPASS_SECRETS', regex: /\b(master[-_]?key|ADMIN_SECRET|default[-_]?secret|bypass|skipAuth|disableAuth|allowAll)\b/i },
  { name: 'WILDCARD_CORS_NETWORK', regex: /(Access-Control-Allow-Origin.*\*|0\.0\.0\.0|localhost)/i },
  { name: 'CLIENT_CONTROLLED_ACTOR', regex: /\b(req\.body\.(authorDid|userDid|fromDid|actorDid|senderDid)|actorCandidate)\b/i }
];

const findings = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile() && /\.(ts|js|mjs|tsx|jsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      scanFile(fullPath);
    }
  }
}

function scanFile(filePath) {
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  // Skip test files for mock/fixture keywords, but scan them for other patterns
  const isTest = relPath.includes('test') || relPath.includes('spec');
  
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    for (const pat of PATTERNS) {
      if (pat.regex.test(line)) {
        // If in test files and pattern is just "MOCK_STUB_DUMMY_FAKE", skip to keep signal-to-noise ratio high
        if (isTest && pat.name === 'MOCK_STUB_DUMMY_FAKE') continue;
        if (isTest && pat.name === 'HARDCODED_DATA_INITIAL') continue;
        findings.push({
          pattern: pat.name,
          file: relPath,
          line: lineNum,
          snippet: line.trim().slice(0, 160)
        });
      }
    }
  });
}

for (const d of DIRS_TO_SCAN) {
  const p = path.join(ROOT, d);
  if (fs.existsSync(p)) walk(p);
}

fs.writeFileSync('scripts/audit-findings.json', JSON.stringify(findings, null, 2));

console.log(`Scan completed. Total findings: ${findings.length}`);
const counts = {};
findings.forEach(f => {
  counts[f.pattern] = (counts[f.pattern] || 0) + 1;
});
console.log('Category Counts:', counts);
