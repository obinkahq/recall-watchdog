// Finding 5: the server rejects a set but malformed WATCH_ADDRESS (no
// silent demo fallback), and a live or memory setting that is only half
// there. Startup errors carry fixed text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEntry } from './support/harness.mjs';
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
