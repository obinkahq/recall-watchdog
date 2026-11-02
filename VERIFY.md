# Verification contract (frozen before the code)

## Consumer

A hackathon judge who clones this repository, reads the README, and runs the
demo. A second consumer is a Sui wallet owner who runs the same code against
Sui testnet with their own keys.

Supported interfaces:

- CLI demo: `npm run demo` (no key, no network call).
- CLI live round trip: `npm run live` (needs the keys in `.env.example`).
- Web UI: `npm run build && npm start`, then open `http://127.0.0.1:4173/`.
- Account setup CLI: `npm run setup-account` (creates a Walrus Memory account
  and a delegate key on the selected network; testnet by default).

## Journey J1: demo mode without any key

Steps: fresh clone, `npm ci`, `npm run demo`.

Expected results (each is checked by `node --test` and by reading the demo log):

1. The demo prints a batch of 24 synthetic transactions.
2. The first judgement prints flags with a rule name and a reason for each flag.
   At least 10 flags are raised on the first pass.
3. The scripted owner then marks 8 flags: 5 as `expected` and 3 as `important`.
   Each mark is stored as a memory ("verdict" memory).
4. The same batch is judged again. The second pass prints fewer active flags
   than the first pass (fewer false alarms), and every suppressed flag is still
   listed with the memories behind the decision (audit trail, no silent drop).
5. A summary line prints the memory count in the namespace: 8 or more.
6. The demo process exits with code 0.

## Journey J2: live testnet round trip

Preconditions: `NETWORK=testnet` (default), a funded testnet demo wallet,
a Tatum API key, a Walrus Memory testnet account id, and a delegate key for
that account. No mainnet call is made.

Steps: `npm run live`.

Expected results:

1. `health()` against the testnet relayer (`https://relayer.dev.memwal.ai`)
   returns status `ok`.
2. The app reads chain state for the watch address through the Tatum Sui
   testnet gRPC gateway (`sui-testnet-grpc.gateway.tatum.io:443`, key sent as
   `x-api-key` metadata): chain identifier, balance, and owned transactions
   (`listTransactions` with a sender filter). The log prints the chain
   identifier and the counts. A 429 or unavailable error is retried with a
   short backoff and then reported as a clear failure (not a silent pass).
3. The app stores 12 verdict memories through the relayer
   (`remember` + `waitForRememberJob`) in namespace `recall-watchdog`.
   The log prints 12 finished jobs with blob ids.
4. `recall` for at least three different queries returns related verdict
   memories (text contains the verdict words `expected` or `important`).
5. `listNamespaces` shows namespace `recall-watchdog` with a memory count of
   10 or more.
6. The live run also makes two small self-transfers of 1,000 MIST each from
   the demo wallet to itself through the public testnet fullnode submit path,
   then re-reads them through Tatum, so the "reads transactions of the demo
   address through Tatum" claim is proven on real data. If the wallet has no
   gas coin the transfer is skipped and the log says so (the read path is
   still proven by the balance and chain reads); the run does not pass the
   transaction-read part in that case.
7. No secret value appears in any log line.

## Journey J3: clean clone

Steps: fresh clone of the repository (or of its git bundle), `npm ci`,
`npm run check`, `npm run demo`.

Expected results:

1. `npm ci` installs from the lock file without error.
2. `npm run typecheck` passes with no error.
3. `npm run lint` passes (file size, banned patterns, secret patterns).
4. `npm run build` produces `dist/`.
5. `node --test test/*.test.mjs` passes: J1 counts, the mainnet guard, input
   validation, and the decision rules.
6. `npm run demo` exits with code 0 (J1 again from the clean clone).

## Prohibited effects

- No secret value (private key, API key) in any file, log line, or commit.
  Keys are read from the environment or from a file outside the repository.
- No mainnet call unless `NETWORK=mainnet` and `ALLOW_MAINNET=1` are both set.
  The default network is testnet. This build never runs mainnet.
- No personal data. Demo data and the demo wallet only. The managed relayer
  sees plaintext, so verdict memory text holds only synthetic patterns.
- No unrelated code. This repository holds only this hackathon entry.

## Oracles (independent expected results)

- Demo counts come from the fixed synthetic batch in `src/synthetic.ts`
  (24 transactions, 8 scripted verdicts). The test asserts the counts, not
  the program's own summary string.
- Live counts come from the relayer (`listNamespaces` memory count) and from
  `recall` hits, not from a local counter.
- Chain reads are checked against the Sui testnet chain identifier
  (`69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`).
