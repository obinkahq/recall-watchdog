// Memory boundary. One interface, two builds:
// - LiveMemory: the Walrus Memory relayer through the official SDK.
// - DemoMemory: the SDK mock (in process, no network, no key).
// Both store the same verdict text shape, so demo and live judge the same way.
import { MemWal, MemWalMock } from '@mysten-incubation/memwal';
import type { RecalledVerdict, Verdict } from './types.js';

export interface MemoryStore {
  rememberVerdict(verdict: Verdict): Promise<{ blobId: string }>;
  recallVerdicts(query: string, limit: number): Promise<readonly RecalledVerdict[]>;
  count(): Promise<number>;
  healthStatus(): Promise<string>;
  close(): void;
}

export function verdictText(verdict: Verdict): string {
  return `watchdog verdict | pattern: ${verdict.pattern} | verdict: ${verdict.kind} | note: ${verdict.note}`;
}

// Parse a recalled memory back to a verdict. Returns null for other text.
export function parseVerdictText(text: string): Verdict | null {
  const match = text.match(/pattern:\s*([^|]+)\|\s*verdict:\s*(expected|important)\s*\|\s*note:\s*(.+)$/);
  if (match === null) return null;
  const [, pattern, kind, note] = match;
  if (pattern === undefined || note === undefined) return null;
  return { pattern: pattern.trim(), kind: kind as Verdict['kind'], note: note.trim() };
}

export function createDemoMemory(namespace: string): MemoryStore {
  const client = MemWalMock.create({ namespace });
  let stored = 0;
  return {
    async rememberVerdict(verdict: Verdict) {
      const result = await client.rememberAndWait(verdictText(verdict));
      stored += 1;
      return { blobId: result.blob_id };
    },
    async recallVerdicts(query: string, limit: number) {
      const result = await client.recall({ query, limit });
      return result.results.map((hit) => ({ text: hit.text, blobId: hit.blob_id, distance: hit.distance }));
    },
    async count() {
      const page = await client.listNamespaces({});
      const entry = page.namespaces.find((n) => n.name === namespace);
      return entry?.memory_count ?? stored;
    },
    async healthStatus() {
      const health = await client.health();
      return String((health as { status?: string }).status ?? 'ok');
    },
    close() {
      client.destroy();
    },
  };
}

export interface LiveMemoryConfig {
  readonly key: string;
  readonly accountId: string;
  readonly serverUrl: string;
  readonly namespace: string;
}

// MemWal.create decodes the key. Its error can repeat the key; the entry
// point boundary prints fixed text only (see errors.ts).
export function createLiveMemory(config: LiveMemoryConfig): MemoryStore {
  const client = MemWal.create({
    key: config.key,
    accountId: config.accountId,
    serverUrl: config.serverUrl,
    namespace: config.namespace,
  });
  return {
    async rememberVerdict(verdict: Verdict) {
      const result = await client.rememberAndWait(verdictText(verdict), { pollIntervalMs: 2_000, timeoutMs: 180_000 });
      return { blobId: result.blob_id };
    },
    async recallVerdicts(query: string, limit: number) {
      const result = await client.recall({ query, limit });
      return result.results.map((hit) => ({ text: hit.text, blobId: hit.blob_id, distance: hit.distance }));
    },
    async count() {
      let cursor: string | undefined;
      let total = 0;
      let more = true;
      while (more) {
        const page = await client.listMemories({ cursor, namespace: config.namespace });
        total += page.memories.length;
        more = page.has_more;
        cursor = page.next_cursor ?? undefined;
        if (more && cursor === undefined) break;
      }
      return total;
    },
    async healthStatus() {
      const health = await client.health();
      return String((health as { status?: string }).status ?? 'unknown');
    },
    close() {
      client.destroy();
    },
  };
}
