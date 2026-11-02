// Anomaly rules. Pure functions, no shared object changes. Each flag carries
// a stable pattern key. Owner verdict memories use the same pattern key, so
// a recalled verdict can be matched to a flag by exact pattern first and by
// token overlap as a fallback.
import type { Flag, WatchTransaction } from './types.js';

export const LARGE_AMOUNT_MIST = 1_000_000_000n;
export const BURST_WINDOW_MS = 10 * 60_000;
export const BURST_MIN_COUNT = 3;

export function shortAddress(address: string | null): string {
  if (address === null) return 'none';
  const body = address.startsWith('0x') ? address.slice(2) : address;
  return body.slice(0, 8).toLowerCase();
}

export function flagPattern(tx: WatchTransaction, rule: Flag['rule']): string {
  if (rule === 'new-counterparty') return `new-counterparty ${shortAddress(tx.counterparty)}`;
  if (rule === 'large-amount') return `large-amount ${tx.functionName ?? 'transfer'} ${shortAddress(tx.counterparty)}`;
  if (rule === 'burst-activity') return `burst-activity ${shortAddress(tx.counterparty)}`;
  return `unfamiliar-function ${tx.functionName ?? 'unknown'}`;
}

export interface RuleContext {
  readonly knownCounterparties: ReadonlySet<string>;
  readonly knownFunctions: ReadonlySet<string>;
  readonly watchAddress: string;
  readonly batch?: readonly WatchTransaction[];
}

export function judgeTransaction(tx: WatchTransaction, ctx: RuleContext): readonly Flag[] {
  const flags: Flag[] = [];
  const cp = tx.counterparty;
  if (cp !== null && cp.toLowerCase() !== ctx.watchAddress.toLowerCase() && !ctx.knownCounterparties.has(cp)) {
    flags.push({
      digest: tx.digest,
      rule: 'new-counterparty',
      reason: `counterparty ${shortAddress(cp)} has not been seen before`,
      pattern: flagPattern(tx, 'new-counterparty'),
    });
  }
  if (tx.amountMist > LARGE_AMOUNT_MIST) {
    flags.push({
      digest: tx.digest,
      rule: 'large-amount',
      reason: `amount ${formatSui(tx.amountMist)} SUI is far above the usual amount`,
      pattern: flagPattern(tx, 'large-amount'),
    });
  }
  if (tx.functionName !== null && !ctx.knownFunctions.has(tx.functionName)) {
    flags.push({
      digest: tx.digest,
      rule: 'unfamiliar-function',
      reason: `function ${tx.moduleName ?? '?'}::${tx.functionName} has not been used before`,
      pattern: flagPattern(tx, 'unfamiliar-function'),
    });
  }
  if (ctx.batch !== undefined && cp !== null && tx.timestampMs !== null) {
    const near = ctx.batch.filter(
      (other) => other.counterparty === cp && other.timestampMs !== null && Math.abs(other.timestampMs - (tx.timestampMs as number)) <= BURST_WINDOW_MS,
    );
    if (near.length >= BURST_MIN_COUNT) {
      flags.push({
        digest: tx.digest,
        rule: 'burst-activity',
        reason: `${near.length} transactions to the same counterparty within 10 minutes`,
        pattern: flagPattern(tx, 'burst-activity'),
      });
    }
  }
  return flags;
}

export function formatSui(mist: bigint): string {
  const whole = mist / 1_000_000_000n;
  const frac = mist % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  const fracText = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracText}`;
}
