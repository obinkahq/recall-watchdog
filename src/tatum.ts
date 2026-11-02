// Tatum Sui client. Testnet is gRPC only on Tatum, so both networks use the
// Sui TypeScript SDK gRPC client over native gRPC (HTTP/2) to the Tatum
// gateway. The API key is sent as `x-api-key` metadata. This file never
// prints the key. On mainnet Tatum also offers a JSON-RPC gateway; this app
// uses gRPC on both networks so one code path serves both (see README).
import { credentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { NetworkConfig } from './config.js';
import type { WatchTransaction } from './types.js';

export interface ChainSnapshot {
  readonly chainIdentifier: string;
  readonly balanceMist: string;
  readonly transactions: readonly WatchTransaction[];
  readonly hasNextPage: boolean;
  readonly cursor: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry once after a short wait on rate limit or temporary unavailability.
export async function withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = String((error as { code?: unknown }).code ?? '');
    const message = String((error as { message?: unknown }).message ?? '');
    const retryable = code === 'UNAVAILABLE' || code === 'RESOURCE_EXHAUSTED' || message.includes('429');
    if (!retryable) throw new Error(`${label} failed (${code || 'error'}): ${message.slice(0, 200)}`);
    await sleep(5_000);
    try {
      return await run();
    } catch (secondError) {
      const code2 = String((secondError as { code?: unknown }).code ?? 'error');
      throw new Error(`${label} failed after one retry (${code2})`);
    }
  }
}

export interface SuiClients {
  readonly viaTatum: SuiGrpcClient;
  readonly viaPublic: SuiGrpcClient;
  close(): void;
}

export function createSuiClients(network: NetworkConfig, tatumApiKey: string): SuiClients {
  const transport = new GrpcTransport({
    host: network.tatumGrpcHost,
    channelCredentials: credentials.createSsl(),
    meta: { 'x-api-key': tatumApiKey },
  });
  const viaTatum = new SuiGrpcClient({ network: network.name, transport });
  const viaPublic = new SuiGrpcClient({ network: network.name, baseUrl: network.publicGrpcUrl });
  return {
    viaTatum,
    viaPublic,
    close() {
      transport.close();
    },
  };
}

interface SdkBalanceChange {
  readonly coinType: string;
  readonly address: string;
  readonly amount: string;
}

interface SdkCommand {
  readonly $kind?: string;
  readonly MoveCall?: { readonly package: string; readonly module: string; readonly function: string };
}

interface SdkTxResult {
  readonly $kind: string;
  readonly Transaction?: SdkTx;
  readonly FailedTransaction?: SdkTx;
}

interface SdkTx {
  readonly digest: string;
  readonly timestampMs: number | null;
  readonly balanceChanges?: readonly SdkBalanceChange[];
  readonly transaction?: { readonly sender: string | null; readonly commands: readonly SdkCommand[] };
}

export const SUI_COIN_TYPE = '0x2::sui::SUI';
const SUI_COIN_TYPE_PATTERN = /^0x0*2::sui::SUI$/;

// True for the SUI coin type in short (0x2) or long (0x00..02) form.
export function isSuiCoinType(coinType: string): boolean {
  return SUI_COIN_TYPE_PATTERN.test(coinType);
}

// Map one SDK transaction to the shape the rules judge. The amount is the
// largest absolute SUI balance change: other coin types have their own
// decimals and value, so they never count as MIST. The counterparty is the
// first balance change address (any coin type) that is not the watched address.
export function toWatchTransaction(result: SdkTxResult, watchAddress: string): WatchTransaction | null {
  const tx = result.Transaction ?? result.FailedTransaction;
  if (tx === undefined) return null;
  const changes = tx.balanceChanges ?? [];
  let amount = 0n;
  let counterparty: string | null = null;
  for (const change of changes) {
    if (isSuiCoinType(change.coinType)) {
      const value = BigInt(change.amount);
      const abs = value < 0n ? -value : value;
      if (abs > amount) amount = abs;
    }
    if (counterparty === null && change.address.toLowerCase() !== watchAddress.toLowerCase()) {
      counterparty = change.address.toLowerCase();
    }
  }
  const firstCall = (tx.transaction?.commands ?? []).find((c) => c.MoveCall !== undefined)?.MoveCall;
  return {
    digest: tx.digest,
    sender: tx.transaction?.sender ?? watchAddress,
    counterparty,
    amountMist: amount,
    coinType: SUI_COIN_TYPE,
    packageId: firstCall?.package ?? null,
    moduleName: firstCall?.module ?? null,
    functionName: firstCall?.function ?? null,
    timestampMs: tx.timestampMs,
    status: result.$kind === 'Transaction' ? 'success' : 'failure',
  };
}

// Poll model for chain reads. Sui full nodes prune old checkpoints, and an
// unanchored sender query scans from genesis, which a pruned node refuses
// (OUT_OF_RANGE). So the watchdog takes a cursor at the chain head first
// (takeCursor), then asks only for matching transactions after that cursor
// (fetchNewTransactions). This is the supported way to watch an address.
export async function takeCursor(client: SuiGrpcClient): Promise<string> {
  const head = await withRetry('takeCursor', () => client.listTransactions({ limit: 1, order: 'descending' }));
  if (head.startCursor === null) throw new Error('takeCursor failed: the chain head returned no cursor');
  return head.startCursor;
}

export async function fetchChainState(client: SuiGrpcClient, watchAddress: string): Promise<ChainSnapshot> {
  const { chainIdentifier } = await withRetry('getChainIdentifier', () => client.core.getChainIdentifier());
  const { balance } = await withRetry('getBalance', () => client.core.getBalance({ owner: watchAddress, coinType: '0x2::sui::SUI' }));
  const cursor = await takeCursor(client);
  return { chainIdentifier, balanceMist: balance.balance, transactions: [], hasNextPage: false, cursor };
}

export async function fetchNewTransactions(client: SuiGrpcClient, watchAddress: string, afterCursor: string, limit = 25): Promise<readonly WatchTransaction[]> {
  const page = await withRetry('listTransactions', () =>
    client.listTransactions({
      filter: { sender: watchAddress },
      limit,
      after: afterCursor,
      include: { transaction: true, balanceChanges: true, effects: true },
    }),
  );
  return page.transactions.flatMap((r) => {
    const mapped = toWatchTransaction(r as unknown as SdkTxResult, watchAddress);
    return mapped === null ? [] : [mapped];
  });
}

export async function fetchTransactionsByDigest(client: SuiGrpcClient, watchAddress: string, digests: readonly string[]): Promise<readonly WatchTransaction[]> {
  const out: WatchTransaction[] = [];
  for (const digest of digests) {
    const result = await withRetry('getTransaction', () => client.getTransaction({ digest, include: { transaction: true, balanceChanges: true, effects: true } }));
    const mapped = toWatchTransaction(result as unknown as SdkTxResult, watchAddress);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}
