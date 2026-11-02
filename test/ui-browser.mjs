// Finding 3, browser check: the real web UI in headless Chromium against the
// real server build (dist/server.js) with the stub Tatum client. A user
// opens the page, sees live rows with decisions, marks a flag expected and
// sees the row change to suppressed with its memory, then reads the next
// cursor page with the button. Run: npm run test:ui (needs chromium).
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeTmp, startServer, writeJson } from './support/harness.mjs';
import { fakeTatumKey, freshKeypair, liveFixture } from './support/fixtures.mjs';
import { connect, launchChromium } from './support/cdp.mjs';

const watch = freshKeypair().address;
const tmp = makeTmp('ui');
const server = await startServer({
  WATCH_ADDRESS: watch, TATUM_API_KEY: fakeTatumKey(), STUB_FIXTURE: writeJson(path.join(tmp, 'fixture.json'), liveFixture(watch)),
}, tmp);
const browser = await launchChromium(tmp);
const cdp = await connect(browser.wsUrl);
try {
  assert.equal(server.state, 'ready', server.output());
  const page = await cdp.openPage(`${server.url}/`);
  const rows = `[...document.querySelectorAll('#live-list .card')].map((c) => [c.dataset.digest, c.dataset.state])`;
  await page.waitFor(`document.querySelectorAll('#live-list .card').length === 7`, 'first live page');
  const first = await page.evaluate(rows);
  assert.deepEqual(Object.fromEntries(first), {
    LiveT1stranger: 'flag', LiveT2unknown: 'flag', LiveTransferX1: 'clear', LiveTransferX2: 'clear',
    LiveT4borrow: 'flag', LiveT5token: 'flag', LiveT6swap: 'flag',
  });
  const meta = await page.evaluate(`document.getElementById('live-meta').textContent`);
  assert.ok(meta.includes(`Watching ${watch}`) && meta.includes('stub-chain-id'), 'live status line');
  await page.waitFor(`document.querySelectorAll('#list .card').length === 24`, 'demo batch still shown');

  await page.evaluate(`document.querySelector('#live-list .card[data-digest="LiveT1stranger"] button[data-kind="expected"]').click()`);
  await page.waitFor(`document.querySelector('#live-list .card[data-digest="LiveT1stranger"]')?.dataset.state === 'suppressed'`, 'row re-judged');
  const memoryText = await page.evaluate(`document.querySelector('#live-list .card[data-digest="LiveT1stranger"] .mem').textContent`);
  assert.match(memoryText, /Memory behind this decision: watchdog verdict \| pattern: new-counterparty 57rangea \| verdict: expected/);

  await page.evaluate(`document.getElementById('live-more').click()`);
  await page.waitFor(`document.querySelector('#live-list .card[data-digest="LiveT7savings"]') !== null`, 'next cursor page');
  const firstCard = await page.evaluate(`document.querySelector('#live-list .card').dataset.digest`);
  assert.equal(firstCard, 'LiveT7savings', 'new rows go on top');
  assert.equal((await page.evaluate(rows)).length, 8);
  const polls = server.calls().filter((c) => c.method === 'listTransactions').map((c) => c.after);
  assert.deepEqual(polls, [null, 'AAAA', 'AAAA', 'AAAB'], 'the button asks for the page after nextCursor');
  process.stdout.write(`${JSON.stringify({ check: 'ui-browser', firstPage: first, afterVerdict: 'LiveT1stranger suppressed with memory', nextPageTop: firstCard, tatumPolls: polls, result: 'PASS' }, null, 2)}\n`);
} finally {
  cdp.close();
  browser.stop();
  await server.stop();
}
