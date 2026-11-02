// Finding 4: only SUI balance changes count as MIST. A mixed-token
// transaction with a large non-SUI change and a small SUI change must not
// get a large-amount flag; the long form of the SUI coin type still counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSuiCoinType, toWatchTransaction } from '../dist/tatum.js';
import { judgeTransaction } from '../dist/rules.js';
import { SUI_LONG, TOKEN, addr } from './support/fixtures.mjs';

const watch = addr('1111');
const other = addr('2222');
const ctx = { knownCounterparties: new Set(), knownFunctions: new Set(), watchAddress: watch };

function mapped(changes) {
  return toWatchTransaction({
    $kind: 'Transaction',
    Transaction: {
      digest: 'mixed', timestampMs: 1,
      balanceChanges: changes.map(([coinType, address, amount]) => ({ coinType, address, amount: String(amount) })),
      transaction: { sender: watch, commands: [] },
    },
  }, watch);
}

test('mapping: a large non-SUI change is not counted as SUI (review mixed-token case)', () => {
  const tx = mapped([['0x2::sui::SUI', watch, -1_000_000], [TOKEN, watch, -2_000_000_000], [TOKEN, other, 2_000_000_000]]);
  assert.equal(tx.amountMist, 1_000_000n);
  assert.equal(tx.coinType, '0x2::sui::SUI');
  assert.equal(tx.counterparty, other);
  assert.deepEqual(judgeTransaction(tx, ctx).map((f) => f.rule), ['new-counterparty']);
});

test('mapping: a token-only transaction has amount 0', () => {
  const tx = mapped([[TOKEN, watch, -9_000_000_000], [TOKEN, other, 9_000_000_000]]);
  assert.equal(tx.amountMist, 0n);
  assert.ok(!judgeTransaction(tx, ctx).some((f) => f.rule === 'large-amount'));
});

test('mapping: a large SUI change in the long coin type form is still flagged', () => {
  const tx = mapped([[SUI_LONG, watch, -3_000_000_000], [SUI_LONG, other, 3_000_000_000], [TOKEN, watch, -5]]);
  assert.equal(tx.amountMist, 3_000_000_000n);
  assert.ok(judgeTransaction(tx, ctx).some((f) => f.rule === 'large-amount'));
});

test('mapping: SUI coin type forms', () => {
  assert.ok(isSuiCoinType('0x2::sui::SUI'));
  assert.ok(isSuiCoinType(SUI_LONG));
  assert.ok(!isSuiCoinType(TOKEN));
  assert.ok(!isSuiCoinType('0x12::sui::SUI'));
  assert.ok(!isSuiCoinType('0x2::sui::SUIX'));
});
