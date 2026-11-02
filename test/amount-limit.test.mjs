// Finding F8: the large-amount limit at its exact boundary. Oracle: the
// README text ("more than 1 SUI (1,000,000,000 MIST)"), not the code: an
// amount equal to the limit is not flagged, one MIST more is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO } from './support/harness.mjs';
import { LARGE_AMOUNT_MIST, judgeTransaction } from '../dist/rules.js';
import { DEMO_OWNER, KNOWN_COUNTERPARTIES, KNOWN_FUNCTIONS } from '../dist/synthetic.js';

const ctx = { knownCounterparties: KNOWN_COUNTERPARTIES, knownFunctions: KNOWN_FUNCTIONS, watchAddress: DEMO_OWNER };
const known = [...KNOWN_COUNTERPARTIES][0];

function rulesFor(amountMist) {
  const tx = {
    digest: `amount-${amountMist}`, sender: DEMO_OWNER, counterparty: known, amountMist, coinType: '0x2::sui::SUI',
    packageId: '0x2', moduleName: 'pay', functionName: 'transfer', timestampMs: null, status: 'success',
  };
  return judgeTransaction(tx, ctx).map((flag) => flag.rule);
}

test('rules: large-amount flags more than 1 SUI; exactly 1 SUI is not flagged', () => {
  const readme = readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const stated = /`large-amount` flag for a SUI amount of (more than|at least) 1 SUI \(1,000,000,000 MIST\)/.exec(readme);
  assert.ok(stated !== null, 'README states the limit');
  const limit = 1_000_000_000n;
  const equalFlags = stated[1] === 'at least';
  assert.equal(LARGE_AMOUNT_MIST, limit, 'the code limit is the README limit');
  assert.deepEqual(rulesFor(limit - 1n), [], 'one MIST below the limit');
  assert.deepEqual(rulesFor(limit), equalFlags ? ['large-amount'] : [], 'equal to the limit');
  assert.deepEqual(rulesFor(limit + 1n), ['large-amount'], 'one MIST above the limit');
  assert.deepEqual(rulesFor(0n), []);
  assert.equal(equalFlags, false, 'the README says more than: the comparison is strict');
});
