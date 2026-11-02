// Finding 6: setup checks and reserves the private key output file before
// any chain call. The stub chain client records each call, so a bad output
// path must give zero chain calls. A good path is a new mode-600 file that
// exists before the first chain call and holds the key before registration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, leaks, makeTmp, runEntry } from './support/harness.mjs';
import { freshKeypair } from './support/fixtures.mjs';

const DELEGATE = 'de1e'.repeat(16);

function chainCalls(run) {
  return run.calls.filter((c) => c.module === 'account').map((c) => c.method);
}

test('setup: a bad output path stops setup with zero chain calls', () => {
  const { secret } = freshKeypair();
  const tmp = makeTmp('setup-bad');
  writeFileSync(path.join(tmp, 'exists.key'), 'old\n', { mode: 0o600 });
  symlinkSync(path.join(tmp, 'elsewhere.key'), path.join(tmp, 'link.key'));
  const inside = path.join(REPO, 'test', 'never-written.key');
  const cases = [
    ['unset', undefined, /Set MEMWAL_DELEGATE_KEY_OUT/],
    ['relative', 'delegate.key', /must be an absolute path/],
    ['missing folder', path.join(tmp, 'missing', 'delegate.key'), /parent folder does not exist/],
    ['inside the repository', inside, /must be outside the repository/],
    ['existing file', path.join(tmp, 'exists.key'), /already exists/],
    ['symbolic link (O_EXCL refuses it)', path.join(tmp, 'link.key'), /already exists/],
  ];
  for (const [name, out, message] of cases) {
    const env = { SUI_PRIVATE_KEY: secret, STUB_DELEGATE_KEY: DELEGATE };
    if (out !== undefined) env.MEMWAL_DELEGATE_KEY_OUT = out;
    const runTmp = makeTmp('setup-bad-run');
    const run = runEntry('setup-account', env, runTmp);
    assert.equal(run.status, 1, name);
    assert.match(run.stderr, message, name);
    assert.deepEqual(chainCalls(run), [], `${name}: zero chain calls`);
    assert.ok(!leaks(run.stdout + run.stderr, secret), `${name}: no key text`);
  }
  assert.ok(!existsSync(inside), 'nothing written inside the repository');
  assert.ok(!existsSync(path.join(tmp, 'elsewhere.key')), 'the link target was not created');
  assert.equal(readFileSync(path.join(tmp, 'exists.key'), 'utf8'), 'old\n', 'an existing file is not changed');
});

test('setup: the output file is reserved (mode 600) before the first chain call', () => {
  const { secret } = freshKeypair();
  const tmp = makeTmp('setup-good');
  const dir = path.join(tmp, 'keys');
  mkdirSync(dir, { mode: 0o700 });
  const out = path.join(dir, 'delegate.key');
  const run = runEntry('setup-account', {
    SUI_PRIVATE_KEY: secret, MEMWAL_DELEGATE_KEY_OUT: out, STUB_DELEGATE_KEY: DELEGATE, STUB_CHECK_FILE: out,
  }, tmp);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(chainCalls(run), ['createAccount', 'generateDelegateKey', 'addDelegateKey']);
  const create = run.calls.find((c) => c.method === 'createAccount');
  assert.deepEqual(create.checkFile, { exists: true, mode: '600', size: 0 }, 'reserved before the chain call');
  const add = run.calls.find((c) => c.method === 'addDelegateKey');
  assert.equal(add.checkFile.size, DELEGATE.length + 1, 'the key is on disk before the registration');
  assert.equal((statSync(out).mode & 0o777).toString(8), '600');
  assert.equal(readFileSync(out, 'utf8'), `${DELEGATE}\n`);
  assert.ok(!run.stdout.includes(DELEGATE) && !run.stderr.includes(DELEGATE), 'the delegate key is not printed');
  assert.ok(!leaks(run.stdout + run.stderr + readFileSync(out, 'utf8'), secret), 'the owner key is nowhere');
  assert.match(run.stdout, /delegateKeyFile=written \(mode 600, value not printed\)/);
});

test('setup: a failed account creation removes the empty reserved file', () => {
  const { secret } = freshKeypair();
  const tmp = makeTmp('setup-fail');
  const out = path.join(tmp, 'delegate.key');
  const run = runEntry('setup-account', { SUI_PRIVATE_KEY: secret, MEMWAL_DELEGATE_KEY_OUT: out, STUB_FAIL_AT: 'createAccount' }, tmp);
  assert.equal(run.status, 1);
  assert.ok(!existsSync(out), 'the empty file is removed so a retry can use the path');
});

test('setup: a failed registration keeps the written key file and says so', () => {
  const { secret } = freshKeypair();
  const tmp = makeTmp('setup-fail-add');
  const out = path.join(tmp, 'delegate.key');
  const run = runEntry('setup-account', {
    SUI_PRIVATE_KEY: secret, MEMWAL_DELEGATE_KEY_OUT: out, STUB_FAIL_AT: 'addDelegateKey', STUB_DELEGATE_KEY: DELEGATE,
  }, tmp);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /may not be registered/);
  assert.equal(readFileSync(out, 'utf8'), `${DELEGATE}\n`);
});
