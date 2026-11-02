# Recall Watchdog

Recall Watchdog watches Sui wallet activity and learns what its owner cares about. Simple rules raise flags for a new counterparty, an amount far above the usual, an unfamiliar Move function, or a burst of transactions to one counterparty. The owner marks each flag as `expected` or `important`; each mark is stored in Walrus Memory, and recalled marks then suppress or escalate later flags — with the memory shown behind every decision.

Track: Smart Agents for Real Life. Default network: **Sui testnet**. Mainnet is coded but off by default (see "Network switch").

## How it uses Walrus Memory and Tatum

- **Walrus Memory** (`@mysten-incubation/memwal`, namespace `recall-watchdog`): `remember` stores each owner verdict (pattern, verdict, short note). Before a flag is shown, the watchdog `recall`s similar past verdicts and then suppresses the flag (owner said `expected`) or escalates it (owner said `important`). `listMemories` gives the memory count. Demo mode uses the SDK mock (`MemWalMock`): same API, same verdict text, no network and no key.
- **Tatum Sui RPC**: chain reads (chain identifier, balance, and the new transactions of the watch address after a cursor) go through the Tatum Sui gRPC gateway with the Sui TypeScript SDK (`SuiGrpcClient` over native gRPC). The API key is sent as `x-api-key` metadata. Each transaction that Tatum returns goes through the same rules and the same memory recall as the demo, and each decision is shown with the memories behind it.

| Network | Tatum endpoint used by this app | Walrus Memory relayer |
|---|---|---|
| testnet (default) | gRPC `sui-testnet-grpc.gateway.tatum.io:443` (testnet is gRPC only on Tatum) | `https://relayer.dev.memwal.ai` |
| mainnet (off by default) | gRPC `sui-mainnet-grpc.gateway.tatum.io:443`. Tatum also offers mainnet JSON-RPC at `https://sui-mainnet.gateway.tatum.io`; this app keeps one gRPC code path for both networks. | `https://relayer.memory.walrus.xyz` |

## The learning loop

1. **Judge.** Each transaction is checked by four rules. A match gives a flag with a stable *pattern key* (for example `new-counterparty 57rangea`) and a reason.
2. **Teach.** The owner marks a flag `expected` or `important` with a short note. The verdict is stored as one memory: `watchdog verdict | pattern: … | verdict: … | note: …`.
3. **Recall.** For the next flagged transaction the app recalls similar verdicts and matches by pattern. `expected` suppresses the flag, `important` escalates it. Suppressed flags stay in the output with their memories, so the owner can audit every silence.

```
                 ┌────────────────────────────┐
  Tatum gRPC ───►│ fetch recent transactions  │
                 └─────────────┬──────────────┘
                               ▼
                 ┌────────────────────────────┐     recall similar verdicts
                 │ rules → flags + patterns   │◄──────────────────────┐
                 └─────────────┬──────────────┘                        │
                               ▼                                       │
                 ┌────────────────────────────┐     Walrus Memory      │
                 │ decide: flag / suppress /  │     namespace:         │
                 │ escalate (memory shown)    │     recall-watchdog    │
                 └─────────────┬──────────────┘                        │
                               ▼                                       │
                 owner verdict (expected / important) ── remember ─────┘
```

## Run the demo (two commands, no key)

```sh
npm ci
npm run demo
```

The demo judges 24 synthetic transactions, stores 8 scripted owner verdicts in the mock memory, then judges the same batch again. The second pass shows fewer active flags, and each suppressed or escalated flag lists the memories behind it. It ends with the memory count and `Demo checks: PASS`.

For the web UI:

```sh
npm run build && npm start
# open http://127.0.0.1:4173/
```

The page shows the demo batch. Without `WATCH_ADDRESS` the app is in demo mode by choice; a set but malformed `WATCH_ADDRESS` stops the server with a clear error.

## Run live on testnet

You need Node.js 22.23.4 or newer (or Node 24), a funded Sui testnet wallet, a Tatum API key, and a Walrus Memory testnet account with a delegate key.

1. Copy the names from `.env.example` into your shell or a local `.env` (never commit values). Secrets can also come from files: set `TATUM_API_KEY_FILE`, `MEMWAL_KEY_FILE`, etc. to a mode-600 file with one line.
2. Create the account and a delegate key (one time, pays testnet gas):

```sh
SUI_PRIVATE_KEY_FILE=/path/outside/repo/owner-wallet.key \
MEMWAL_DELEGATE_KEY_OUT=/path/outside/repo/memwal-delegate.key \
  npm run setup-account
```

   Before any chain call, setup checks the owner key locally and creates the output file: a new absolute path outside the repository, mode 600 (an existing file is never overwritten). The delegate secret is written to that file before the key is registered on chain. Setup prints the account id; set `MEMWAL_ACCOUNT_ID` to it and `MEMWAL_KEY_FILE` to that file.
3. Run the live round trip (health, Tatum read, 12 memories, recall, count, then the decisions for the new transactions):

```sh
WATCH_ADDRESS=0x…your-testnet-address… npm run live
```

   With `SUI_PRIVATE_KEY` set to the same wallet, the run also makes two 1,000-MIST self-transfers through the public testnet fullnode and re-reads them through Tatum. The run then judges every new transaction after the cursor with the rules and the recalled verdicts and prints each decision with its memories.
4. Or run the UI with live data: set `WATCH_ADDRESS` and `TATUM_API_KEY` (plus the memory variables for live memory), then `npm run build && npm start`. The "Live watch" section shows the new transactions after the watch cursor with their decisions; "Read new transactions via Tatum" reads the next cursor page. Mark a flag `expected` or `important` and the rows are judged again.

## Network switch

`NETWORK=testnet` is the default. `NETWORK=mainnet` selects the mainnet relayer, contract ids, and Tatum mainnet host — but the app **refuses to start** unless `ALLOW_MAINNET=1` is also set. Credentials are specific to a network: a testnet delegate key and account do not work on mainnet. This entry was built and verified on testnet only.

## Checks

```sh
npm run check     # type check + lint + build + npm test
npm run test:ui   # browser journey in headless Chromium (needs chromium on PATH or CHROMIUM_BIN)
```

The tests run the built entry points as real processes with local stubs in place of the Sui, Tatum and Walrus Memory SDK clients (`test/support/`), and a guard blocks every connection to a host that is not the loopback host. They use generated fake keys only.

`VERIFY.md` holds the frozen verification contract (journeys J1–J3 and the prohibited effects).

## Limits and safety

- **Demo data only.** The managed relayer sees plaintext during embedding and encryption. Verdict memories hold only synthetic patterns and short notes. Do not store personal data.
- Rules are simple and transparent on purpose; they are not financial advice and they do not replace a careful look at your wallet.
- Watching uses the poll model: the app takes a cursor at the chain head, then reads new transactions after it (`listTransactions` with a sender filter). An unanchored history query scans from genesis and pruned full nodes refuse it, so deep history backfill is out of scope. The sender filter also means incoming-only activity from other senders is out of scope for this entry.
- Keys are never committed. `.env` is git ignored; `.env.example` holds names only. Logs never print a key, and no output or HTTP response repeats the text of a dependency error (such an error can hold key text): each entry point prints fixed text that names the failed step.
- Amount rules count SUI balance changes only. Other coin types have their own decimals and value, so a token transfer does not get a `large-amount` flag.
- The rule gives a `large-amount` flag for a SUI amount of more than 1 SUI (1,000,000,000 MIST). An amount of exactly 1 SUI does not get the flag.
- The web server binds to `127.0.0.1` only. It answers only requests for its own address (`Host` is `127.0.0.1:PORT` or `localhost:PORT`) and refuses a request from another origin (an `Origin` header that is not its own, also `null`) with HTTP 403. A write needs `Content-Type: application/json`; other types get HTTP 415. The server sends no CORS header, and its page cannot be shown in a frame. So another web page in the same browser cannot store a verdict or read the watch data.

## Project shape

- `src/config.ts` — network switch, secret loading (env or file), public contract ids.
- `src/errors.ts`, `src/keys.ts`, `src/key-file.ts` — fixed error text, key checks, and the private output file for setup.
- `src/tatum.ts` — Tatum gRPC client and transaction mapping.
- `src/memory.ts` — Walrus Memory boundary (live SDK and SDK mock behind one interface).
- `src/rules.ts`, `src/decide.ts`, `src/watch.ts` — the four rules, the recall-based decision, and the live watch page.
- `src/demo.ts`, `src/live.ts` (with `src/live-settings.ts`), `src/server.ts`, `src/setup-account.ts` — entry points.
- `public/index.html` — the web UI. `test/` — journey checks. `scripts/check.mjs` — lint.

## Licence

MIT. Copyright (c) 2026 Obinka Ltd. Author: Obinka Ltd.
