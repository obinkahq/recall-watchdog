// Shared types. WatchTransaction is the one shape the rules judge, whatever
// the source (synthetic batch, Tatum read, or a live chain read).

export interface WatchTransaction {
  readonly digest: string;
  readonly sender: string;
  readonly counterparty: string | null;
  readonly amountMist: bigint;
  readonly coinType: string;
  readonly packageId: string | null;
  readonly moduleName: string | null;
  readonly functionName: string | null;
  readonly timestampMs: number | null;
  readonly status: 'success' | 'failure' | 'unknown';
}

export type RuleId = 'new-counterparty' | 'large-amount' | 'unfamiliar-function' | 'burst-activity';

export interface Flag {
  readonly digest: string;
  readonly rule: RuleId;
  readonly reason: string;
  readonly pattern: string;
}

export type VerdictKind = 'expected' | 'important';

export interface Verdict {
  readonly pattern: string;
  readonly kind: VerdictKind;
  readonly note: string;
}

export interface RecalledVerdict {
  readonly text: string;
  readonly blobId: string;
  readonly distance: number;
}

export type DecisionState = 'flag' | 'suppressed' | 'escalated' | 'clear';

export interface Decision {
  readonly tx: WatchTransaction;
  readonly flags: readonly Flag[];
  readonly state: DecisionState;
  readonly explanation: string;
  readonly memories: readonly RecalledVerdict[];
}

export interface Judgement {
  readonly decisions: readonly Decision[];
  readonly activeFlags: number;
  readonly suppressedFlags: number;
  readonly escalatedFlags: number;
}
