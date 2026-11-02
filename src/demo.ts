// Demo mode (J1). No key, no network. The same rules and the same decision
// code as live mode; only the memory build and the data source differ.
import { judgeBatch } from './decide.js';
import { createDemoMemory } from './memory.js';
import { printJudgement } from './report.js';
import { DEMO_OWNER, KNOWN_COUNTERPARTIES, KNOWN_FUNCTIONS, SCRIPTED_VERDICTS, syntheticBatch } from './synthetic.js';

async function main(): Promise<void> {
  const batch = syntheticBatch();
  const ctx = { knownCounterparties: KNOWN_COUNTERPARTIES, knownFunctions: KNOWN_FUNCTIONS, watchAddress: DEMO_OWNER };
  const memory = createDemoMemory('recall-watchdog');
  try {
    process.stdout.write(`Recall Watchdog demo. Batch size: ${batch.length} synthetic transactions.\n`);
    const first = await judgeBatch(batch, ctx, memory);
    printJudgement('Pass 1: rules only (memory is empty)', first);

    process.stdout.write(`\nOwner feedback: ${SCRIPTED_VERDICTS.length} verdicts are stored as memories.\n`);
    for (const verdict of SCRIPTED_VERDICTS) {
      const stored = await memory.rememberVerdict(verdict);
      process.stdout.write(`  stored [${verdict.kind}] ${verdict.pattern} -> blob ${stored.blobId.slice(0, 16)}…\n`);
    }

    const second = await judgeBatch(batch, ctx, memory);
    printJudgement('Pass 2: rules + recalled verdicts', second);

    const count = await memory.count();
    process.stdout.write(`\nMemories stored in namespace "recall-watchdog": ${count}\n`);
    process.stdout.write(`False alarms: pass 1 active=${first.activeFlags}, pass 2 active=${second.activeFlags}\n`);
    if (batch.length < 20) throw new Error('demo batch must hold at least 20 transactions');
    if (first.activeFlags < 10) throw new Error('pass 1 must raise at least 10 active flags');
    if (SCRIPTED_VERDICTS.length < 6) throw new Error('demo needs at least 6 owner verdicts');
    if (!(second.activeFlags < first.activeFlags)) throw new Error('pass 2 must show fewer active flags than pass 1');
    if (second.suppressedFlags < 1) throw new Error('pass 2 must suppress at least one flag');
    if (count < 6) throw new Error('demo must store at least 6 memories');
    process.stdout.write('Demo checks: PASS\n');
  } finally {
    memory.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`demo failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exit(1);
});
