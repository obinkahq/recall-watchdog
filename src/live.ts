// Live round trip (J2) on the selected network (testnet by default).
// 1. Relayer health. 2. Tatum chain snapshot. 3. Two small self-transfers
// (public submit path) so the Tatum read path sees real transactions.
// 4. Store 12 verdict memories. 5. Recall related verdicts. 6. Count.
// No secret value is printed.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { createSuiClients, fetchChainState, fetchNewTransactions, withRetry } from './tatum.js';
import { createLiveMemory } from './memory.js';
import { readSecret, requireSecret, resolveMemwalServerUrl, resolveNamespace, resolveNetwork, resolveWatchAddress } from './config.js';
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

function log(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

async function selfTransfer(publicClient: import('@mysten/sui/grpc').SuiGrpcClient, keypair: Ed25519Keypair, watchAddress: string): Promise<string | null> {
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
    if (executed === undefined) throw new Error('self-transfer returned no result');
    digestList.push(executed.digest);
    log(`self-transfer ${i + 1} digest=${executed.digest}`);
  }
  return digestList.join(',');
}

async function main(): Promise<void> {
  const network = resolveNetwork();
  const watchAddress = resolveWatchAddress();
  const namespace = resolveNamespace();
  const tatumKey = requireSecret('TATUM_API_KEY', 'Set TATUM_API_KEY or TATUM_API_KEY_FILE.');
  const memwalKey = requireSecret('MEMWAL_KEY', 'Set MEMWAL_KEY or MEMWAL_KEY_FILE (see npm run setup-account).');
  const accountId = requireSecret('MEMWAL_ACCOUNT_ID', 'Set MEMWAL_ACCOUNT_ID or MEMWAL_ACCOUNT_ID_FILE (see npm run setup-account).');
  const serverUrl = resolveMemwalServerUrl(network);

  const clients = createSuiClients(network, tatumKey);
  const memory = createLiveMemory({ key: memwalKey, accountId, serverUrl, namespace });
  try {
    log(`start network=${network.name} relayer=${serverUrl} tatumHost=${network.tatumGrpcHost} namespace=${namespace}`);
    const health = await memory.healthStatus();
    log(`health=${health}`);
    if (health !== 'ok') throw new Error(`relayer health is "${health}", expected "ok"`);

    const before = await fetchChainState(clients.viaTatum, watchAddress);
    log(`tatum chain=${before.chainIdentifier} balanceMist=${before.balanceMist} cursorTaken=yes`);

    const suiKeyText = readSecret('SUI_PRIVATE_KEY');
    let transferDigests: string | null = null;
    if (suiKeyText === undefined) {
      log('self-transfer skipped: SUI_PRIVATE_KEY is not set (read-only live run)');
    } else {
      const keypair = Ed25519Keypair.fromSecretKey(suiKeyText);
      if (keypair.toSuiAddress().toLowerCase() !== watchAddress) throw new Error('SUI_PRIVATE_KEY does not match WATCH_ADDRESS');
      transferDigests = await selfTransfer(clients.viaPublic, keypair, watchAddress);
    }

    log(`storing ${LIVE_VERDICTS.length} verdict memories`);
    let finished = 0;
    for (const verdict of LIVE_VERDICTS) {
      const stored = await memory.rememberVerdict(verdict);
      finished += 1;
      log(`  remember ${finished}/${LIVE_VERDICTS.length} [${verdict.kind}] ${verdict.pattern} -> blob ${stored.blobId}`);
    }

    let recallHits = 0;
    for (const query of RECALL_QUERIES) {
      const hits = await memory.recallVerdicts(query, 5);
      recallHits += hits.length;
      log(`recall "${query}" -> ${hits.length} hits`);
      for (const hit of hits) {
        log(`  hit distance=${hit.distance.toFixed(3)} blob=${hit.blobId} text=${hit.text}`);
      }
    }

    const count = await memory.count();
    log(`memory count in namespace=${count}`);

    if (transferDigests !== null) {
      const fresh = await fetchNewTransactions(clients.viaTatum, watchAddress, before.cursor);
      const digests = new Set(fresh.map((t) => t.digest));
      const found = transferDigests.split(',').filter((d) => digests.has(d));
      log(`tatum poll after transfer: newTx=${fresh.length} foundNew=${found.length}/2`);
      for (const tx of fresh) {
        log(`  new tx ${tx.digest} fn=${tx.functionName ?? '-'} amountMist=${tx.amountMist.toString()}`);
      }
      if (found.length === 0) throw new Error('Tatum poll did not return the new self-transfer transactions yet (indexing lag). Re-run npm run live.');
    }

    if (finished < 10) throw new Error(`only ${finished} memories finished, need at least 10`);
    if (count < 10) throw new Error(`memory count is ${count}, need at least 10`);
    if (recallHits === 0) throw new Error('recall returned no hits');
    log('Live checks: PASS');
  } finally {
    memory.close();
    clients.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`live failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exit(1);
});
