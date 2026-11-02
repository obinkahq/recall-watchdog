// Finding 3, browser check: the real web UI in headless Chromium against the
// real server build (dist/server.js) with the stub Tatum client. A user
// opens the page, sees live rows with decisions, marks a flag expected and
// sees the row change to suppressed with its memory, then reads the next
// cursor page with the button. Then a page of another site in the same
// browser tries to store a verdict (finding F7) and must fail.
// Run: npm run test:ui (needs chromium).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { makeTmp, startServer, writeJson } from './support/harness.mjs';
import { fakeAccountId, fakeMemwalKey, fakeTatumKey, freshKeypair, liveFixture } from './support/fixtures.mjs';
import { connect, launchChromium } from './support/cdp.mjs';

const watch = freshKeypair().address;
const tmp = makeTmp('ui');
const server = await startServer({
  WATCH_ADDRESS: watch, TATUM_API_KEY: fakeTatumKey(), STUB_FIXTURE: writeJson(path.join(tmp, 'fixture.json'), liveFixture(watch)),
  // Live memory stub: each memory write is a rememberAndWait line in the stub log.
  MEMWAL_KEY: fakeMemwalKey(), MEMWAL_ACCOUNT_ID: fakeAccountId(),
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

  // Another site (localhost on another port) tries a text/plain form post,
  // a no-cors text/plain fetch and a JSON fetch that needs a preflight.
  const writesBefore = server.calls().filter((c) => c.method === 'rememberAndWait').length;
  assert.equal(writesBefore, 1, 'the click on the page stored one verdict');
  const target = `${server.url}/api/verdict`;
  const attackPage = `<!doctype html><title>other site</title><iframe name="sink" hidden></iframe>
<form id="f" method="POST" action="${target}" enctype="text/plain" target="sink">
<input type="hidden" name='{"pattern":"new-counterparty 57rangeb","kind":"expected","note":"x","y":"' value='"}'></form>
<script>
const verdict = JSON.stringify({ pattern: 'new-counterparty 57rangeb', kind: 'expected', note: 'set by another site' });
const tries = [
  new Promise((resolve) => { document.querySelector('iframe').addEventListener('load', resolve); document.getElementById('f').submit(); setTimeout(resolve, 3000); }),
  fetch('${target}', { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: verdict }),
  fetch('${target}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: verdict }),
];
Promise.allSettled(tries).then((r) => { window.attackDone = r.map((x) => x.status).join(','); });
</script>`;
  const attacker = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(attackPage); });
  await new Promise((resolve) => attacker.listen(0, '127.0.0.1', resolve));
  let outcome = '';
  try {
    const other = await cdp.openPage(`http://localhost:${attacker.address().port}/`);
    await other.waitFor(`typeof window.attackDone === 'string'`, 'attack page finished');
    outcome = await other.evaluate('window.attackDone');
    assert.equal(outcome.split(',')[2], 'rejected', 'the JSON fetch from another site is blocked by the browser');
  } finally {
    attacker.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const writesAfter = server.calls().filter((c) => c.method === 'rememberAndWait').length;
  assert.equal(writesAfter, writesBefore, 'no verdict stored by another site');
  // The page reads the live list again: the row is still a plain flag.
  await page.evaluate(`loadLive(false).then(() => { window.reread = true; })`);
  await page.waitFor('window.reread === true', 'live list read again');
  assert.equal(await page.evaluate(`document.querySelector('#live-list .card[data-digest="LiveT2unknown"]').dataset.state`), 'flag', 'not suppressed by another site');
  const crossSite = { tries: outcome, writesBefore, writesAfter, result: 'no write' };
  process.stdout.write(`${JSON.stringify({ check: 'ui-browser', firstPage: first, afterVerdict: 'LiveT1stranger suppressed with memory', nextPageTop: firstCard, tatumPolls: polls, crossSite, result: 'PASS' }, null, 2)}\n`);
} finally {
  cdp.close();
  browser.stop();
  await server.stop();
}
