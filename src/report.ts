// Plain text report for the CLI. Suppressed flags are printed with their
// memories, so the report is an audit trail, not only an alarm list.
import { formatSui } from './rules.js';
import type { Judgement } from './types.js';

export function printJudgement(title: string, judgement: Judgement): void {
  process.stdout.write(`\n--- ${title} ---\n`);
  for (const decision of judgement.decisions) {
    const tx = decision.tx;
    const head = `${tx.digest} amount=${formatSui(tx.amountMist)} SUI fn=${tx.functionName ?? '-'} state=${decision.state}`;
    process.stdout.write(`${head}\n`);
    for (const flag of decision.flags) {
      process.stdout.write(`  flag [${flag.rule}] ${flag.reason}\n`);
    }
    if (decision.flags.length > 0) {
      process.stdout.write(`  decision: ${decision.explanation}\n`);
    }
    for (const memory of decision.memories) {
      process.stdout.write(`  memory (${memory.blobId.slice(0, 16)}…, distance ${memory.distance.toFixed(3)}): ${memory.text}\n`);
    }
  }
  process.stdout.write(
    `summary: active=${judgement.activeFlags} suppressed=${judgement.suppressedFlags} escalated=${judgement.escalatedFlags}\n`,
  );
}
