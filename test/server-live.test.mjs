// Finding 3, and O1 for HTTP: the server serves a cursor page of live
// transactions with rule and memory decisions, keeps demo mode when
// WATCH_ADDRESS is absent, and answers every failure with fixed text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { leaks, makeTmp, startServer, writeJson } from './support/harness.mjs';
import { CANARY, fakeAccountId, fakeMemwalKey, fakeTatumKey, freshKeypair, liveFixture } from './support/fixtures.mjs';

function liveEnv(tmp, watch, extra = {}) {
  return { WATCH_ADDRESS: watch, TATUM_API_KEY: fakeTatumKey(), STUB_FIXTURE: writeJson(path.join(tmp, 'fixture.json'), liveFixture(watch)), ...extra };
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  return { status: res.status, text: await res.text() };
}

const summary = (body) => Object.fromEntries(JSON.parse(body).decisions.map((d) => [d.digest, [d.state, d.flags.map((f) => f.rule).join('+'), d.memories.length]]));

test('server: no WATCH_ADDRESS is demo mode by choice', async () => {
  const server = await startServer({});
  try {
    assert.equal(server.state, 'ready', server.output());
    const live = JSON.parse((await getJson(`${server.url}/api/live`)).text);
    assert.equal(live.live, false);
    assert.match(live.reason, /WATCH_ADDRESS is not set/);
    const demo = JSON.parse((await getJson(`${server.url}/api/demo`)).text);
    assert.equal(demo.liveWatch, false);
    assert.equal(demo.decisions.length, 24);
  } finally {
    await server.stop();
  }
});

test('server: /api/live pages by cursor and judges each row with rules and recalled verdicts', async () => {
  const watch = freshKeypair().address;
  const tmp = makeTmp('server-live');
  const server = await startServer(liveEnv(tmp, watch), tmp);
  try {
    assert.equal(server.state, 'ready', server.output());
    const first = await getJson(`${server.url}/api/live`);
    assert.equal(first.status, 200, first.text);
    const page1 = JSON.parse(first.text);
    assert.equal(page1.live, true);
    assert.equal(page1.watchAddress, watch);
    assert.equal(page1.afterCursor, 'AAAA');
    assert.equal(page1.nextCursor, 'AAAB');
    assert.deepEqual(summary(first.text), {
      LiveT1stranger: ['flag', 'new-counterparty', 0],
      LiveT2unknown: ['flag', 'new-counterparty', 0],
      LiveTransferX1: ['clear', '', 0],
      LiveTransferX2: ['clear', '', 0],
      LiveT4borrow: ['flag', 'new-counterparty+unfamiliar-function', 0],
      LiveT5token: ['flag', 'new-counterparty', 0],
      LiveT6swap: ['flag', 'new-counterparty+large-amount', 0],
    });
    const verdict = await getJson(`${server.url}/api/verdict`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'new-counterparty 57rangea', kind: 'expected', note: 'rent share' }),
    });
    assert.equal(verdict.status, 200);
    const again = summary((await getJson(`${server.url}/api/live`)).text);
    assert.deepEqual(again.LiveT1stranger, ['suppressed', 'new-counterparty', 1]);
    const second = await getJson(`${server.url}/api/live?after=${encodeURIComponent(page1.nextCursor)}`);
    // decide.ts shows the nearest recalled memory when no verdict matches.
    assert.deepEqual(summary(second.text), { LiveT7savings: ['flag', 'new-counterparty', 1] });
    assert.equal(JSON.parse(second.text).nextCursor, 'AAAC');
    const bad = await getJson(`${server.url}/api/live?after=${encodeURIComponent('not a cursor!')}`);
    assert.equal(bad.status, 400);
    const polls = server.calls().filter((c) => c.method === 'listTransactions').map((c) => c.after);
    assert.deepEqual(polls, [null, 'AAAA', 'AAAA', 'AAAB'], 'one head cursor, then pages after it');
  } finally {
    await server.stop();
  }
});

test('server: failures answer with fixed text and no key text', async () => {
  const watch = freshKeypair().address;
  const memwalKey = fakeMemwalKey();
  const cases = [
    ['listTransactions', '/api/live', undefined, 502],
    ['getChainIdentifier', '/api/live', undefined, 502],
    ['recall', '/api/demo', undefined, 500],
    ['rememberAndWait', '/api/verdict', { pattern: 'p', kind: 'expected', note: 'n' }, 500],
  ];
  for (const [failAt, route, body, status] of cases) {
    const tmp = makeTmp('server-fail');
    const server = await startServer(liveEnv(tmp, watch, { STUB_FAIL_AT: failAt, MEMWAL_KEY: memwalKey, MEMWAL_ACCOUNT_ID: fakeAccountId() }), tmp);
    try {
      assert.equal(server.state, 'ready', server.output());
      const init = body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
      const res = await getJson(`${server.url}${route}`, init);
      assert.equal(res.status, status, `${failAt}: ${res.text}`);
      assert.match(JSON.parse(res.text).error, /failed/);
      for (const text of [res.text, server.output()]) {
        assert.ok(!text.includes(CANARY), `${failAt}: canary`);
        assert.ok(!leaks(text, fakeTatumKey()) && !leaks(text, memwalKey), `${failAt}: key text`);
      }
    } finally {
      await server.stop();
    }
  }
});
