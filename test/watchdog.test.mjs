// J1 counts, the mainnet guard, and input validation. Runs against dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { judgeBatch } from '../dist/decide.js';
import { createDemoMemory, parseVerdictText, verdictText } from '../dist/memory.js';
import { judgeTransaction } from '../dist/rules.js';
import { DEMO_OWNER, KNOWN_COUNTERPARTIES, KNOWN_FUNCTIONS, SCRIPTED_VERDICTS, syntheticBatch } from '../dist/synthetic.js';

const ctx = { knownCounterparties: KNOWN_COUNTERPARTIES, knownFunctions: KNOWN_FUNCTIONS, watchAddress: DEMO_OWNER };

test('J1: pass 2 shows fewer active flags than pass 1', async () => {
  const batch = syntheticBatch();
  assert.equal(batch.length, 24);
  const memory = createDemoMemory('recall-watchdog');
  try {
    const first = await judgeBatch(batch, ctx, memory);
    assert.ok(first.activeFlags >= 10, `pass 1 active=${first.activeFlags}`);
    for (const verdict of SCRIPTED_VERDICTS) await memory.rememberVerdict(verdict);
    assert.ok(SCRIPTED_VERDICTS.length >= 6);
    const second = await judgeBatch(batch, ctx, memory);
    assert.ok(second.activeFlags < first.activeFlags, `pass1=${first.activeFlags} pass2=${second.activeFlags}`);
    assert.ok(second.suppressedFlags >= 1);
    const suppressed = second.decisions.find((d) => d.state === 'suppressed');
    assert.ok(suppressed && suppressed.memories.length >= 1, 'suppressed flag must list its memories');
    assert.ok((await memory.count()) >= 6);
  } finally {
    memory.close();
  }
});

test('rules: known transfer is clear, stranger large buy is flagged', () => {
  const batch = syntheticBatch();
  const known = batch[0];
  assert.equal(judgeTransaction(known, ctx).length, 0);
  const market = batch.find((t) => t.functionName === 'buy_listing');
  assert.ok(judgeTransaction(market, ctx).length >= 2);
});

test('verdict text round trip', () => {
  const v = { pattern: 'large-amount swap', kind: 'expected', note: 'planned' };
  assert.deepEqual(parseVerdictText(verdictText(v)), v);
  assert.equal(parseVerdictText('unrelated text'), null);
});

test('mainnet guard: NETWORK=mainnet without ALLOW_MAINNET refuses to run the demo server config', () => {
  let output = '';
  try {
    execFileSync(process.execPath, ['-e', "import('./dist/config.js').then(m=>{m.resolveNetwork()})"], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, NETWORK: 'mainnet', ALLOW_MAINNET: '' },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.fail('mainnet without the allow flag must throw');
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`;
  }
  assert.match(output, /refused|ALLOW_MAINNET/);
});
