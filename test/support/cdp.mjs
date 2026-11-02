// Minimal Chrome DevTools Protocol client over the WebSocket of Node 22+.
import { spawn } from 'node:child_process';
import path from 'node:path';

export async function launchChromium(tmp) {
  const bin = process.env.CHROMIUM_BIN ?? 'chromium';
  const child = spawn(bin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-default-apps', '--remote-debugging-port=0',
    `--user-data-dir=${path.join(tmp, 'profile')}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chromium did not start')), 30_000);
    child.stderr.on('data', (b) => {
      err += b.toString();
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('chromium exited')); });
  });
  return { wsUrl, stop: () => child.kill('SIGTERM') };
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const wait = pending.get(msg.id);
    if (wait === undefined) return;
    pending.delete(msg.id);
    if (msg.error) wait.reject(new Error(msg.error.message));
    else wait.resolve(msg.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return {
    send,
    close: () => ws.close(),
    async openPage(url) {
      const { targetId } = await send('Target.createTarget', { url });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const evaluate = async (expression) => {
        const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (out.exceptionDetails) throw new Error('page script error');
        return out.result.value;
      };
      const waitFor = async (expression, label, ms = 15_000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (await evaluate(expression)) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`timed out: ${label}`);
      };
      return { evaluate, waitFor };
    },
  };
}
