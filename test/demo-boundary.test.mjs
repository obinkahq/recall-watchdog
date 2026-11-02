// Finding F8: the demo boundary. Demo chain data only when WATCH_ADDRESS is
// absent by choice (unset or blank), and then no Tatum client and no chain
// call. The demo entry point builds no live client whatever keys are set,
// and its error boundary prints fixed text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaks, runEntry, startServer } from './support/harness.mjs';
import { CANARY, fakeAccountId, fakeMemwalKey, fakeTatumKey, freshKeypair } from './support/fixtures.mjs';

const WITHHELD = 'details withheld (a dependency error can hold key text)';

test('server: demo chain data only when WATCH_ADDRESS is absent, with no Tatum client or call', async () => {
  for (const [label, extra] of [['unset', {}], ['empty', { WATCH_ADDRESS: '' }], ['blank', { WATCH_ADDRESS: '   ' }]]) {
    const server = await startServer({ TATUM_API_KEY: fakeTatumKey(), ...extra });
    try {
      assert.equal(server.state, 'ready', `${label}: ${server.output()}`);
      assert.match(server.output(), /demo chain data/, label);
      const live = await (await fetch(`${server.url}/api/live`)).json();
      assert.equal(live.live, false, label);
      const demo = await (await fetch(`${server.url}/api/demo`)).json();
      assert.equal(demo.liveWatch, false, label);
      assert.equal(demo.decisions.length, 24, label);
      const live2 = await (await fetch(`${server.url}/api/live?after=AAAA`)).json();
      assert.equal(live2.live, false, `${label}: a cursor does not switch to live`);
      assert.deepEqual(server.calls(), [], `${label}: no SDK client was built and no chain call was made`);
    } finally {
      await server.stop();
    }
  }
});

test('demo: builds no live client and makes no call, whatever keys are set', () => {
  const owner = freshKeypair();
  const keys = { TATUM_API_KEY: fakeTatumKey(), MEMWAL_KEY: fakeMemwalKey(), SUI_PRIVATE_KEY: owner.secret };
  const run = runEntry('demo', { ...keys, MEMWAL_ACCOUNT_ID: fakeAccountId(), WATCH_ADDRESS: owner.address });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Demo checks: PASS/);
  assert.deepEqual(run.calls, [], 'no SDK client call');
  for (const key of Object.values(keys)) assert.ok(!leaks(run.stdout + run.stderr, key), 'no key text');
});

test('demo: the error boundary prints fixed text for a dependency error', () => {
  const echo = `echo-${CANARY}-0123456789abcdef`;
  for (const failAt of ['mockRecall', 'mockRememberAndWait']) {
    const run = runEntry('demo', { STUB_FAIL_AT: failAt, STUB_ECHO: echo });
    assert.equal(run.status, 1, failAt);
    assert.equal(run.stderr, `demo failed: demo failed (INTERNAL); ${WITHHELD}\n`, failAt);
    assert.ok(!(run.stdout + run.stderr).includes(CANARY), `${failAt}: no dependency text`);
    assert.ok(!run.stdout.includes('Demo checks: PASS'), failAt);
  }
});
