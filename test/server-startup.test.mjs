// Finding 5: the server rejects a set but malformed WATCH_ADDRESS (no
// silent demo fallback), and a live or memory setting that is only half
// there. Startup errors carry fixed text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { leaks, makeTmp, runEntry } from './support/harness.mjs';
import { CANARY, fakeAccountId, fakeMemwalKey, fakeTatumKey, freshKeypair } from './support/fixtures.mjs';

test('server: a set but malformed WATCH_ADDRESS stops startup (no demo fallback)', () => {
  for (const bad of ['not-a-sui-address', `0x${'g'.repeat(64)}`, '0x1234']) {
    const run = runEntry('server', { WATCH_ADDRESS: bad, TATUM_API_KEY: fakeTatumKey(), PORT: '9' });
    assert.equal(run.status, 1, bad);
    assert.equal(run.stderr, 'server failed: WATCH_ADDRESS must be 0x followed by 64 hex characters.\n');
    assert.ok(!run.stdout.includes('at http://'), 'the server does not listen');
  }
});

test('server: WATCH_ADDRESS without a Tatum key, or half a memory config, stops startup', () => {
  const watch = freshKeypair().address;
  const noKey = runEntry('server', { WATCH_ADDRESS: watch, PORT: '9' });
  assert.equal(noKey.status, 1);
  assert.match(noKey.stderr, /live mode needs TATUM_API_KEY/);
  const half = runEntry('server', { MEMWAL_KEY: fakeMemwalKey(), PORT: '9' });
  assert.equal(half.status, 1);
  assert.match(half.stderr, /Set both MEMWAL_KEY and MEMWAL_ACCOUNT_ID/);
  const badKey = runEntry('server', { MEMWAL_KEY: `suiprivkey1${CANARY}${'qpzry9x8'.repeat(5)}`, MEMWAL_ACCOUNT_ID: fakeAccountId(), PORT: '9' });
  assert.equal(badKey.status, 1);
  assert.ok(!(badKey.stdout + badKey.stderr).includes(CANARY), 'no key text');
});

// Finding F8: the startup error boundary. Each stop is one fixed line on
// stderr, exit code 1, no listen line, no stack text, no key text.
const STACK_TEXT = /\n\s+at |node:internal|file:\/\/|Error:/;

function assertFixedStop(run, expected, secrets, label) {
  const all = run.stdout + run.stderr;
  assert.equal(run.status, 1, label);
  assert.equal(run.stderr, `server failed: ${expected}\n`, label);
  assert.ok(!run.stdout.includes('at http://'), `${label}: the server does not listen`);
  assert.doesNotMatch(all, STACK_TEXT, `${label}: no stack text`);
  assert.ok(!all.includes(CANARY), `${label}: no canary`);
  for (const secret of secrets) assert.ok(!leaks(all, secret), `${label}: no key text`);
}

test('server startup boundary: a dependency error that repeats the memory key gives fixed text only', () => {
  const key = fakeMemwalKey();
  const run = runEntry('server', { MEMWAL_KEY: key, MEMWAL_ACCOUNT_ID: fakeAccountId(), STUB_FAIL_AT: 'memwalCreate', PORT: '9' });
  assertFixedStop(run, 'startup failed (INTERNAL); details withheld (a dependency error can hold key text)', [key], 'memwalCreate');
  assert.deepEqual(run.calls.map((c) => c.method), ['create'], 'the stub was reached');
});

test('server startup boundary: a port in use stops startup with a clear fixed text', async () => {
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const { port } = blocker.address();
  try {
    const watch = freshKeypair().address;
    const env = { PORT: String(port), WATCH_ADDRESS: watch, TATUM_API_KEY: fakeTatumKey(), MEMWAL_KEY: fakeMemwalKey(), MEMWAL_ACCOUNT_ID: fakeAccountId() };
    const run = runEntry('server', env);
    assertFixedStop(run, `Port ${port} on 127.0.0.1 is in use. Stop the other program or set PORT to a free port.`, [fakeTatumKey(), fakeMemwalKey()], 'port in use');
  } finally {
    blocker.close();
  }
});

test('server startup boundary: missing or bad configuration stops startup with fixed text', () => {
  const tmp = makeTmp('startup-config');
  const empty = path.join(tmp, 'empty.key');
  writeFileSync(empty, '\n', { mode: 0o600 });
  const watch = freshKeypair().address;
  const cases = [
    ['missing secret file', { WATCH_ADDRESS: watch, TATUM_API_KEY_FILE: path.join(tmp, 'no-such-file.key') }, 'TATUM_API_KEY: cannot read the secret file at the configured path'],
    ['empty secret file', { MEMWAL_KEY_FILE: empty, MEMWAL_ACCOUNT_ID: fakeAccountId() }, 'MEMWAL_KEY: the secret file is empty'],
    ['no memory account id', { MEMWAL_KEY: fakeMemwalKey() }, 'Set both MEMWAL_KEY and MEMWAL_ACCOUNT_ID for live memory, or neither for demo memory.'],
    ['bad PORT', { PORT: '70000' }, 'PORT must be an integer from 1 to 65535.'],
    ['bad NETWORK', { NETWORK: 'devnet' }, 'NETWORK must be "testnet" (default) or "mainnet"'],
    ['malformed WATCH_ADDRESS with a key set', { WATCH_ADDRESS: `0x${CANARY}`, TATUM_API_KEY: fakeTatumKey() }, 'WATCH_ADDRESS must be 0x followed by 64 hex characters.'],
  ];
  for (const [label, env, expected] of cases) {
    assertFixedStop(runEntry('server', { PORT: '9', ...env }), expected, [fakeTatumKey(), fakeMemwalKey()], label);
  }
});
