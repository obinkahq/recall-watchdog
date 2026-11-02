// Fixed chain data for the stub Tatum client, in the SDK result shape, and
// fake keys. All values are invented. Long hex values are built at run time.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export const addr = (seed) => `0x${seed.padEnd(64, '0')}`;
export const WATCH_DEMO = addr('a11ce0');
export const CANARY = 'canaryk3y';
export const TOKEN = '0xabc::token::TOK';
export const SUI_LONG = `0x${'2'.padStart(64, '0')}::sui::SUI`;

export function freshKeypair() {
  const keypair = Ed25519Keypair.generate();
  return { keypair, secret: keypair.getSecretKey(), address: keypair.toSuiAddress() };
}

export const fakeTatumKey = () => `t-fake-${CANARY}-tatum-0001`;
export const fakeMemwalKey = () => 'c0ffee15'.repeat(8);
export const fakeAccountId = () => addr('acc0');

function tx(digest, watch, { changes, call = null, ts = 1_700_000_000_000 }) {
  const commands = call === null ? [{ $kind: 'TransferObjects' }] : [{ $kind: 'MoveCall', MoveCall: call }];
  return {
    $kind: 'Transaction',
    Transaction: {
      digest,
      timestampMs: ts,
      balanceChanges: changes.map(([coinType, address, amount]) => ({ coinType, address, amount: String(amount) })),
      transaction: { sender: watch, commands },
    },
  };
}

// Page 1 (after the head cursor AAAA) and page 2 (after AAAB).
export function liveFixture(watch, transferDigests = ['LiveTransferX1', 'LiveTransferX2']) {
  const sui = '0x2::sui::SUI';
  const page1 = [
    tx('LiveT1stranger', watch, { changes: [[sui, watch, -60_000_000], [sui, addr('57rangea'), 60_000_000]] }),
    tx('LiveT2unknown', watch, { changes: [[sui, watch, -55_000_000], [sui, addr('57rangeb'), 55_000_000]] }),
    ...transferDigests.map((d) => tx(d, watch, { changes: [[SUI_LONG, watch, -1_000_000]] })),
    tx('LiveT4borrow', watch, {
      changes: [[sui, watch, -310_000_000], [sui, addr('1end1ng0'), 310_000_000]],
      call: { package: '0x1end', module: 'vault', function: 'flash_borrow' },
    }),
    tx('LiveT5token', watch, {
      changes: [[sui, watch, -2_000_000], [TOKEN, watch, -5_000_000_000], [TOKEN, addr('nf7marke'), 5_000_000_000]],
      call: { package: '0x2', module: 'pay', function: 'transfer' },
    }),
    tx('LiveT6swap', watch, {
      changes: [[SUI_LONG, watch, -4_500_000_000], [SUI_LONG, addr('dex00000'), 4_500_000_000]],
      call: { package: '0xdex', module: 'pool', function: 'swap' },
    }),
  ];
  const page2 = [
    tx('LiveT7savings', watch, { changes: [[sui, watch, -250_000_000], [sui, addr('5av1ng50'), 250_000_000]] }),
  ];
  return {
    chainIdentifier: 'stub-chain-id',
    balanceMist: '7000000000',
    headCursor: 'AAAA',
    transferDigests,
    pages: { AAAA: { endCursor: 'AAAB', transactions: page1 }, AAAB: { endCursor: 'AAAC', transactions: page2 } },
  };
}
