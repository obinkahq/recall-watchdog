// Web UI server. Node http only (no web framework). Binds to 127.0.0.1.
// Demo mode by default. With the live keys set, /api/snapshot also returns
// the Tatum chain read. Every request body is checked with zod. Error
// responses carry fixed text only.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { judgeBatch } from './decide.js';
import { createDemoMemory, createLiveMemory, type MemoryStore } from './memory.js';
import { createSuiClients, fetchChainState, fetchTransactionsByDigest, type SuiClients } from './tatum.js';
import { ADDRESS_PATTERN, readSecret, resolveMemwalServerUrl, resolveNamespace, resolveNetwork, resolvePort, type NetworkConfig } from './config.js';
import { FixedError, RequestError, failureText, installFixedCrashHandlers } from './errors.js';
import { checkMemwalKey, checkObjectId } from './keys.js';
import { checkTatumKey } from './live-settings.js';
import { formatSui } from './rules.js';
import { DEMO_OWNER, KNOWN_COUNTERPARTIES, KNOWN_FUNCTIONS, syntheticBatch } from './synthetic.js';

const VerdictBody = z.object({
  pattern: z.string().min(1).max(120),
  kind: z.enum(['expected', 'important']),
  note: z.string().min(1).max(200),
});

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > 16_384) throw new RequestError('Request body is too large.');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestError('Request body must be valid JSON.');
  }
}

function pickMemory(network: NetworkConfig): { store: MemoryStore; mode: 'demo' | 'live' } {
  const key = readSecret('MEMWAL_KEY');
  const accountId = readSecret('MEMWAL_ACCOUNT_ID');
  const namespace = resolveNamespace();
  if (key !== undefined && accountId !== undefined) {
    const store = createLiveMemory({
      key: checkMemwalKey(key, 'MEMWAL_KEY'),
      accountId: checkObjectId(accountId, 'MEMWAL_ACCOUNT_ID'),
      serverUrl: resolveMemwalServerUrl(network),
      namespace,
    });
    return { store, mode: 'live' };
  }
  return { store: createDemoMemory(namespace), mode: 'demo' };
}

interface LiveWatch {
  readonly clients: SuiClients;
  readonly watchAddress: string;
}

function pickLiveWatch(network: NetworkConfig): LiveWatch | null {
  const tatumKey = readSecret('TATUM_API_KEY');
  const watchAddressRaw = process.env.WATCH_ADDRESS?.trim();
  const watchAddress = watchAddressRaw !== undefined && ADDRESS_PATTERN.test(watchAddressRaw) ? watchAddressRaw.toLowerCase() : null;
  if (tatumKey === undefined || watchAddress === null) return null;
  return { clients: createSuiClients(network, checkTatumKey(tatumKey)), watchAddress };
}

async function main(): Promise<void> {
  const network = resolveNetwork();
  const port = resolvePort();
  const live = pickLiveWatch(network);
  const { store: memory, mode } = pickMemory(network);
  const demoCtx = { knownCounterparties: KNOWN_COUNTERPARTIES, knownFunctions: KNOWN_FUNCTIONS, watchAddress: DEMO_OWNER };
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const indexHtml = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const server = createServer(async (req, res) => {
    let stage = 'request';
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      stage = `${req.method ?? 'GET'} ${url.pathname}`.slice(0, 40).replace(/[^A-Za-z0-9 /]/g, '');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(indexHtml);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/demo') {
        const judgement = await judgeBatch(syntheticBatch(), demoCtx, memory);
        const count = await memory.count();
        sendJson(res, 200, {
          mode,
          network: network.name,
          memoryCount: count,
          activeFlags: judgement.activeFlags,
          suppressedFlags: judgement.suppressedFlags,
          escalatedFlags: judgement.escalatedFlags,
          decisions: judgement.decisions.map((d) => ({
            digest: d.tx.digest,
            amountSui: formatSui(d.tx.amountMist),
            functionName: d.tx.functionName,
            state: d.state,
            explanation: d.explanation,
            flags: d.flags.map((f) => ({ rule: f.rule, reason: f.reason, pattern: f.pattern })),
            memories: d.memories.map((m) => ({ text: m.text, blobId: m.blobId })),
          })),
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/verdict') {
        const parsed = VerdictBody.safeParse(await readJsonBody(req));
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid verdict. Need pattern (text), kind (expected or important), note (text).' });
          return;
        }
        const stored = await memory.rememberVerdict(parsed.data);
        sendJson(res, 200, { ok: true, blobId: stored.blobId, memoryCount: await memory.count() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        if (live === null) {
          sendJson(res, 200, { live: false, reason: 'Set TATUM_API_KEY and WATCH_ADDRESS for the live chain read. Demo data is shown instead.' });
          return;
        }
        const snapshot = await fetchChainState(live.clients.viaTatum, live.watchAddress);
        const digestParam = url.searchParams.get('digests') ?? '';
        const digests = digestParam.split(',').map((d) => d.trim()).filter((d) => /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(d)).slice(0, 10);
        const txs = digests.length > 0 ? await fetchTransactionsByDigest(live.clients.viaTatum, live.watchAddress, digests) : [];
        sendJson(res, 200, {
          live: true,
          network: network.name,
          chainIdentifier: snapshot.chainIdentifier,
          balanceMist: snapshot.balanceMist,
          transactions: txs.map((t) => ({ digest: t.digest, functionName: t.functionName, amountMist: t.amountMist.toString() })),
          note: 'Ongoing watching uses the poll model: take a cursor, then read new transactions after it. Pass ?digests=a,b to read known transactions. Run npm run live for the full round trip.',
        });
        return;
      }
      sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      const status = error instanceof RequestError ? 400 : error instanceof FixedError ? 502 : 500;
      sendJson(res, status, { error: failureText(error, stage) });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Recall Watchdog (${mode} memory, network ${network.name}) at http://127.0.0.1:${port}/\n`);
  });
}

installFixedCrashHandlers('server failed');
main().catch((error: unknown) => {
  process.stderr.write(`server failed: ${failureText(error, 'startup')}\n`);
  process.exit(1);
});
