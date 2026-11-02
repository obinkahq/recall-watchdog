// O2: the live path judges the transactions that the Tatum client returns
// after the cursor, with the rules and the recalled verdicts. Real build of
// dist/live.js in a real process; only the SDK clients are stubs. The
// expected decisions below were written by hand from src/rules.ts and the
// 12 live verdicts in src/live.ts, before the first run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeTmp, runEntry, writeJson } from './support/harness.mjs';
import { fakeAccountId, fakeMemwalKey, fakeTatumKey, freshKeypair, liveFixture } from './support/fixtures.mjs';

// digest -> state, rules (in rule order), patterns of the memories shown
const EXPECTED = {
  LiveT1stranger: { state: 'suppressed', rules: ['new-counterparty'], memories: ['new-counterparty 57rangea'] },
  LiveT2unknown: { state: 'escalated', rules: ['new-counterparty'], memories: ['new-counterparty 57rangeb'] },
  LiveTransferX1: { state: 'clear', rules: [], memories: [] },
  LiveTransferX2: { state: 'clear', rules: [], memories: [] },
  LiveT4borrow: { state: 'escalated', rules: ['new-counterparty', 'unfamiliar-function'], memories: ['unfamiliar-function flash_borrow'] },
  LiveT5token: { state: 'suppressed', rules: ['new-counterparty'], memories: ['new-counterparty nf7marke'] },
  LiveT6swap: { state: 'flag', rules: ['new-counterparty', 'large-amount'], memories: ['large-amount swap'] },
};

// Parse the printJudgement block that follows the live header.
function parseLiveBlock(stdout) {
  const start = stdout.indexOf('--- Live transactions after the cursor');
  assert.ok(start >= 0, 'the live decision block is printed');
  const lines = stdout.slice(start).split('\n').slice(1);
  const out = {};
  let current = null;
  for (const line of lines) {
    if (line.startsWith('summary:')) break;
    const head = line.match(/^(\S+) amount=\S+ SUI fn=\S+ state=(\w+)$/);
    if (head) {
      current = { state: head[2], rules: [], memories: [] };
      out[head[1]] = current;
      continue;
    }
    const flag = line.match(/^ {2}flag \[([a-z-]+)\]/);
    if (flag && current) current.rules.push(flag[1]);
    const memory = line.match(/^ {2}memory .*pattern: ([^|]+?) \| verdict:/);
    if (memory && current) current.memories.push(memory[1]);
  }
  return out;
}

function liveEnv(tmp, watch, extra = {}) {
  return {
    WATCH_ADDRESS: watch,
    TATUM_API_KEY: fakeTatumKey(),
    MEMWAL_KEY: fakeMemwalKey(),
    MEMWAL_ACCOUNT_ID: fakeAccountId(),
    MEMWAL_SERVER_URL: 'http://127.0.0.1:9',
    STUB_FIXTURE: writeJson(path.join(tmp, 'fixture.json'), liveFixture(watch)),
    ...extra,
  };
}

test('live: fetched transactions get rule and memory decisions that match the oracle', () => {
  const { secret, address } = freshKeypair();
  const tmp = makeTmp('live-oracle');
  const run = runEntry('live', liveEnv(tmp, address, { SUI_PRIVATE_KEY: secret }), tmp);
  assert.equal(run.status, 0, `live exit ${run.status}: ${run.stderr}`);
  assert.deepEqual(parseLiveBlock(run.stdout), EXPECTED);
  assert.match(run.stdout, /tatum poll after transfer: foundNew=2\/2/);
  assert.match(run.stdout, /Live checks: PASS/);
  const polls = run.calls.filter((c) => c.method === 'listTransactions');
  assert.deepEqual(polls.map((c) => [c.client, c.after, c.order]), [['tatum', null, 'descending'], ['tatum', 'AAAA', null]]);
  assert.ok(polls[1].sender === address, 'the poll filters on the watch address');
  assert.equal(run.calls.filter((c) => c.method === 'signAndExecuteTransaction' && c.client === 'public').length, 2);
});

test('live: a read-only run (no Sui key) still judges the new transactions', () => {
  const watch = freshKeypair().address;
  const tmp = makeTmp('live-readonly');
  const run = runEntry('live', liveEnv(tmp, watch), tmp);
  assert.equal(run.status, 0, run.stderr);
  const decisions = parseLiveBlock(run.stdout);
  assert.equal(decisions.LiveT1stranger.state, 'suppressed');
  assert.equal(decisions.LiveT5token.state, 'suppressed');
  assert.match(run.stdout, /self-transfer skipped/);
  assert.equal(run.calls.filter((c) => c.method === 'signAndExecuteTransaction').length, 0);
});
