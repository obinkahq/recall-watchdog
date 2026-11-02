// Live round trip (J2) on the selected network (testnet by default).
// 1. Check every setting and key (no network). 2. Relayer health. 3. Tatum
// chain snapshot and head cursor. 4. Two small self-transfers (public submit
// path) so the Tatum read path sees real transactions. 5. Store 12 verdict
// memories. 6. Recall related verdicts. 7. Count. 8. Read the new
// transactions after the cursor through Tatum and judge each one with the
// rules and the recalled verdicts, then print each decision and its memories.
// No secret value is printed, and no dependency error message is printed.
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { createSuiClients, fetchChainState, withRetry } from './tatum.js';
import { createLiveMemory } from './memory.js';
import { readLiveSettings } from './live-settings.js';
import { FixedError, failureText, installFixedCrashHandlers } from './errors.js';
import { printJudgement } from './report.js';
import { judgeNewTransactions } from './watch.js';
import { SCRIPTED_VERDICTS } from './synthetic.js';
import type { Verdict } from './types.js';

// 12 verdicts for the live run: the 8 scripted ones plus 4 more patterns.
const LIVE_VERDICTS: readonly Verdict[] = [
  ...SCRIPTED_VERDICTS,
  { pattern: 'new-counterparty a11ce000', kind: 'expected', note: 'self transfer for the demo, this is fine' },
  { pattern: 'large-amount deposit', kind: 'important', note: 'large lending deposits need a look this month' },
  { pattern: 'unfamiliar-function swap', kind: 'expected', note: 'swaps on the usual pool are fine' },
  { pattern: 'new-counterparty 5av1ng50', kind: 'expected', note: 'savings wallet, known and fine' },
];

const RECALL_QUERIES: readonly string[] = [
  'watchdog verdict pattern new-counterparty rent share flatmate',
  'watchdog verdict pattern large-amount savings transfer',
  'watchdog verdict pattern unfamiliar-function flash borrow important',
];

// The step that runs now. The error boundary names it instead of printing
// a dependency message.
let stage = 'check settings and keys';

function log(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

async function selfTransfer(publicClient: import('@mysten/sui/grpc').SuiGrpcClient, keypair: Ed25519Keypair, watchAddress: string): Promise<readonly string[]> {
  const coins = await withRetry('listCoins (public)', () => publicClient.listCoins({ owner: watchAddress }));
  if (coins.objects.length === 0) {
    log('no Coin<SUI> yet: gas is paid from the address balance (gasPayment empty)');
  }
  const digestList: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const tx = new Transaction();
    tx.setSender(watchAddress);
    tx.setGasPayment([]);
    const coin = tx.coin({ type: '0x2::sui::SUI', balance: 1_000n, useGasCoin: false });
    tx.transferObjects([coin], watchAddress);
    const result = await publicClient.signAndExecuteTransaction({ signer: keypair, transaction: tx, include: { effects: true } });
    const executed = result.Transaction ?? result.FailedTransaction;
    if (executed === undefined) throw new FixedError('self-transfer returned no result');
    digestList.push(executed.digest);
    log(`self-transfer ${i + 1} digest=${executed.digest}`);
  }
  return digestList;
}

async function main(): Promise<void> {
  const settings = readLiveSettings();
  const { network, watchAddress, namespace, serverUrl } = settings;
  stage = 'create the Tatum client';
  const clients = createSuiClients(network, settings.tatumKey);
  stage = 'load the Walrus Memory delegate key';
  const memory = createLiveMemory({ key: settings.memwalKey, accountId: settings.accountId, serverUrl, namespace });
  try {
    log(`start network=${network.name} relayer=${serverUrl} tatumHost=${network.tatumGrpcHost} namespace=${namespace}`);
    stage = 'relayer health';
    const health = await memory.healthStatus();
    if (health !== 'ok') throw new FixedError('relayer health is not "ok"');
    log('health=ok');

    stage = 'Tatum chain read';
    const before = await fetchChainState(clients.viaTatum, watchAddress);
    log(`tatum chain=${before.chainIdentifier} balanceMist=${before.balanceMist} cursorTaken=yes`);

    let transferDigests: readonly string[] = [];
    if (settings.suiKeypair === null) {
      log('self-transfer skipped: SUI_PRIVATE_KEY is not set (read-only live run)');
    } else {
      stage = 'self-transfer';
      transferDigests = await selfTransfer(clients.viaPublic, settings.suiKeypair, watchAddress);
    }

    stage = 'remember verdicts';
    log(`storing ${LIVE_VERDICTS.length} verdict memories`);
    let finished = 0;
    for (const verdict of LIVE_VERDICTS) {
      const stored = await memory.rememberVerdict(verdict);
      finished += 1;
      log(`  remember ${finished}/${LIVE_VERDICTS.length} [${verdict.kind}] ${verdict.pattern} -> blob ${stored.blobId}`);
    }

    stage = 'recall';
    let recallHits = 0;
    for (const query of RECALL_QUERIES) {
      const hits = await memory.recallVerdicts(query, 5);
      recallHits += hits.length;
      log(`recall "${query}" -> ${hits.length} hits`);
      for (const hit of hits) {
        log(`  hit distance=${hit.distance.toFixed(3)} blob=${hit.blobId} text=${hit.text}`);
      }
    }

    stage = 'memory count';
    const count = await memory.count();
    log(`memory count in namespace=${count}`);

    stage = 'Tatum poll and judge';
    const page = await judgeNewTransactions(clients.viaTatum, watchAddress, before.cursor, memory);
    const judged = page.judgement.decisions;
    log(`tatum poll after the cursor: newTx=${judged.length} cursorAdvanced=${page.nextCursor !== before.cursor ? 'yes' : 'no'}`);
    printJudgement('Live transactions after the cursor (Tatum read, rules + recalled verdicts)', page.judgement);

    if (transferDigests.length > 0) {
      const digests = new Set(judged.map((d) => d.tx.digest));
      const found = transferDigests.filter((d) => digests.has(d));
      log(`tatum poll after transfer: foundNew=${found.length}/${transferDigests.length}`);
      if (found.length === 0) throw new FixedError('Tatum poll did not return the new self-transfer transactions yet (indexing lag). Re-run npm run live.');
    }

    if (finished < 10) throw new FixedError(`only ${finished} memories finished, need at least 10`);
    if (count < 10) throw new FixedError(`memory count is ${count}, need at least 10`);
    if (recallHits === 0) throw new FixedError('recall returned no hits');
    stage = 'final checks';
    log('Live checks: PASS');
  } finally {
    memory.close();
    clients.close();
  }
}

installFixedCrashHandlers('live failed');
main().catch((error: unknown) => {
  process.stderr.write(`live failed: ${failureText(error, stage)}\n`);
  process.exit(1);
});
