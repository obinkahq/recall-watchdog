// The live watch: read new transactions after a cursor through Tatum and
// judge them with the same rules and the same memory recall as the demo.
// The CLI (live.ts) and the web server (server.ts) both use this module.
import { judgeBatch } from './decide.js';
import { formatSui, type RuleContext } from './rules.js';
import { fetchNewTransactions, type ChainReader } from './tatum.js';
import type { MemoryStore } from './memory.js';
import type { Decision, Judgement } from './types.js';

// Functions the owner of a fresh live wallet is assumed to know. Every
// counterparty starts unknown, so the owner teaches the watchdog through
// verdicts (the learning loop), not through a hard-coded list.
export const LIVE_KNOWN_FUNCTIONS: ReadonlySet<string> = new Set(['transfer', 'swap', 'deposit']);

export function liveRuleContext(watchAddress: string): RuleContext {
  return { knownCounterparties: new Set<string>(), knownFunctions: LIVE_KNOWN_FUNCTIONS, watchAddress };
}

export interface LivePage {
  readonly judgement: Judgement;
  readonly afterCursor: string;
  readonly nextCursor: string;
}

// One page of new transactions after the cursor, judged with rules + recall.
export async function judgeNewTransactions(
  reader: ChainReader,
  watchAddress: string,
  afterCursor: string,
  memory: MemoryStore | null,
): Promise<LivePage> {
  const page = await fetchNewTransactions(reader, watchAddress, afterCursor);
  const judgement = await judgeBatch(page.transactions, liveRuleContext(watchAddress), memory);
  return { judgement, afterCursor, nextCursor: page.nextCursor };
}

export interface DecisionView {
  readonly digest: string;
  readonly amountSui: string;
  readonly functionName: string | null;
  readonly state: Decision['state'];
  readonly explanation: string;
  readonly flags: readonly { readonly rule: string; readonly reason: string; readonly pattern: string }[];
  readonly memories: readonly { readonly text: string; readonly blobId: string }[];
}

// The JSON shape of one decision for the web UI (demo and live rows).
export function decisionView(d: Decision): DecisionView {
  return {
    digest: d.tx.digest,
    amountSui: formatSui(d.tx.amountMist),
    functionName: d.tx.functionName,
    state: d.state,
    explanation: d.explanation,
    flags: d.flags.map((f) => ({ rule: f.rule, reason: f.reason, pattern: f.pattern })),
    memories: d.memories.map((m) => ({ text: m.text, blobId: m.blobId })),
  };
}
