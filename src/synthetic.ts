// Synthetic batch for demo mode. All data is invented. Addresses and digests
// are built from short seeds so no long key-like string sits in the source.
import type { Verdict, WatchTransaction } from './types.js';

function addr(seed: string): string {
  const clean = seed.toLowerCase().padEnd(64, '0').slice(0, 64);
  return `0x${clean}`;
}

function digest(seed: string): string {
  return `demo-${seed}`;
}

export const DEMO_OWNER = addr('a11ce00000000000000000000000000000000000000000000000000000d00d');

const PAYROLL = addr('payr0110000000000000000000000000000000000000000000000000000a01');
const SAVINGS = addr('5av1ng5000000000000000000000000000000000000000000000000000b02');
const DEX = addr('dex00000000000000000000000000000000000000000000000000000000c03');
const LENDING = addr('1end1ng000000000000000000000000000000000000000000000000000d04');
const FRIEND = addr('fr1end0000000000000000000000000000000000000000000000000000e05');
const STRANGER_A = addr('57rangea00000000000000000000000000000000000000000000000000f06');
const STRANGER_B = addr('57rangeb0000000000000000000000000000000000000000000000000007a7');
const NFT_MARKET = addr('nf7marke700000000000000000000000000000000000000000000000000808');

const SUI = '0x2::sui::SUI';

interface Row {
  readonly id: string;
  readonly counterparty: string | null;
  readonly amountMist: bigint;
  readonly pkg: string | null;
  readonly mod: string | null;
  readonly fn: string | null;
  readonly minute: number;
}

const ROWS: readonly Row[] = [
  { id: 't01', counterparty: PAYROLL, amountMist: 400_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 1 },
  { id: 't02', counterparty: SAVINGS, amountMist: 250_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 2 },
  { id: 't03', counterparty: DEX, amountMist: 120_000_000n, pkg: '0xdex', mod: 'pool', fn: 'swap', minute: 3 },
  { id: 't04', counterparty: DEX, amountMist: 90_000_000n, pkg: '0xdex', mod: 'pool', fn: 'swap', minute: 4 },
  { id: 't05', counterparty: LENDING, amountMist: 300_000_000n, pkg: '0x1end', mod: 'vault', fn: 'deposit', minute: 5 },
  { id: 't06', counterparty: FRIEND, amountMist: 15_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 6 },
  { id: 't07', counterparty: PAYROLL, amountMist: 400_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 7 },
  { id: 't08', counterparty: SAVINGS, amountMist: 250_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 8 },
  { id: 't09', counterparty: DEX, amountMist: 110_000_000n, pkg: '0xdex', mod: 'pool', fn: 'swap', minute: 9 },
  { id: 't10', counterparty: LENDING, amountMist: 280_000_000n, pkg: '0x1end', mod: 'vault', fn: 'deposit', minute: 10 },
  // Unusual rows: new counterparties, large amounts, unfamiliar functions.
  { id: 't11', counterparty: STRANGER_A, amountMist: 60_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 11 },
  { id: 't12', counterparty: STRANGER_B, amountMist: 55_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 12 },
  { id: 't13', counterparty: DEX, amountMist: 4_500_000_000n, pkg: '0xdex', mod: 'pool', fn: 'swap', minute: 13 },
  { id: 't14', counterparty: SAVINGS, amountMist: 5_000_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 14 },
  { id: 't15', counterparty: NFT_MARKET, amountMist: 200_000_000n, pkg: '0xnf7', mod: 'market', fn: 'buy_listing', minute: 15 },
  { id: 't16', counterparty: LENDING, amountMist: 310_000_000n, pkg: '0x1end', mod: 'vault', fn: 'flash_borrow', minute: 16 },
  { id: 't17', counterparty: STRANGER_A, amountMist: 65_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 17 },
  { id: 't18', counterparty: DEX, amountMist: 95_000_000n, pkg: '0xdex', mod: 'pool', fn: 'swap', minute: 18 },
  { id: 't19', counterparty: PAYROLL, amountMist: 400_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 19 },
  { id: 't20', counterparty: FRIEND, amountMist: 12_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 20 },
  { id: 't21', counterparty: NFT_MARKET, amountMist: 180_000_000n, pkg: '0xnf7', mod: 'market', fn: 'buy_listing', minute: 21 },
  { id: 't22', counterparty: LENDING, amountMist: 290_000_000n, pkg: '0x1end', mod: 'vault', fn: 'deposit', minute: 22 },
  { id: 't23', counterparty: SAVINGS, amountMist: 260_000_000n, pkg: '0x2', mod: 'pay', fn: 'transfer', minute: 23 },
  { id: 't24', counterparty: DEX, amountMist: 105_000_000n, pkg: '0xdex', mod: 'pool', fn: 'swap', minute: 24 },
];

export function syntheticBatch(): readonly WatchTransaction[] {
  const baseMs = Date.UTC(2026, 10, 1, 9, 0, 0);
  return ROWS.map((row) => ({
    digest: digest(row.id),
    sender: DEMO_OWNER,
    counterparty: row.counterparty,
    amountMist: row.amountMist,
    coinType: SUI,
    packageId: row.pkg,
    moduleName: row.mod,
    functionName: row.fn,
    timestampMs: baseMs + row.minute * 60_000,
    status: 'success' as const,
  }));
}

// Addresses and functions the owner already knows before the demo starts.
// STRANGER_A, STRANGER_B and NFT_MARKET are new. buy_listing and
// flash_borrow are new functions.
export const KNOWN_COUNTERPARTIES: ReadonlySet<string> = new Set([PAYROLL, SAVINGS, DEX, LENDING, FRIEND]);
export const KNOWN_FUNCTIONS: ReadonlySet<string> = new Set(['transfer', 'swap', 'deposit']);

// Scripted owner feedback for the demo. Each verdict names the pattern it
// covers, so the second judgement can match by pattern through recall.
export const SCRIPTED_VERDICTS: readonly Verdict[] = [
  { pattern: 'new-counterparty 57rangea', kind: 'expected', note: 'rent share to a new flatmate, this payment is fine' },
  { pattern: 'large-amount transfer 5av1ng50', kind: 'expected', note: 'yearly move to savings, large transfers to savings are fine' },
  { pattern: 'unfamiliar-function buy_listing', kind: 'expected', note: 'collecting art, market buys are fine' },
  { pattern: 'new-counterparty nf7marke', kind: 'expected', note: 'the art market is a known place now' },
  { pattern: 'large-amount swap', kind: 'expected', note: 'one planned large swap this month is fine' },
  { pattern: 'new-counterparty 57rangeb', kind: 'important', note: 'unknown payee, always show me this one' },
  { pattern: 'unfamiliar-function flash_borrow', kind: 'important', note: 'never borrow without a look, always show me' },
  { pattern: 'unfamiliar-function deposit', kind: 'important', note: 'watch lending deposits this month' },
];
