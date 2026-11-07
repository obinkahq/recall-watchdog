# Recall Watchdog

Recall Watchdog watches Sui wallet activity and learns what its owner cares about. Simple rules raise flags for a new counterparty, an amount above 1 SUI, an unfamiliar Move function, or a burst of transactions to one counterparty. The owner marks each flag as `expected` or `important`; each mark is stored in Walrus Memory, and recalled marks then suppress or escalate later flags — with the memory shown behind every decision.

Track: Smart Agents for Real Life. Default network: **Sui testnet**. Mainnet is opt in (see "Network switch"). Two runs on mainnet on 7 November 2026 stored 12 verdict memories each in Walrus Memory on Sui mainnet, in two namespaces: see "Mainnet run of 7 November 2026" and "Second run of 7 November 2026".

## How it uses Walrus Memory and Tatum

- **Walrus Memory** (`@mysten-incubation/memwal`, default namespace `recall-watchdog`; `MEMWAL_NAMESPACE` changes it; the first mainnet run used `recall-watchdog-mainnet` and the second used `default`): `remember` stores each owner verdict (pattern, verdict, short note). Before a flag is shown, the watchdog `recall`s similar past verdicts and then suppresses the flag (owner said `expected`) or escalates it (owner said `important`). `listMemories` gives the memory count. Demo mode uses the SDK mock (`MemWalMock`): same API, same verdict text, no network and no key.
- **Tatum Sui RPC**: chain reads (chain identifier, balance, and the new transactions of the watch address after a cursor) go through the Tatum Sui gRPC gateway with the Sui TypeScript SDK (`SuiGrpcClient` over native gRPC). The API key is sent as `x-api-key` metadata. Each transaction that Tatum returns goes through the same rules and the same memory recall as the demo, and each decision is shown with the memories behind it.

| Network | Tatum endpoint used by this app | Walrus Memory relayer |
|---|---|---|
| testnet (default) | gRPC `sui-testnet-grpc.gateway.tatum.io:443` (testnet is gRPC only on Tatum) | `https://relayer.dev.memwal.ai` |
| mainnet (opt in: `NETWORK=mainnet` and `ALLOW_MAINNET=1`) | gRPC `sui-mainnet-grpc.gateway.tatum.io:443`. Tatum also offers mainnet JSON-RPC at `https://sui-mainnet.gateway.tatum.io`; this app keeps one gRPC code path for both networks. | `https://relayer.memory.walrus.xyz` |

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

The demo judges 24 synthetic transactions, stores 8 scripted owner verdicts in the mock memory, then judges the same batch again. The second pass shows fewer active flags, and each suppressed or escalated flag lists the memories behind it. It ends with the memory count and `Demo checks: PASS`. The demo is offline: it uses the SDK mock, makes no network call, and writes nothing to Walrus. The mainnet memories came from `npm run live`, not from the demo (see "Mainnet run of 7 November 2026").

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

For the same steps on mainnet, see "Mainnet run of 7 November 2026".

## Network switch

`NETWORK=testnet` is the default. `NETWORK=mainnet` selects the mainnet relayer, contract ids, and Tatum mainnet host — but the app **refuses to start** unless `ALLOW_MAINNET=1` is also set. Credentials are specific to a network: a testnet delegate key and account do not work on mainnet. The journeys J1 to J3 in `VERIFY.md` use testnet or no network. Two runs on mainnet were made on 7 November 2026 with the same code (journey J4 in `VERIFY.md`); the next section and its subsection "Second run of 7 November 2026" describe them.

## Mainnet run of 7 November 2026

From 12:26:36 to 12:30:26 UTC on 7 November 2026, one run of the live entry point (`src/live.ts`, the code behind `npm run live`) stored 12 verdict memories in Walrus Memory on **Sui mainnet**. The writes went through the public Walrus Memory relayer. The chain reads went through the Tatum Sui mainnet gRPC gateway. The code that ran is the code of commit `a0e94e9aac1b80e172af4fd6fe74e3605ce4222a` (tree `06d3079c9396e5d0a3db54286dd376f4aa095cbe`). The commit that adds this section changes only `README.md` and `VERIFY.md`.

A small wrapper script, which is not part of this repository, started the app. Before the start it checked the app files against pinned hashes and built the app (its lines `app pins ok` and `app build ok`). The run used these settings:

- `NETWORK=mainnet` and `ALLOW_MAINNET=1`. The start line shows `network=mainnet`, and the app refuses mainnet without `ALLOW_MAINNET=1` (`src/config.ts`).
- `MEMWAL_NAMESPACE=recall-watchdog-mainnet`. The start line shows this namespace; the default is `recall-watchdog`.
- A Tatum API key, a Walrus Memory delegate key and the account id below. The app does not print them.
- `SUI_PRIVATE_KEY` was not set, so the run made no self-transfer. The log says so.

### Public identifiers

| Item | Value |
|---|---|
| Network | Sui mainnet. Chain identifier read through Tatum in the run: `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S` |
| Walrus Memory relayer | `https://relayer.memory.walrus.xyz` |
| Namespace | `recall-watchdog-mainnet` (the second run used `default`) |
| Memory account id (`MemWalAccount` object on Sui) | `0x8e0e7d1428852cd62847bb2a6e899967e6d331367e733c905b7bea2428fa39a4` |
| Owner wallet (the `owner` field of the account object; owns the 12 Blob objects of this run, and 24 after the second run) | `0x906d5fe96469d60dcceeceaf206be8a44744596fe02995da77c63d2c7ae8fe92` |
| Delegate public key that the run was set up with (`MEMWAL_AGENT_ID`) | `4e08f1459a5cc87e2ec66554d40da041c9039b685056b26f30bbeff34c6c5254` (label `recall-watchdog-mainnet`) |
| Sui address of that delegate key | `0xa5340a20905b886f7f45fe47b34d0fe6478ec9c2eee8c2ef39a3e4d0401195c3` |
| Memory package id (mainnet) | `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5` (also in `src/config.ts`) |
| Delegate key registration | Sui transaction `FqXDc9LNoMDTUsH1VADrfhVTWFc1Mmux1Uz3GYqbZUJS`, 2026-11-07 11:35:50 UTC, status SUCCESS, checkpoint 342625114 |
| Storage end of the 12 blobs (and of the 12 blobs of the second run) | Walrus epoch 58, about 2027-06-01 15:00 UTC |

The account holds a second delegate key (label `Web App`, created 2026-11-01). The run was set up with the key labelled `recall-watchdog-mainnet`. No public record shows which of the two keys signed a given write; the relayer lists both keys for the account (check 3 below). Only public keys and addresses are written here. The secret delegate key is not in this repository.

### The 12 memories of the first run

Each memory is one text: `watchdog verdict | pattern: … | verdict: … | note: …` (`verdictText` in `src/memory.ts`). The 12 patterns are synthetic. Memories 1 to 8 are `SCRIPTED_VERDICTS` in `src/synthetic.ts`; memories 9 to 12 are the four extra verdicts in `src/live.ts`. The pattern, the verdict and the blob id are the `remember N/12` lines of the run. The last column is the size that the Walrus aggregator returned on 7 November 2026 at 13:24 UTC.

| # | Time (UTC, 7 Nov 2026) | Verdict | Pattern (synthetic) | Blob id | Bytes |
|---|---|---|---|---|---|
| 1 | 12:26:55.364 | expected | `new-counterparty 57rangea` | `PSRzmZSvZ8V6ML0RCMmRhHNzXLFUH8hftp9sdWRwPPM` | 424 |
| 2 | 12:27:15.771 | expected | `large-amount transfer 5av1ng50` | `30jgj9xt-2D7lXZldAtmaOgdffP0p2Pnn5eing1oDuw` | 438 |
| 3 | 12:27:31.821 | expected | `unfamiliar-function buy_listing` | `bdb3icSpis4HTSMfU_JhV1nK-Mj591dxAxi5xxmAx58` | 416 |
| 4 | 12:27:52.551 | expected | `new-counterparty nf7marke` | `MbKXTfmWvkNRo_dorZ3cVeWMnUWKUxJHF8M8NVvieV4` | 409 |
| 5 | 12:28:08.567 | expected | `large-amount swap` | `70N27O9hiZ1rjmkn_Ucw6KXM7xZhusFbPc_aJepR-rA` | 407 |
| 6 | 12:28:27.111 | important | `new-counterparty 57rangeb` | `uytb8dVttbb-xrfwWOJA7DN89cYkYqgMPuK2ESvjKPU` | 413 |
| 7 | 12:28:49.082 | important | `unfamiliar-function flash_borrow` | `tOmqWzPT4wznIHcct1KWDykRRhZV1AVs6Tj5BTLrndU` | 425 |
| 8 | 12:29:11.339 | important | `unfamiliar-function deposit` | `c6ALjIU72dQYA_bdcjU_Kkc2wGGiMyL2oo9VN9ng21Y` | 410 |
| 9 | 12:29:27.646 | expected | `new-counterparty a11ce000` | `CqAN0IfFUytXewSuaCQ17r8fIqQoZ6P7qbx4FClsWRY` | 414 |
| 10 | 12:29:43.335 | important | `large-amount deposit` | `bNKtqHBlC8oAMS0mR-vuKsWVl8kAI3ihRip220PJP8s` | 415 |
| 11 | 12:30:03.188 | expected | `unfamiliar-function swap` | `tw8D6HxKVLk4PPtUwuf0ZuFc0VHniKu7Yuyy142J3t4` | 405 |
| 12 | 12:30:20.006 | expected | `new-counterparty 5av1ng50` | `SUd4wCsptGEYHbCr4w-hdT-uaTXbsuM_5PAatINi9bY` | 404 |

Lines of the run (a selection; the recall hits are not shown):

```
2026-11-07T12:26:36.581Z start network=mainnet relayer=https://relayer.memory.walrus.xyz tatumHost=sui-mainnet-grpc.gateway.tatum.io:443 namespace=recall-watchdog-mainnet
2026-11-07T12:26:36.821Z health=ok
2026-11-07T12:26:37.024Z tatum chain=4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S balanceMist=0 cursorTaken=yes
2026-11-07T12:26:37.024Z self-transfer skipped: SUI_PRIVATE_KEY is not set (read-only live run)
2026-11-07T12:26:37.024Z storing 12 verdict memories
...
2026-11-07T12:30:22.043Z recall "watchdog verdict pattern new-counterparty rent share flatmate" -> 5 hits
2026-11-07T12:30:24.202Z recall "watchdog verdict pattern large-amount savings transfer" -> 5 hits
2026-11-07T12:30:26.260Z recall "watchdog verdict pattern unfamiliar-function flash borrow important" -> 5 hits
2026-11-07T12:30:26.677Z memory count in namespace=12
2026-11-07T12:30:26.718Z tatum poll after the cursor: newTx=0 cursorAdvanced=no
2026-11-07T12:30:26.718Z Live checks: PASS
```

The process exit code was 0. Right after the run, a separate read-only reader (also outside this repository) listed the namespace through the relayer. It returned the same 12 blob ids: 12 of 12, none more.

### Second run of 7 November 2026

From 21:46:04 to 21:49:58 UTC on the same day, the live entry point ran a second time. The code was the same (commit `a0e94e9aac1b80e172af4fd6fe74e3605ce4222a`, tree `06d3079c9396e5d0a3db54286dd376f4aa095cbe`) and the switches were the same (`NETWORK=mainnet`, `ALLOW_MAINNET=1`, `SUI_PRIVATE_KEY` not set), except `MEMWAL_NAMESPACE=default`. A wrapper script outside this repository started the app, as in the first run. The run stored the same 12 verdicts in the same order, and each memory got a new blob id. So the same 12 verdicts were written to two namespaces: `recall-watchdog-mainnet` (first run) and `default` (second run). The 12 new Blob objects belong to the same owner wallet (check 2 below).

| # | Time (UTC, 7 Nov 2026) | Verdict | Pattern (synthetic) | Blob id | Bytes |
|---|---|---|---|---|---|
| 1 | 21:46:20.099 | expected | `new-counterparty 57rangea` | `qSeXlWrD1sjj7rTBmIbXaME7XuSrv7_qfeedMNkDm7U` | 424 |
| 2 | 21:46:41.120 | expected | `large-amount transfer 5av1ng50` | `f-p7L4qkvAgc5AN5cP0R0J1BtpYgp5stDRrAUm0f6fM` | 438 |
| 3 | 21:47:02.251 | expected | `unfamiliar-function buy_listing` | `rMopJg5Pvn3mncRVIzmDTPoBsqIDy3rzW_VM3DKz3OM` | 416 |
| 4 | 21:47:22.015 | expected | `new-counterparty nf7marke` | `tzeubtTeSHGHI_2T8CXT-37Kg04gYMaja9NlFigY2AQ` | 409 |
| 5 | 21:47:41.421 | expected | `large-amount swap` | `a5riqkhdrCchL0EEIcx7pirgF9rE379CGrYVwjG_-1M` | 407 |
| 6 | 21:48:02.193 | important | `new-counterparty 57rangeb` | `LAqAqKgtfneW-Gf6h_KpVxR90D85e63kEV6JQvuL1UU` | 413 |
| 7 | 21:48:24.251 | important | `unfamiliar-function flash_borrow` | `N6dZkynNY85C8iZlLNoPHVxkT8OwxKYp_KwtW-UkQi0` | 425 |
| 8 | 21:48:45.750 | important | `unfamiliar-function deposit` | `P9o-dcsj0Sgf7Q2yzuEgGjCwPCjS-Fz7rX0Eri-y8eM` | 410 |
| 9 | 21:49:02.215 | expected | `new-counterparty a11ce000` | `O7NLXHTSe4evi7ZKTUlhIG2BwI2Hh1e1CIK6g6ao84g` | 414 |
| 10 | 21:49:18.559 | important | `large-amount deposit` | `TSJFW3jcL4Eg8I8tEFkX3SF2_PeLP6vdfbbJHSV4jH8` | 415 |
| 11 | 21:49:34.536 | expected | `unfamiliar-function swap` | `d-vom1kLdE-AvLSapAxkPnoo00qC0TgGZ-_qprYdxmY` | 405 |
| 12 | 21:49:50.432 | expected | `new-counterparty 5av1ng50` | `yqwolpyGStWU4aDdxaPKF0bx32Eq7SiyEUtKIqjzto8` | 404 |

Lines of the run (a selection; the recall hits are not shown):

```
2026-11-07T21:46:04.213Z start network=mainnet relayer=https://relayer.memory.walrus.xyz tatumHost=sui-mainnet-grpc.gateway.tatum.io:443 namespace=default
2026-11-07T21:46:04.464Z health=ok
2026-11-07T21:46:04.663Z tatum chain=4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S balanceMist=0 cursorTaken=yes
2026-11-07T21:46:04.663Z self-transfer skipped: SUI_PRIVATE_KEY is not set (read-only live run)
2026-11-07T21:46:04.663Z storing 12 verdict memories
...
2026-11-07T21:49:53.181Z recall "watchdog verdict pattern new-counterparty rent share flatmate" -> 5 hits
2026-11-07T21:49:55.602Z recall "watchdog verdict pattern large-amount savings transfer" -> 5 hits
2026-11-07T21:49:58.320Z recall "watchdog verdict pattern unfamiliar-function flash borrow important" -> 5 hits
2026-11-07T21:49:58.725Z memory count in namespace=12
2026-11-07T21:49:58.780Z tatum poll after the cursor: newTx=0 cursorAdvanced=no
2026-11-07T21:49:58.780Z Live checks: PASS
```

The process exit code was 0. Right after the second run (the run ended at 21:49:58 UTC), a separate read-only reader (also outside this repository) listed the namespace `default` through the relayer. It returned the same 12 blob ids: 12 of 12, none more.

### Check it yourself

These checks need no key. They are read-only.

1. **The 24 blobs (12 per run) exist on Walrus mainnet.** Each command prints the HTTP status and the size; the expected values are in the last column of the table of the run. `https://aggregator.suicore.com` also served the 3 ids of the first run that were checked there on 7 November 2026; [the docs list more aggregators](https://docs.wal.app/operators.json).

   ```sh
   for entry in \
     PSRzmZSvZ8V6ML0RCMmRhHNzXLFUH8hftp9sdWRwPPM:424 \
     30jgj9xt-2D7lXZldAtmaOgdffP0p2Pnn5eing1oDuw:438 \
     bdb3icSpis4HTSMfU_JhV1nK-Mj591dxAxi5xxmAx58:416 \
     MbKXTfmWvkNRo_dorZ3cVeWMnUWKUxJHF8M8NVvieV4:409 \
     70N27O9hiZ1rjmkn_Ucw6KXM7xZhusFbPc_aJepR-rA:407 \
     uytb8dVttbb-xrfwWOJA7DN89cYkYqgMPuK2ESvjKPU:413 \
     tOmqWzPT4wznIHcct1KWDykRRhZV1AVs6Tj5BTLrndU:425 \
     c6ALjIU72dQYA_bdcjU_Kkc2wGGiMyL2oo9VN9ng21Y:410 \
     CqAN0IfFUytXewSuaCQ17r8fIqQoZ6P7qbx4FClsWRY:414 \
     bNKtqHBlC8oAMS0mR-vuKsWVl8kAI3ihRip220PJP8s:415 \
     tw8D6HxKVLk4PPtUwuf0ZuFc0VHniKu7Yuyy142J3t4:405 \
     SUd4wCsptGEYHbCr4w-hdT-uaTXbsuM_5PAatINi9bY:404; do
     id=${entry%%:*}; size=${entry##*:}
     printf '%s expected 200 %s, got ' "$id" "$size"
     curl -sS -o /dev/null -w '%{http_code} %{size_download}\n' "https://aggregator.walrus-mainnet.walrus.space/v1/blobs/$id"
   done
   ```

   On 7 November 2026 at 13:24 UTC all 12 answered `200` with these sizes. The bytes are stored data, not the memory text: the text is not readable in them (none of the words `watchdog`, `verdict`, `expected` or `important` occurs in any of the 12 bodies of the first run). In all 12 bodies of the first run, bytes 1 to 32 (counted from 0) are the memory package id and bytes 34 to 65 are the owner wallet address. This was observed on 7 November 2026; it is not a documented format.

   The 12 blobs of the second run (namespace `default`; the sizes are those of the table above):

   ```sh
   for entry in \
     qSeXlWrD1sjj7rTBmIbXaME7XuSrv7_qfeedMNkDm7U:424 \
     f-p7L4qkvAgc5AN5cP0R0J1BtpYgp5stDRrAUm0f6fM:438 \
     rMopJg5Pvn3mncRVIzmDTPoBsqIDy3rzW_VM3DKz3OM:416 \
     tzeubtTeSHGHI_2T8CXT-37Kg04gYMaja9NlFigY2AQ:409 \
     a5riqkhdrCchL0EEIcx7pirgF9rE379CGrYVwjG_-1M:407 \
     LAqAqKgtfneW-Gf6h_KpVxR90D85e63kEV6JQvuL1UU:413 \
     N6dZkynNY85C8iZlLNoPHVxkT8OwxKYp_KwtW-UkQi0:425 \
     P9o-dcsj0Sgf7Q2yzuEgGjCwPCjS-Fz7rX0Eri-y8eM:410 \
     O7NLXHTSe4evi7ZKTUlhIG2BwI2Hh1e1CIK6g6ao84g:414 \
     TSJFW3jcL4Eg8I8tEFkX3SF2_PeLP6vdfbbJHSV4jH8:415 \
     d-vom1kLdE-AvLSapAxkPnoo00qC0TgGZ-_qprYdxmY:405 \
     yqwolpyGStWU4aDdxaPKF0bx32Eq7SiyEUtKIqjzto8:404; do
     id=${entry%%:*}; size=${entry##*:}
     printf '%s expected 200 %s, got ' "$id" "$size"
     curl -sS -o /dev/null -w '%{http_code} %{size_download}\n' "https://aggregator.walrus-mainnet.walrus.space/v1/blobs/$id"
   done
   ```

   On 7 November 2026 at 22:27 UTC all 12 blobs of the second run answered `200` with these sizes, and the 12 blobs of the first run answered `200` with their sizes again.

2. **The 24 Blob objects (12 per run) belong to the owner wallet on Sui mainnet.**

   ```sh
   curl -sS https://graphql.mainnet.sui.io/graphql -H 'content-type: application/json' -d '{"query":"{ chainIdentifier address(address:\"0x906d5fe96469d60dcceeceaf206be8a44744596fe02995da77c63d2c7ae8fe92\") { objects(first:50, filter:{type:\"0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77::blob::Blob\"}) { nodes { address contents { json } } } } }"}'
   ```

   Expected: `chainIdentifier` is `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S`; there are 24 nodes (12 of each run; there were 12 before the second run); in every node `storage.start_epoch` is `43`, `storage.end_epoch` is `58`, `deletable` is `true`, and `size` is one of the sizes in the tables. The `blob_id` field is a decimal number. To get the blob id of the table, write the number as 32 bytes in little-endian order and encode it as base64url without padding. The 24 numbers give the 24 ids (the 12 of each table). Read again on 7 November 2026 at 22:48 UTC: 24 nodes, `start_epoch` 43, `end_epoch` 58 and `deletable` true in every node, and 12 ids from each table.

   The coin balances of the owner wallet:

   ```sh
   curl -sS https://graphql.mainnet.sui.io/graphql -H 'content-type: application/json' -d '{"query":"{ address(address:\"0x906d5fe96469d60dcceeceaf206be8a44744596fe02995da77c63d2c7ae8fe92\") { balances { nodes { totalBalance } } } }"}'
   ```

   Expected: `nodes` is an empty list (read on 7 November 2026 at 22:48 UTC: `{"data":{"address":{"balances":{"nodes":[]}}}}`).

3. **The delegate key belongs to the account.** The relayer lists the public keys of the delegate keys of an account:

   ```sh
   curl -sS https://relayer.memory.walrus.xyz/api/accounts/0x906d5fe96469d60dcceeceaf206be8a44744596fe02995da77c63d2c7ae8fe92/delegate-keys
   ```

   Expected: `account_id` is `0x8e0e7d14…fa39a4`, and `keys` holds the public key `4e08f145…c5254` with the label `recall-watchdog-mainnet`, and a second key with the label `Web App`. The registration transaction `FqXDc9LNoMDTUsH1VADrfhVTWFc1Mmux1Uz3GYqbZUJS` is on Sui mainnet: its sender is the owner wallet and its gas sponsor is another address.

4. **Each namespace held 12 memories at the end of its run.** The app counts them with `listMemories` in `count()` of `createLiveMemory` (`src/memory.ts`) and printed `memory count in namespace=12` in each run (namespace `recall-watchdog-mainnet` in the first run, `default` in the second). That call, and the `recall` calls, need the delegate key. Only the holder of the key can repeat them. The checks 1 to 3 need no key.

### What the runs show, and what they do not show

- **It shows** that the app wrote 12 memories to Walrus Memory on mainnet through the public relayer, that the relayer health was `ok`, that the Tatum mainnet gateway answered the chain read (chain identifier, balance, cursor), that `recall` returned 5 hits for each of 3 queries, and that the namespace held 12 memories. The second run did the same in the namespace `default`: the same code, the same 12 verdicts, 12 new blobs.
- **The relayer paid.** The relayer docs say: "The managed relayer covers WAL storage fees and SUI gas through its server wallets and configured gas sponsor. Account holders do not pay gas or WAL for these relayed writes." ([relayer docs](https://docs.wal.app/walrus-memory/relayer/public-relayer)). The owner wallet holds 0 SUI. Its balance did not change in the key registration transaction or in the 12 write transactions of the first run; one sponsor address paid the gas of all of them. After the second run the owner wallet still holds no coin (read on 7 November 2026 at 22:48 UTC). So the runs do not show what a user pays, or what happens when the shared service applies its usage limits.
- **The memories can be deleted.** The 24 Blob objects are `deletable`, and the owner wallet holds them. The storage ends about 2027-06-01 15:00 UTC (epoch 58; one mainnet epoch is 14 days). The runs are a record of 7 November 2026. It is not a promise that the blobs stay.
- **Demo data only.** The memories of both runs hold the same 12 synthetic verdicts, with short notes. No real wallet activity was stored.
- **The learning loop was not run on mainnet transactions.** The watch address had no new transaction after the cursor: `newTx=0`, so the decision summary is `active=0 suppressed=0 escalated=0`. The before-and-after effect of the learning loop (fewer active flags in the second pass) is shown by the offline demo, which uses the SDK mock. The mainnet runs show the write, recall and count steps with real mainnet storage, not the suppress and escalate steps on live mainnet data.
- **No self-transfer on mainnet.** `SUI_PRIVATE_KEY` was not set.
- **Not repeatable by others as is.** The account id and the delegate public key above are public. The secret key that matches is not in this repository. A reader needs their own account and delegate key. The commands below use your own ids.
- **The log is a record, not a proof.** The log lines above are copied from the output of each run. Checks 1 to 3 let a reader verify that the blobs, the owner and the key exist on public services. They do not verify the log lines.

### Repeat the run with your own account

You need Node.js 22.23.4 or newer (or Node 24), a Tatum API key that works on mainnet, and a Walrus Memory **mainnet** account with a delegate key. Create the account and the delegate key in the Walrus Memory dashboard (<https://memory.walrus.xyz/dashboard>). `npm run setup-account` also accepts `NETWORK=mainnet` with `ALLOW_MAINNET=1`. It was not used for the delegate key above (it registers the label `recall-watchdog`; the key above has the label `recall-watchdog-mainnet`). This repository records no mainnet run of it.

```sh
npm ci
export NETWORK=mainnet
export ALLOW_MAINNET=1
export MEMWAL_NAMESPACE=my-own-namespace
export WATCH_ADDRESS=0x…a-sui-mainnet-address-to-watch…
export TATUM_API_KEY_FILE=/path/outside/repo/tatum.key
export MEMWAL_KEY_FILE=/path/outside/repo/memwal-delegate.key
export MEMWAL_ACCOUNT_ID=0x…your-account-id…
npm run live
```

The run ends with `Live checks: PASS` and exit code 0. The names are in `.env.example`. `MEMWAL_SERVER_URL` is optional; with `NETWORK=mainnet` the default is `https://relayer.memory.walrus.xyz`.

Warnings:

- **Use your own keys and account.** Never put a key, a key file or a `.env` value in this repository. `.gitignore` ignores `.env`, `.env.*` and `*.key`. Keep the key files outside the repository, in files that only you can read (mode 600).
- **Costs may apply.** On 7 November 2026 the relayer paid for the writes, and the relayer docs say that the service applies usage limits. The terms can change. Check the relayer docs before you run.
- **Do not set `SUI_PRIVATE_KEY` unless you mean to spend SUI.** With it set, `npm run live` sends two self-transfers of 1,000 MIST each from `WATCH_ADDRESS` on mainnet, and it pays gas for them with real SUI. The key must belong to `WATCH_ADDRESS`. Both runs of 7 November 2026 left it unset.
- **Each run writes 12 memories.** They stay on Walrus mainnet until their storage ends. Use a namespace of your own.
- **Do not store personal data.** The relayer sees plaintext during embedding and encryption (see "Limits and safety").

## Checks

```sh
npm run check     # type check + lint + build + npm test
npm run test:ui   # browser journey in headless Chromium (needs chromium on PATH or CHROMIUM_BIN)
```

The tests run the built entry points as real processes with local stubs in place of the Sui, Tatum and Walrus Memory SDK clients (`test/support/`), and a guard blocks every connection to a host that is not the loopback host. They use generated fake keys only.

`VERIFY.md` holds the frozen verification contract with its amendments (journeys J1–J4 and the prohibited effects).

## Limits and safety

- **Demo data only.** The managed relayer sees plaintext during embedding and encryption. Verdict memories hold only synthetic patterns and short notes. Do not store personal data.
- Rules are simple and transparent on purpose; they are not financial advice and they do not replace a careful look at your wallet.
- Watching uses the poll model: the app takes a cursor at the chain head, then reads new transactions after it (`listTransactions` with a sender filter). An unanchored history query scans from genesis and pruned full nodes refuse it, so deep history backfill is out of scope. The sender filter also means incoming-only activity from other senders is out of scope for this entry.
- Keys are never committed. `.env` is git ignored; `.env.example` holds names only. Logs never print a key, and no output or HTTP response repeats the text of a dependency error (such an error can hold key text): each entry point prints fixed text that names the failed step.
- Amount rules count SUI balance changes only. Other coin types have their own decimals and value, so a token transfer does not get a `large-amount` flag.
- The rule gives a `large-amount` flag for a SUI amount of more than 1 SUI (1,000,000,000 MIST). An amount of exactly 1 SUI does not get the flag.
- The web server binds to `127.0.0.1` only. It answers only requests for its own address (`Host` is `127.0.0.1:PORT` or `localhost:PORT`) and refuses a request from another origin (an `Origin` header that is not its own, also `null`) with HTTP 403. A request that the browser marks as from another site or origin (`Sec-Fetch-Site`) also gets HTTP 403, except a load of the page itself. A write needs `Content-Type: application/json`; other types get HTTP 415. The server sends no CORS header, and its page cannot be shown in a frame. So another web page in the same browser cannot store a verdict, read the watch data, or make the server call Tatum or the memory relayer.

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
