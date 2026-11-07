# Verification contract (frozen before the code)

## Consumer

A hackathon judge who clones this repository, reads the README, and runs the
demo. A second consumer is a Sui wallet owner who runs the same code against
Sui testnet (default) or, with `ALLOW_MAINNET=1`, Sui mainnet, with their own
keys.

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
   `x-api-key` metadata): chain identifier, balance, and a head cursor. New
   transactions are then read with the poll model (`listTransactions` with a
   sender filter and `after` set to that cursor), because an unanchored
   sender query scans from genesis and a pruned full node refuses it with
   OUT_OF_RANGE (seen on both the Tatum node and the public fullnode). The
   log prints the chain identifier and the counts. A 429 or unavailable
   error is retried once and then reported as a clear failure (not a pass).
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
  The default network is testnet. Mainnet runs only when it is asked for; the
  runs of 7 November 2026 are journey J4 in the last amendment below.
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

## Amendment after review 1 (2026-11-02)

The independent review of head 703020a gave NO-SHIP with six findings. The
fixes add these expected results. The earlier results above stay in force.

- J2 step 8 (new): after the memories are stored, the live run reads the
  new transactions after the cursor through Tatum and judges each one with
  `judgeBatch` (rules, then recall of the stored verdicts). The log prints
  each decision with its flags and the memories behind it.
- Key material: no output, log line, thrown error text, HTTP response or
  written file holds text from a key or from a dependency error message.
  Each entry point prints fixed text that names the failed step. Every key
  is checked locally before any network call.
- Web UI: without `WATCH_ADDRESS` the app is in demo mode. A set but
  malformed `WATCH_ADDRESS` stops startup. With a valid address and the
  Tatum key, the UI shows the new transactions after the watch cursor with
  their decisions and memories, and reads the next page with `nextCursor`.
- Amount rules count SUI balance changes only (short or long coin type).
- `setup-account` checks the owner key and reserves the output file (new,
  absolute, outside the repository, mode 600 read back) before any chain
  call, and writes the delegate key before the on-chain registration.

Oracles for the amendment: `test/live-decisions.test.mjs` holds the expected
live decisions written from the rules and the 12 live verdicts; the stub SDK
clients in `test/support/` return known transactions and record each call;
`test/ui-browser.mjs` drives the page in headless Chromium. J2 with real
keys is still the proof on testnet: the stubs do not replace it.

## Amendment after review 2 (2026-11-02)

Review 2 found that another web page in the owner's browser could store a
verdict through the local web server (F7) and that three boundaries had no
test (F8). These expected results are added. The earlier results stay in force.

- Web server requests: the server binds to `127.0.0.1` only. Every request
  needs a `Host` header of `127.0.0.1:PORT` or `localhost:PORT` (a DNS
  rebinding name gets HTTP 403). An `Origin` header, when sent, must be the
  origin of that same address (another origin and `null` get HTTP 403). A
  request that the browser marks with `Sec-Fetch-Site` other than
  `same-origin` or `none` gets HTTP 403, except a load of the page `/`. A
  request with a method other than GET or HEAD needs
  `Content-Type: application/json` (text/plain, form, multipart and a missing
  type get HTTP 415). A refused request stores nothing. No response carries an
  `Access-Control-*` header. Every response has `X-Frame-Options: DENY` and a
  content policy with `frame-ancestors 'none'`. A body above 16 KiB is refused
  and not read to its end.
- Server startup: a port in use, a missing or empty secret file, a bad `PORT`
  or `NETWORK`, a malformed `WATCH_ADDRESS` and a dependency error each stop
  startup with one fixed line, exit code 1, and no stack or key text.
- Demo boundary: demo chain data only when `WATCH_ADDRESS` is unset or blank,
  and then no SDK client is built. `npm run demo` builds no live client
  whatever keys are set, and its error boundary prints fixed text only.
- Large amount: more than 1 SUI (1,000,000,000 MIST) gets the flag; exactly
  1 SUI does not.

Oracles: `test/server-guard.test.mjs` sends raw HTTP requests and counts
memory writes in the stub log; `test/ui-browser.mjs` opens a page of another
site in the same browser and checks that it stores nothing and makes the
server call nothing;
`test/server-startup.test.mjs`, `test/demo-boundary.test.mjs` and
`test/amount-limit.test.mjs` hold the expected texts and boundary values.

## Amendment after the mainnet runs (2026-11-07, two runs)

On 7 November 2026 the live entry point ran twice on Sui mainnet: from 12:26
to 12:30 UTC (namespace `recall-watchdog-mainnet`) and from 21:46 to 21:50 UTC
(namespace `default`, see "Second run" at the end of J4). This is journey J4. The earlier results stay in force, except the sentence "This build
never runs mainnet" in "Prohibited effects", which is replaced above. J4 uses
no stub: it runs the real live entry point against Sui mainnet, the public
Walrus Memory relayer and the Tatum mainnet gateway.

### Journey J4: live mainnet run, read-only on the chain side

Consumer: a hackathon judge who reads the README section "Mainnet run of 7
November 2026" and checks the public identifiers on public services.

Preconditions: `NETWORK=mainnet` and `ALLOW_MAINNET=1`; a Tatum API key; a
Walrus Memory mainnet account with a registered delegate key; a namespace of
the runner's choice (`recall-watchdog-mainnet` in the first run and `default` in the second run, both on 7 November 2026);
`SUI_PRIVATE_KEY` not set, so the run makes no self-transfer. The code under
test is commit `a0e94e9aac1b80e172af4fd6fe74e3605ce4222a` (tree
`06d3079c9396e5d0a3db54286dd376f4aa095cbe`). The commit that adds this
amendment changes `README.md` and `VERIFY.md` only.

Steps: `npm run live` with the settings above. On 7 November 2026 a wrapper
script outside this repository started the live entry point; the app printed
the lines that the README quotes.

Expected results (the observed result of the first run of 7 November 2026
(12:26 to 12:30 UTC) is in brackets):

1. The start line shows the mainnet network, the mainnet relayer and the Tatum
   mainnet host. [`network=mainnet relayer=https://relayer.memory.walrus.xyz
   tatumHost=sui-mainnet-grpc.gateway.tatum.io:443
   namespace=recall-watchdog-mainnet`]
2. `health()` returns `ok`. [`health=ok`]
3. The Tatum read returns the Sui mainnet chain identifier. [`4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S`]
4. The app stores 12 verdict memories and prints 12 blob ids. [12 lines
   `remember N/12`, N from 1 to 12]
5. `recall` for three queries returns hits. [5 hits for each query]
6. The memory count in the namespace is 10 or more. [12]
7. The process prints `Live checks: PASS` and exits with code 0. [yes]
8. No secret value appears in any output line. [A scan of the run output for
   key forms (hex, base64, Bech32) found none. This is local evidence and it
   is unauthenticated.]

Oracles (independent of the output of the app):

- Each of the 12 blob ids returns HTTP 200 from a Walrus mainnet aggregator,
  with the size in the README table. [12 of 12, read again on 2026-11-07 at
  13:24 UTC]
- The Sui mainnet GraphQL service lists the 12 `::blob::Blob` objects of this
  run among the objects owned by the owner wallet (24 objects after the second
  run, see below). Their `blob_id` values equal the 12 ids, and `end_epoch` is
  58. [yes]
- The relayer lists the delegate public key `4e08f145…` with the label
  `recall-watchdog-mainnet` for the account. [yes]
- The chain identifier of Sui mainnet in the GraphQL service equals the one the
  app read through Tatum. [yes]

Prohibited effects (observed absent): a mainnet call without both switches
(the app refuses it); a SUI payment by the owner wallet (its balance is 0 SUI
and did not change in the key registration transaction or in the 12 write
transactions; a gas sponsor paid); a self-transfer; a secret in an output line.

Second run (same day, namespace `default`): J4 was run a second time with the
same code (commit `a0e94e9aac1b80e172af4fd6fe74e3605ce4222a`) and the same
switches (`NETWORK=mainnet`, `ALLOW_MAINNET=1`, `SUI_PRIVATE_KEY` not set), with
`MEMWAL_NAMESPACE=default`. Observed, from 21:46:04 to 21:49:58
UTC: items 1 to 7 as above, with `namespace=default` in the start line, 12 lines
`remember N/12` with 12 new blob ids, 5 hits for each of the 3 queries,
`memory count in namespace=12`, `Live checks: PASS`, exit code 0. The oracles
for the second run:

- Each of the 12 new blob ids (README table "Second run of 7 November 2026")
  returns HTTP 200 from the Walrus mainnet aggregator, with the size in that
  table. [12 of 12, read on 2026-11-07 at 22:27 UTC; the 12 ids of the first run
  answered 200 again]
- The Sui mainnet GraphQL service lists 24 `::blob::Blob` objects owned by the
  owner wallet: the 12 of the first run and the 12 of the second run. In every
  object `start_epoch` is 43, `end_epoch` is 58 and `deletable` is true. [yes,
  read on 2026-11-07 at 22:48 UTC]
- The balance list of the owner wallet returns no coin. [yes, same time]
- A separate read-only reader listed the namespace `default` through the relayer
  and returned the same 12 blob ids as the run printed. [yes, ended 21:50 UTC]

The second run stores the same 12 verdicts as the first run. It adds no new
behaviour; it puts the memories into a second namespace.

What J4 does not cover:

- The decision loop on live mainnet transactions. The poll after the cursor
  found no new transaction (`newTx=0`; `active=0 suppressed=0 escalated=0`).
  The suppress and escalate effect is shown by the offline demo (J1) only.
- A read of the memory text by a third party. That needs the delegate key.
- Retention. The blobs are deletable. Their storage ends about 2027-06-01
  15:00 UTC (epoch 58).
- The cost and the usage limits of the relayer for other users. The relayer
  paid for the writes of the first run; after the second run the owner wallet
  still holds no coin.
- Authentication of the evidence. The run lines in the README are copied from
  the output of each run. They are not signed.
