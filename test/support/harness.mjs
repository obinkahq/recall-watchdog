// Test harness: run a built entry point (dist/<name>.js) as a real process
// with the SDK stubs and the network guard, and look for leaked key text.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS = path.join(REPO, 'test', 'support', 'stub-hooks.mjs');

export function makeTmp(label) {
  return mkdtempSync(path.join(tmpdir(), `rw-${label}-`));
}

function baseEnv(tmp, env) {
  return { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, STUB_LOG: path.join(tmp, 'stub-calls.jsonl'), ...env };
}

// Run one entry point to the end. Returns exit code, output and stub calls.
export function runEntry(entry, env, tmp = makeTmp(entry)) {
  const result = spawnSync(process.execPath, ['--import', HOOKS, path.join(REPO, 'dist', `${entry}.js`)], {
    cwd: REPO,
    env: baseEnv(tmp, env),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls: stubCalls(tmp), tmp };
}

export function stubCalls(tmp) {
  try {
    return readFileSync(path.join(tmp, 'stub-calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// A port that the system reports free on the loopback host just now.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Start the web server with the stubs. Resolves when it listens.
export async function startServer(env, tmp = makeTmp('server')) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', HOOKS, path.join(REPO, 'dist', 'server.js')], {
    cwd: REPO,
    env: baseEnv(tmp, { PORT: String(port), ...env }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => { output += b.toString(); });
  child.stderr.on('data', (b) => { output += b.toString(); });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  const ready = new Promise((resolve) => {
    const timer = setInterval(() => { if (output.includes('at http://127.0.0.1:')) { clearInterval(timer); resolve('ready'); } }, 50);
    exited.then(() => { clearInterval(timer); resolve('exited'); });
  });
  const state = await Promise.race([ready, new Promise((resolve) => setTimeout(() => resolve('timeout'), 20_000))]);
  return {
    state,
    port,
    tmp,
    url: `http://127.0.0.1:${port}`,
    output: () => output,
    exitCode: () => child.exitCode,
    calls: () => stubCalls(tmp),
    async stop() {
      if (child.exitCode === null) child.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
    },
  };
}

// True when a run of 10 or more characters of the secret shows in the text.
export function leaks(text, secret) {
  const clean = secret.replace(/^suiprivkey1/i, '');
  for (let i = 0; i + 10 <= clean.length; i += 1) {
    const part = clean.slice(i, i + 10);
    if (/^(.)\1+$/.test(part)) continue;
    if (text.includes(part)) return true;
  }
  return false;
}

// Every file under dir (recursive) as text, for a leak scan of written files.
export function filesText(dir) {
  let out = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out += filesText(full);
    else if (statSync(full).size < 1_000_000) out += readFileSync(full, 'utf8');
  }
  return out;
}

export function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value));
  return file;
}
