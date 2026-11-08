# Recall Watchdog: a Sui wallet watchdog that remembers your answers

By Obinka Ltd · 8 November 2026 · Built for the Walrus x Tatum "Total Recall" hackathon

**Summary.** Recall Watchdog watches one Sui wallet. Four simple rules flag unusual transactions. The wallet owner answers each flag with `expected` or `important`, and the app stores each answer as a memory in Walrus Memory. On later transactions it recalls those answers: it silences flags the owner called expected and raises flags the owner called important. Chain reads go through Tatum's Sui gateway. This post says what the app does, how it uses Tatum and Walrus, and what the 24 mainnet memories of 7 November 2026 (the same 12 verdicts in two namespaces) show and do not show.

## The problem

A watchdog that forgets is a nuisance. It may flag the same rent payment every month. The owner says "this is fine", and the next run asks again. The answer needs a place that outlives the process. Here, that place is Walrus Memory.

## What the app does

Four rules judge each transaction:

- **new counterparty**: the other address was not seen before;
- **large amount**: more than 1 SUI;
- **unfamiliar function**: a Move function that was not used before;
- **burst**: three or more transactions to one counterparty within 10 minutes.

Each flag has a stable pattern key, for example `new-counterparty 57rangea`. The owner marks the flag `expected` or `important` and adds a short note. The app stores one memory per answer:

`watchdog verdict | pattern: … | verdict: … | note: …`

Before the app shows a flag, it recalls similar verdicts. An `expected` verdict suppresses the flag. An `important` verdict escalates it. A suppressed flag stays in the output with its memory, so the owner can audit every silence. The app is built for the track "Smart Agents for Real Life".

## How it uses Tatum

All chain reads use Tatum's Sui gRPC gateway: `sui-mainnet-grpc.gateway.tatum.io:443` on mainnet and `sui-testnet-grpc.gateway.tatum.io:443` on testnet. The app uses the Sui TypeScript SDK `SuiGrpcClient` and sends the API key as `x-api-key` metadata. It makes four calls (`src/tatum.ts`):

1. `getChainIdentifier`;
2. `getBalance` for the watched address, in SUI;
3. `listTransactions` with `limit: 1`, newest first, to take a cursor at the chain head;
4. `listTransactions` with a sender filter, `after` that cursor, and `include` for the transaction, balance changes and effects.

The cursor matters. A sender query without an anchor scans from genesis, and a pruned full node refuses it with `OUT_OF_RANGE`. The project's `VERIFY.md` records this on both the Tatum node and the public fullnode. So the app polls forward from the head, and retries once after a 429 or "unavailable" error. Each transaction that Tatum returns goes through the same rules and recall as the demo. The optional test transfers of a live run use the public fullnode, not Tatum.

## How it uses Walrus Memory

The app uses the SDK `@mysten-incubation/memwal` 0.1.12. One client holds a delegate key, an account id, a relayer URL and a namespace. The app calls `rememberAndWait` for each verdict, `recall` before it shows a flag (up to 8 results), `listMemories` for the count, and `health`. Demo mode uses the SDK's `MemWalMock`: same API, no network, no key.

The mainnet relayer is `https://relayer.memory.walrus.xyz`. The first run of 7 November used the namespace `recall-watchdog-mainnet` and a second run the same evening wrote the same 12 verdicts again into the namespace `default`; the default in the code is `recall-watchdog`. The Walrus docs say the managed relayer receives the text, embeds it, encrypts it with Seal, stores it on Walrus, and pays WAL and gas for relayed writes. So the relayer sees the text in plain form, and the app stores only demo patterns and short notes.

## How it learned over time

**What is built.** The loop is judge, teach, recall. The demo runs it on 24 synthetic transactions. With empty memory, the first pass raises 14 active flags. Then 8 scripted verdicts (5 `expected`, 3 `important`) are stored. The same batch, judged again, gives 10 active flags: 4 flags are suppressed, and 2 of the 10 are escalated. Only 4 are suppressed because a transaction is silenced only when every flag on it has an `expected` verdict. The demo has no verdict for burst flags, so those transactions stay flagged. Matching is plain text: the same pattern, a pattern that starts with the verdict pattern, or a flag that holds every word (of 3 or more characters) of the verdict pattern. The app trains no model.

**What the evidence does not show.** The 24 verdicts written to mainnet (the same 12 example verdicts, once in each of two namespaces) are example verdicts from the code. They are not feedback from a person over weeks. Each mainnet run judged no live transaction: its Tatum poll returned 0 new transactions, and its self-transfer step was skipped. So this post has no result of the loop on real mainnet traffic. Each run shows that the memories exist outside the process: a separate read-only run listed the same 12 blob ids in each namespace. Next steps: judge live transactions on Mainnet (the 7 November runs saw none), and collect verdicts from a person over weeks, so that recall can be judged on real feedback.

## The mainnet run of 7 November 2026

Between 12:26 and 12:30 UTC the app's live entry point (`src/live.ts`, commit `a0e94e9`) checked relayer health, read the chain through Tatum, wrote 12 verdict memories, ran 3 recall queries (5 hits each) and counted 12 memories in the namespace `recall-watchdog-mainnet`. Between 21:46 and 21:50 UTC the same entry point ran a second time for the namespace `default` and wrote the same 12 verdicts again, with the same checks (12 remembered, 3 recall queries with 5 hits each, 12 counted in that namespace). Public identifiers:

- Account id: `0x8e0e7d1428852cd62847bb2a6e899967e6d331367e733c905b7bea2428fa39a4`
- Owner wallet: `0x906d5fe96469d60dcceeceaf206be8a44744596fe02995da77c63d2c7ae8fe92`
- Delegate public key: `4e08f1459a5cc87e2ec66554d40da041c9039b685056b26f30bbeff34c6c5254`
- Key registration transaction: `FqXDc9LNoMDTUsH1VADrfhVTWFc1Mmux1Uz3GYqbZUJS` (a gas sponsor paid; its balance change is the only one)

The 12 blobs of the first run (namespace `recall-watchdog-mainnet`), in write order (the order of `LIVE_VERDICTS` in `src/live.ts`):

| # | Verdict pattern | Blob id |
|---|---|---|
| 1 | expected `new-counterparty 57rangea` | `PSRzmZSvZ8V6ML0RCMmRhHNzXLFUH8hftp9sdWRwPPM` |
| 2 | expected `large-amount transfer 5av1ng50` | `30jgj9xt-2D7lXZldAtmaOgdffP0p2Pnn5eing1oDuw` |
| 3 | expected `unfamiliar-function buy_listing` | `bdb3icSpis4HTSMfU_JhV1nK-Mj591dxAxi5xxmAx58` |
| 4 | expected `new-counterparty nf7marke` | `MbKXTfmWvkNRo_dorZ3cVeWMnUWKUxJHF8M8NVvieV4` |
| 5 | expected `large-amount swap` | `70N27O9hiZ1rjmkn_Ucw6KXM7xZhusFbPc_aJepR-rA` |
| 6 | important `new-counterparty 57rangeb` | `uytb8dVttbb-xrfwWOJA7DN89cYkYqgMPuK2ESvjKPU` |
| 7 | important `unfamiliar-function flash_borrow` | `tOmqWzPT4wznIHcct1KWDykRRhZV1AVs6Tj5BTLrndU` |
| 8 | important `unfamiliar-function deposit` | `c6ALjIU72dQYA_bdcjU_Kkc2wGGiMyL2oo9VN9ng21Y` |
| 9 | expected `new-counterparty a11ce000` | `CqAN0IfFUytXewSuaCQ17r8fIqQoZ6P7qbx4FClsWRY` |
| 10 | important `large-amount deposit` | `bNKtqHBlC8oAMS0mR-vuKsWVl8kAI3ihRip220PJP8s` |
| 11 | expected `unfamiliar-function swap` | `tw8D6HxKVLk4PPtUwuf0ZuFc0VHniKu7Yuyy142J3t4` |
| 12 | expected `new-counterparty 5av1ng50` | `SUd4wCsptGEYHbCr4w-hdT-uaTXbsuM_5PAatINi9bY` |

The 12 blobs of the second run (namespace `default`, 21:46 to 21:50 UTC), in the same write order. All 12 answered HTTP 200 on the same public aggregator with the same sizes, and a separate read-only run listed the same 12 ids:

| # | Verdict pattern | Blob id |
|---|---|---|
| 1 | expected `new-counterparty 57rangea` | `qSeXlWrD1sjj7rTBmIbXaME7XuSrv7_qfeedMNkDm7U` |
| 2 | expected `large-amount transfer 5av1ng50` | `f-p7L4qkvAgc5AN5cP0R0J1BtpYgp5stDRrAUm0f6fM` |
| 3 | expected `unfamiliar-function buy_listing` | `rMopJg5Pvn3mncRVIzmDTPoBsqIDy3rzW_VM3DKz3OM` |
| 4 | expected `new-counterparty nf7marke` | `tzeubtTeSHGHI_2T8CXT-37Kg04gYMaja9NlFigY2AQ` |
| 5 | expected `large-amount swap` | `a5riqkhdrCchL0EEIcx7pirgF9rE379CGrYVwjG_-1M` |
| 6 | important `new-counterparty 57rangeb` | `LAqAqKgtfneW-Gf6h_KpVxR90D85e63kEV6JQvuL1UU` |
| 7 | important `unfamiliar-function flash_borrow` | `N6dZkynNY85C8iZlLNoPHVxkT8OwxKYp_KwtW-UkQi0` |
| 8 | important `unfamiliar-function deposit` | `P9o-dcsj0Sgf7Q2yzuEgGjCwPCjS-Fz7rX0Eri-y8eM` |
| 9 | expected `new-counterparty a11ce000` | `O7NLXHTSe4evi7ZKTUlhIG2BwI2Hh1e1CIK6g6ao84g` |
| 10 | important `large-amount deposit` | `TSJFW3jcL4Eg8I8tEFkX3SF2_PeLP6vdfbbJHSV4jH8` |
| 11 | expected `unfamiliar-function swap` | `d-vom1kLdE-AvLSapAxkPnoo00qC0TgGZ-_qprYdxmY` |
| 12 | expected `new-counterparty 5av1ng50` | `yqwolpyGStWU4aDdxaPKF0bx32Eq7SiyEUtKIqjzto8` |

**How to check.** Fetch a blob from a public aggregator. On 7 November all 24 returned HTTP 200 with 404 to 438 bytes (the same 12 sizes in each namespace). The example below checks the first blob; use any id from the tables:

```sh
curl -s -o blob.bin -w '%{http_code} %{size_download}\n' \
  https://aggregator.walrus-mainnet.walrus.space/v1/blobs/PSRzmZSvZ8V6ML0RCMmRhHNzXLFUH8hftp9sdWRwPPM
```

The body is encrypted, so you cannot read the verdict text. Its first bytes hold the Walrus Memory package id and the owner wallet address (observed on 7 November 2026). The pattern column therefore rests on the code order. The account's delegate keys are public:

```sh
curl -s https://relayer.memory.walrus.xyz/api/accounts/0x906d5fe96469d60dcceeceaf206be8a44744596fe02995da77c63d2c7ae8fe92/delegate-keys
```

The list has two keys; `recall-watchdog-mainnet` is the one above. The Sui GraphQL endpoint `https://graphql.mainnet.sui.io/graphql` returns the registration transaction. Storage ends at Walrus epoch 58, about 1 June 2027. The blobs are deletable by their holder.

## Honest limits

- The relayer sees the text in plain form. Use demo data only.
- The rules are simple and are not financial advice.
- Amount rules count SUI only. A token transfer gets no `large-amount` flag.
- The app reads transactions sent by the watched address. Incoming-only activity and deep history are out of scope.
- The repository default is testnet. Mainnet needs `NETWORK=mainnet` and `ALLOW_MAINNET=1`.
- 12 example verdicts are a small test, not a trial.

## Run it

```sh
git clone https://github.com/obinkahq/recall-watchdog
cd recall-watchdog
npm ci
npm run demo     # no key, no network; ends with "Demo checks: PASS"
```

It needs Node.js 22.23.4 or newer. For a live run, create a Walrus Memory account and a delegate key at `memory.walrus.xyz/dashboard`, and get a Tatum API key. Set the names in `.env.example` (`TATUM_API_KEY_FILE`, `WATCH_ADDRESS`, `MEMWAL_KEY_FILE`, `MEMWAL_ACCOUNT_ID`, `MEMWAL_NAMESPACE`; on mainnet also `NETWORK` and `ALLOW_MAINNET`), then run `npm run live`. Keep key files outside the repository.

## Links

- Code (MIT licence): https://github.com/obinkahq/recall-watchdog
- Event: https://recall-tatum-walrus.vercel.app/
- Author: Obinka Ltd (https://obinka.com)
- Demo video: https://obinka.com/d/f189b2531a1e36c04e183dbb71675dc0/recall-watchdog-demo.mp4
