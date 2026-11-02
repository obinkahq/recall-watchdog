// Web UI server. Node http only (no web framework). Binds to 127.0.0.1.
// Each request passes the request-origin guard first (request-guard.ts).
// Demo mode when WATCH_ADDRESS is absent. With WATCH_ADDRESS and the Tatum
// key set, /api/live returns a cursor page of new transactions for that
// address, judged with the rules and the recalled verdicts. A set but
// malformed WATCH_ADDRESS stops startup (no silent demo fallback). Every
// request is checked with zod. Error responses carry fixed text only.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { judgeBatch } from './decide.js';
import { createDemoMemory, createLiveMemory, type MemoryStore } from './memory.js';
import { createSuiClients, fetchChainState, type SuiClients } from './tatum.js';
import { readSecret, resolveMemwalServerUrl, resolveNamespace, resolveNetwork, resolveOptionalWatchAddress, resolvePort, type NetworkConfig } from './config.js';
import { FixedError, RequestError, failureText, installFixedCrashHandlers } from './errors.js';
import { checkMemwalKey, checkObjectId } from './keys.js';
import { checkTatumKey } from './live-settings.js';
import { DEMO_OWNER, KNOWN_COUNTERPARTIES, KNOWN_FUNCTIONS, syntheticBatch } from './synthetic.js';
import { decisionView, judgeNewTransactions } from './watch.js';
import { API_HEADERS, BODY_LIMIT_BYTES, LISTEN_HOST, TOO_LARGE, checkRequest, pageHeaders, type Refusal } from './request-guard.js';

const VerdictBody = z.object({
  pattern: z.string().min(1).max(120),
  kind: z.enum(['expected', 'important']),
  note: z.string().min(1).max(200),
});

// A Sui gRPC cursor is base64 text.
const LiveQuery = z.object({ after: z.string().regex(/^[A-Za-z0-9+/]{1,256}={0,2}$/).optional() });

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { ...API_HEADERS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

// A refused request: fixed text, and the connection closes, so an unread
// body is not taken in.
function sendRefusal(res: ServerResponse, refusal: Refusal): void {
  res.setHeader('connection', 'close');
  sendJson(res, refusal.status, { error: refusal.error });
}

class BodyTooLarge extends RequestError {}

// Reads at most BODY_LIMIT_BYTES, also when the body has no declared length.
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total <= BODY_LIMIT_BYTES) { chunks.push(chunk); return; }
      req.off('data', onData);
      req.pause();
      reject(new BodyTooLarge(TOO_LARGE.error));
    };
    req.on('data', onData);
    req.once('end', () => resolve(Buffer.concat(chunks)));
    req.once('error', () => reject(new RequestError('Request body could not be read.')));
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const text = (await readBody(req)).toString('utf8');
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
  if (key !== undefined || accountId !== undefined) {
    throw new FixedError('Set both MEMWAL_KEY and MEMWAL_ACCOUNT_ID for live memory, or neither for demo memory.');
  }
  return { store: createDemoMemory(namespace), mode: 'demo' };
}

interface LiveWatch {
  readonly clients: SuiClients;
  readonly watchAddress: string;
}

// Live chain mode is on when WATCH_ADDRESS is set. It then needs the key.
function pickLiveWatch(network: NetworkConfig): LiveWatch | null {
  const watchAddress = resolveOptionalWatchAddress();
  if (watchAddress === null) return null;
  const tatumKey = readSecret('TATUM_API_KEY');
  if (tatumKey === undefined) {
    throw new FixedError('WATCH_ADDRESS is set, so live mode needs TATUM_API_KEY or TATUM_API_KEY_FILE. Unset WATCH_ADDRESS for demo mode.');
  }
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
  const indexHeaders = pageHeaders(indexHtml);
  // The watch starts at the chain head of the first live request.
  let start: Promise<{ chainIdentifier: string; balanceMist: string; cursor: string }> | null = null;

  async function livePage(url: URL): Promise<unknown> {
    if (live === null) {
      return { live: false, reason: 'Demo mode: WATCH_ADDRESS is not set. Set WATCH_ADDRESS and TATUM_API_KEY to watch a live address.' };
    }
    const query = LiveQuery.safeParse({ after: url.searchParams.get('after') ?? undefined });
    if (!query.success) throw new RequestError('Invalid cursor. Pass the nextCursor value from the last page.');
    if (start === null) {
      start = fetchChainState(live.clients.viaTatum, live.watchAddress);
      start.catch(() => { start = null; });
    }
    const head = await start;
    const after = query.data.after ?? head.cursor;
    const page = await judgeNewTransactions(live.clients.viaTatum, live.watchAddress, after, memory);
    return {
      live: true,
      network: network.name,
      watchAddress: live.watchAddress,
      chainIdentifier: head.chainIdentifier,
      balanceMist: head.balanceMist,
      startCursor: head.cursor,
      afterCursor: page.afterCursor,
      nextCursor: page.nextCursor,
      activeFlags: page.judgement.activeFlags,
      suppressedFlags: page.judgement.suppressedFlags,
      escalatedFlags: page.judgement.escalatedFlags,
      decisions: page.judgement.decisions.map(decisionView),
    };
  }

  const server = createServer(async (req, res) => {
    let stage = 'request';
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      stage = `${req.method ?? 'GET'} ${url.pathname}`.slice(0, 40).replace(/[^A-Za-z0-9 /]/g, '');
      const refusal = checkRequest(req.method ?? '', req.headersDistinct, port);
      if (refusal !== null) {
        sendRefusal(res, refusal);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { ...indexHeaders, 'content-type': 'text/html; charset=utf-8' });
        res.end(indexHtml);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/demo') {
        const judgement = await judgeBatch(syntheticBatch(), demoCtx, memory);
        const count = await memory.count();
        sendJson(res, 200, {
          mode,
          network: network.name,
          liveWatch: live !== null,
          memoryCount: count,
          activeFlags: judgement.activeFlags,
          suppressedFlags: judgement.suppressedFlags,
          escalatedFlags: judgement.escalatedFlags,
          decisions: judgement.decisions.map(decisionView),
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
      if (req.method === 'GET' && url.pathname === '/api/live') {
        sendJson(res, 200, await livePage(url));
        return;
      }
      sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        sendRefusal(res, TOO_LARGE);
        return;
      }
      const status = error instanceof RequestError ? 400 : error instanceof FixedError ? 502 : 500;
      sendJson(res, status, { error: failureText(error, stage) });
    }
  });

  server.listen(port, LISTEN_HOST, () => {
    const watch = live === null ? 'demo chain data' : 'live watch on';
    process.stdout.write(`Recall Watchdog (${mode} memory, ${watch}, network ${network.name}) at http://${LISTEN_HOST}:${port}/\n`);
  });
}

installFixedCrashHandlers('server failed');
main().catch((error: unknown) => {
  process.stderr.write(`server failed: ${failureText(error, 'startup')}\n`);
  process.exit(1);
});
