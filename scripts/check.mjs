// Lint without a framework: file size, banned patterns, secret patterns.
// Runs on src/, scripts/, test/, public/ and the top level docs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['src', 'scripts', 'test', 'public'];
const topFiles = ['README.md', 'VERIFY.md', 'package.json'];
const banned = [
  { name: 'suiprivkey value', re: /suiprivkey1[0-9a-z]{20,}/i },
  { name: 'long hex (64+) outside an allow-listed chain id', re: /(?<![0-9a-fA-F])[0-9a-fA-F]{64,}(?![0-9a-fA-F])/ },
  { name: 'unfinished marker', re: new RegExp('\\b(' + ['TO','DO'].join('') + '|FIX' + 'ME|X' + 'XX)\\b') },
];
const allowHexFiles = new Set(['config.ts', 'synthetic.ts', 'VERIFY.md', 'README.md']);

function filesIn(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(full));
    else out.push(full);
  }
  return out;
}

let failed = false;
function checkFile(file) {
  const rel = path.relative(root, file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length;
  if (lines > 400) { process.stdout.write(`FAIL ${rel}: ${lines} lines (max 400)\n`); failed = true; }
  for (const rule of banned) {
    if (rule.name.startsWith('long hex') && allowHexFiles.has(path.basename(file))) continue;
    if (rule.re.test(text)) { process.stdout.write(`FAIL ${rel}: banned pattern "${rule.name}"\n`); failed = true; }
  }
  if (/console\.log\(/.test(text) && rel.startsWith('src/')) {
    process.stdout.write(`FAIL ${rel}: use process.stdout.write, not console.log\n`); failed = true;
  }
}

for (const dir of dirs) {
  const full = path.join(root, dir);
  try { statSync(full); } catch { continue; }
  for (const file of filesIn(full)) checkFile(file);
}
for (const name of topFiles) {
  try { statSync(path.join(root, name)); } catch { continue; }
  checkFile(path.join(root, name));
}
if (failed) process.exit(1);
process.stdout.write('lint: PASS\n');
