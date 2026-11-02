// Decide: rules first, then memory. For each flagged transaction the app
// recalls similar past verdicts. A recalled "expected" verdict suppresses
// the flag; a recalled "important" verdict escalates it. Suppressed flags
// stay in the output with their memories (audit trail, no silent drop).
import { judgeTransaction, type RuleContext } from './rules.js';
import { parseVerdictText, type MemoryStore } from './memory.js';
import type { Decision, Flag, Judgement, RecalledVerdict, WatchTransaction } from './types.js';

function tokens(text: string): ReadonlySet<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

function tokenOverlap(a: string, b: string): number {
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0) return 0;
  let hit = 0;
  for (const token of setA) {
    if (setB.has(token)) hit += 1;
  }
  return hit / setA.size;
}

// A recalled verdict matches a flag when the pattern is equal, the verdict
// pattern is contained in the flag pattern (covers "large-amount swap"),
// or the token overlap is high. Exact match wins over fuzzy match.
function verdictForFlag(flag: Flag, recalled: readonly RecalledVerdict[]): { kind: 'expected' | 'important'; hit: RecalledVerdict } | null {
  let fuzzy: { kind: 'expected' | 'important'; hit: RecalledVerdict; score: number } | null = null;
  for (const hit of recalled) {
    const verdict = parseVerdictText(hit.text);
    if (verdict === null) continue;
    const vp = verdict.pattern.toLowerCase();
    const fp = flag.pattern.toLowerCase();
    if (vp === fp || fp.startsWith(vp)) return { kind: verdict.kind, hit };
    const score = tokenOverlap(vp, fp);
    if (score >= 0.99 && (fuzzy === null || score > fuzzy.score)) {
      fuzzy = { kind: verdict.kind, hit, score };
    }
  }
  return fuzzy === null ? null : { kind: fuzzy.kind, hit: fuzzy.hit };
}

async function decideOne(tx: WatchTransaction, ctx: RuleContext, memory: MemoryStore | null): Promise<Decision> {
  const flags = judgeTransaction(tx, ctx);
  if (flags.length === 0) {
    return { tx, flags, state: 'clear', explanation: 'no rule matched', memories: [] };
  }
  if (memory === null) {
    return { tx, flags, state: 'flag', explanation: 'flagged by rule, no memory check', memories: [] };
  }
  const query = `watchdog verdict pattern ${flags.map((f) => f.pattern).join(' ')}`;
  const recalled = await memory.recallVerdicts(query, 8);
  const matched = flags.map((flag) => ({ flag, verdict: verdictForFlag(flag, recalled) }));
  const important = matched.find((m) => m.verdict?.kind === 'important');
  const allExpected = matched.every((m) => m.verdict?.kind === 'expected');
  const used = matched.flatMap((m) => (m.verdict === null ? [] : [m.verdict.hit]));
  const shown = used.length > 0 ? used : recalled.slice(0, 2);
  if (important !== undefined) {
    return { tx, flags, state: 'escalated', explanation: `owner marked "${important.flag.pattern}" as important`, memories: shown };
  }
  if (allExpected) {
    return { tx, flags, state: 'suppressed', explanation: 'owner marked this pattern as expected', memories: shown };
  }
  return { tx, flags, state: 'flag', explanation: 'flagged by rule, no matching owner verdict', memories: shown };
}

export async function judgeBatch(
  batch: readonly WatchTransaction[],
  ctx: RuleContext,
  memory: MemoryStore | null,
): Promise<Judgement> {
  const decisions: Decision[] = [];
  const fullCtx: RuleContext = { ...ctx, batch };
  for (const tx of batch) {
    decisions.push(await decideOne(tx, fullCtx, memory));
  }
  const count = (state: Decision['state']) => decisions.filter((d) => d.state === state).length;
  return {
    decisions,
    activeFlags: count('flag') + count('escalated'),
    suppressedFlags: count('suppressed'),
    escalatedFlags: count('escalated'),
  };
}
