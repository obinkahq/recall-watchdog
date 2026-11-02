// O1: no path that handles key material prints, logs, throws or returns a
// dependency error message or text derived from a key. Fake keys only: a
// canary in invalid keys, and generated valid keys whose own text is the
// canary. The SDK stubs throw errors that repeat the key they received.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { filesText, leaks, makeTmp, runEntry, writeJson } from './support/harness.mjs';
import { CANARY, fakeAccountId, fakeMemwalKey, fakeTatumKey, freshKeypair, liveFixture } from './support/fixtures.mjs';
import { FixedError, failureText } from '../dist/errors.js';
import { checkMemwalKey, parseSuiKeypair } from '../dist/keys.js';
import { withRetry } from '../dist/tatum.js';

function badSuiKeys() {
  const valid = freshKeypair().secret;
  const last = valid.at(-1) === 'q' ? 'p' : 'q';
  return {
    'Bech32 with a bad checksum': `suiprivkey1${CANARY}${'qpzry9x8'.repeat(5)}`,
    'hex form': `0x${'c4a7'.repeat(16)}`,
    truncated: valid.slice(0, -6),
    'wrong prefix': `suipubkey1${valid.slice(11)}`,
    'very long': `suiprivkey1${CANARY.repeat(60)}`,
    'with a newline': `${valid}\n${CANARY}`,
    'one changed character': `${valid.slice(0, -1)}${last}`,
  };
}

function assertNoLeak(text, secrets, where) {
  assert.ok(!text.includes(CANARY), `${where}: canary found`);
  for (const secret of secrets) assert.ok(!leaks(text, secret), `${where}: key text found`);
}

function liveEnv(tmp, watch, extra = {}) {
  return {
    WATCH_ADDRESS: watch, TATUM_API_KEY: fakeTatumKey(), MEMWAL_KEY: fakeMemwalKey(), MEMWAL_ACCOUNT_ID: fakeAccountId(),
    STUB_FIXTURE: writeJson(path.join(tmp, 'fixture.json'), liveFixture(watch)), ...extra,
  };
}

test('in process: key parsers throw fixed text with no cause and no key text', () => {
  for (const [name, key] of Object.entries(badSuiKeys())) {
    for (const parse of [() => parseSuiKeypair(key, 'SUI_PRIVATE_KEY'), () => checkMemwalKey(key, 'MEMWAL_KEY')]) {
      let caught = null;
      try { parse(); } catch (error) { caught = error; }
      if (caught === null) continue;
      assert.ok(caught instanceof FixedError, `${name}: a FixedError`);
      assert.equal(caught.cause, undefined, `${name}: no cause`);
      assertNoLeak(`${caught.message}\n${caught.stack}\n${inspect(caught)}`, [key], name);
    }
    assert.throws(() => parseSuiKeypair(key, 'SUI_PRIVATE_KEY'), FixedError, name);
  }
});

test('in process: the error boundary and the Tatum retry drop dependency text', async () => {
  const key = fakeTatumKey();
  const raw = Object.assign(new Error(`decode failed for ${key}`), { code: 'INTERNAL' });
  assert.equal(failureText(raw, 'step'), 'step failed (INTERNAL); details withheld (a dependency error can hold key text)');
  await assert.rejects(withRetry('listTransactions', async () => { throw raw; }), (error) => {
    assert.ok(error instanceof FixedError);
    assertNoLeak(`${error.message}\n${error.stack}`, [key], 'withRetry');
    return true;
  });
});

test('setup and live: invalid Sui keys fail before any chain call, with no key text', () => {
  const watch = freshKeypair().address;
  for (const [name, key] of Object.entries(badSuiKeys())) {
    const tmp = makeTmp('canary-setup');
    const out = path.join(tmp, 'delegate.key');
    const setup = runEntry('setup-account', { SUI_PRIVATE_KEY: key, MEMWAL_DELEGATE_KEY_OUT: out }, tmp);
    assert.equal(setup.status, 1, `${name}: setup exit`);
    assert.match(setup.stderr, /^setup-account failed: SUI_PRIVATE_KEY /, name);
    assertNoLeak(setup.stdout + setup.stderr, [key], `setup ${name}`);
    assert.equal(setup.calls.length, 0, `${name}: no chain call`);
    assert.ok(!existsSync(out), `${name}: no key file`);

    const tmp2 = makeTmp('canary-live');
    const live = runEntry('live', liveEnv(tmp2, watch, { SUI_PRIVATE_KEY: key }), tmp2);
    assert.equal(live.status, 1, `${name}: live exit`);
    assert.match(live.stderr, /^live failed: SUI_PRIVATE_KEY /, name);
    assertNoLeak(live.stdout + live.stderr, [key], `live ${name}`);
    assert.equal(live.calls.length, 0, `${name}: no client was created`);
  }
});

test('setup: a key read from a file gets the same fixed text', () => {
  const tmp = makeTmp('canary-file');
  const keyFile = path.join(tmp, 'owner.key');
  const key = badSuiKeys()['Bech32 with a bad checksum'];
  writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
  const run = runEntry('setup-account', { SUI_PRIVATE_KEY_FILE: keyFile, MEMWAL_DELEGATE_KEY_OUT: path.join(tmp, 'out.key') }, tmp);
  assert.equal(run.status, 1);
  assertNoLeak(run.stdout + run.stderr, [key], 'setup key file');
});

test('setup: chain errors that repeat a valid key do not get out', () => {
  for (const failAt of ['createAccount', 'addDelegateKey']) {
    const { secret } = freshKeypair();
    const tmp = makeTmp('canary-setup-chain');
    const run = runEntry('setup-account', {
      SUI_PRIVATE_KEY: secret, MEMWAL_DELEGATE_KEY_OUT: path.join(tmp, 'delegate.key'), STUB_FAIL_AT: failAt,
      STUB_DELEGATE_KEY: 'de1e'.repeat(16),
    }, tmp);
    assert.equal(run.status, 1, failAt);
    assert.match(run.stderr, /failed \(INTERNAL\); details withheld/, failAt);
    assertNoLeak(run.stdout + run.stderr, [secret], `setup ${failAt}`);
    assertNoLeak(filesText(tmp), [secret], `setup files ${failAt}`);
  }
});

test('live: valid-looking keys that a dependency repeats do not get out', () => {
  const stages = ['memwalCreate', 'health', 'getChainIdentifier', 'signAndExecuteTransaction', 'rememberAndWait', 'recall', 'listMemories', 'listTransactions'];
  for (const failAt of stages) {
    const { secret, address } = freshKeypair();
    const tmp = makeTmp('canary-live-stage');
    const run = runEntry('live', liveEnv(tmp, address, { SUI_PRIVATE_KEY: secret, STUB_FAIL_AT: failAt }), tmp);
    assert.equal(run.status, 1, `${failAt}: exit`);
    assert.match(run.stderr, /^live failed: .+ failed/, failAt);
    assertNoLeak(run.stdout + run.stderr, [secret, fakeTatumKey(), fakeMemwalKey()], `live ${failAt}`);
    assertNoLeak(filesText(tmp), [secret, fakeTatumKey(), fakeMemwalKey()], `live files ${failAt}`);
  }
});

test('setup and live: an error outside every catch prints fixed text only', () => {
  const { secret, address } = freshKeypair();
  const tmp = makeTmp('canary-late-setup');
  const setup = runEntry('setup-account', { SUI_PRIVATE_KEY: secret, MEMWAL_DELEGATE_KEY_OUT: path.join(tmp, 'd.key'), STUB_FAIL_AT: 'createAccountLate' }, tmp);
  assert.equal(setup.status, 1);
  assert.equal(setup.stderr, `setup-account failed: background task failed; ${'details withheld (a dependency error can hold key text)'}\n`);
  assertNoLeak(setup.stdout + setup.stderr, [secret], 'setup late error');
  const tmp2 = makeTmp('canary-late-live');
  const live = runEntry('live', liveEnv(tmp2, address, { SUI_PRIVATE_KEY: secret, STUB_FAIL_AT: 'healthLate' }), tmp2);
  assert.equal(live.status, 1);
  assert.match(live.stderr, /^live failed: background task failed; details withheld/);
  assertNoLeak(live.stdout + live.stderr, [secret, fakeTatumKey(), fakeMemwalKey()], 'live late error');
});

test('live: bad Tatum and Walrus Memory keys, and a key for another address, get fixed text', () => {
  const { secret, address } = freshKeypair();
  const other = freshKeypair().address;
  const cases = [
    ['TATUM_API_KEY', { TATUM_API_KEY: `t-fake ${CANARY} with space` }, /TATUM_API_KEY must be/],
    ['TATUM_API_KEY', { TATUM_API_KEY: `t-fake-${CANARY}\nsecond-line` }, /TATUM_API_KEY must be/],
    ['MEMWAL_KEY', { MEMWAL_KEY: `${CANARY}${'0'.repeat(55)}` }, /MEMWAL_KEY must be/],
    ['MEMWAL_KEY', { MEMWAL_KEY: `suiprivkey1${CANARY}${'qpzry9x8'.repeat(5)}` }, /MEMWAL_KEY is not a valid/],
    ['SUI_PRIVATE_KEY', { SUI_PRIVATE_KEY: secret, WATCH_ADDRESS: other }, /SUI_PRIVATE_KEY does not match WATCH_ADDRESS/],
  ];
  for (const [name, extra, message] of cases) {
    const tmp = makeTmp('canary-live-key');
    const run = runEntry('live', liveEnv(tmp, address, extra), tmp);
    assert.equal(run.status, 1, name);
    assert.match(run.stderr, message, name);
    assertNoLeak(run.stdout + run.stderr, Object.values(extra).filter((v) => !v.startsWith('0x')), `live ${name}`);
    assert.equal(run.calls.length, 0, `${name}: checked before any client`);
  }
});
