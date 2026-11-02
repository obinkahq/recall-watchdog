// Finding F7: a web page in the owner's browser must not store a verdict
// or read the local server through DNS rebinding. Raw HTTP requests against
// the real server build (live memory stub: each memory write is one
// rememberAndWait line in the stub log). Oracle: the guard rules written in
// the review (Host, Origin, Content-Type), not the server's own answers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { REPO, startServer } from './support/harness.mjs';
import { rawRequest } from './support/raw-http.mjs';
import { fakeAccountId, fakeMemwalKey } from './support/fixtures.mjs';
import { BODY_LIMIT_BYTES, checkRequest } from '../dist/request-guard.js';

const server = await startServer({ MEMWAL_KEY: fakeMemwalKey(), MEMWAL_ACCOUNT_ID: fakeAccountId() });
after(() => server.stop());
const port = server.port;
const OWN = `127.0.0.1:${port}`;
const OWN_ORIGIN = `http://${OWN}`;
const EVIL = 'http://evil.example';
const VERDICT = JSON.stringify({ pattern: 'guard probe', kind: 'expected', note: 'set by a probe' });
const FORM = 'pattern=guard+probe&kind=expected&note=x';

const writes = () => server.calls().filter((c) => c.method === 'rememberAndWait').length;
const corsHeaders = (res) => Object.keys(res.headers).filter((name) => name.startsWith('access-control-'));
const headers = (host, origin, type) => [['Host', host], ...(origin ? [['Origin', origin]] : []), ...(type ? [['Content-Type', type]] : [])];

async function send(request) {
  const before = writes();
  const res = await rawRequest(port, { method: 'POST', path: '/api/verdict', body: VERDICT, ...request });
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { res, written: writes() - before };
}

test('guard: cross-site, rebinding and non-JSON writes are refused and store nothing', async () => {
  assert.equal(server.state, 'ready', server.output());
  const cases = [
    ['cross-site form POST', headers(OWN, EVIL, 'application/x-www-form-urlencoded'), FORM, 403],
    ['cross-site multipart POST', headers(OWN, EVIL, 'multipart/form-data; boundary=b'), '--b--\r\n', 403],
    ['cross-site text/plain fetch', headers(OWN, EVIL, 'text/plain;charset=UTF-8'), VERDICT, 403],
    ['foreign Origin with JSON', headers(OWN, EVIL, 'application/json'), VERDICT, 403],
    ['Origin null with JSON', headers(OWN, 'null', 'application/json'), VERDICT, 403],
    ['Origin of the other local name', headers(`localhost:${port}`, OWN_ORIGIN, 'application/json'), VERDICT, 403],
    ['Origin with a path', headers(OWN, `${OWN_ORIGIN}/`, 'application/json'), VERDICT, 403],
    ['https Origin', headers(OWN, `https://${OWN}`, 'application/json'), VERDICT, 403],
    ['Origin with a suffix', headers(OWN, `${OWN_ORIGIN}.evil.example`, 'application/json'), VERDICT, 403],
    ['rebinding Host', headers(`rebind.evil.example:${port}`, null, 'application/json'), VERDICT, 403],
    ['rebinding Host with its own Origin', headers(`rebind.evil.example:${port}`, `http://rebind.evil.example:${port}`, 'application/json'), VERDICT, 403],
    ['Host with another port', headers(`127.0.0.1:${port + 1}`, null, 'application/json'), VERDICT, 403],
    ['Host without a port', headers('localhost', null, 'application/json'), VERDICT, 403],
    ['two Host headers', [['Host', OWN], ['Host', 'evil.example'], ['Content-Type', 'application/json']], VERDICT, 403],
    ['two Origin headers', [['Host', OWN], ['Origin', OWN_ORIGIN], ['Origin', EVIL], ['Content-Type', 'application/json']], VERDICT, 403],
    ['text/plain, same Origin', headers(OWN, OWN_ORIGIN, 'text/plain'), VERDICT, 415],
    ['text/plain, no Origin', headers(OWN, null, 'text/plain'), VERDICT, 415],
    ['form type, no Origin', headers(OWN, null, 'application/x-www-form-urlencoded'), FORM, 415],
    ['multipart, same Origin', headers(OWN, OWN_ORIGIN, 'multipart/form-data; boundary=b'), '--b--\r\n', 415],
    ['no Content-Type, same Origin', headers(OWN, OWN_ORIGIN, null), VERDICT, 415],
    ['two Content-Type headers', [['Host', OWN], ['Content-Type', 'application/json'], ['Content-Type', 'text/plain']], VERDICT, 415],
    ['combined type list', headers(OWN, null, 'text/plain, application/json'), VERDICT, 415],
    ['JSON as a parameter', headers(OWN, null, 'text/plain; application/json'), VERDICT, 415],
    ['other charset', headers(OWN, null, 'application/json; charset=latin1'), VERDICT, 415],
    ['upper-case names, foreign Origin', [['HOST', OWN], ['ORIGIN', EVIL], ['CONTENT-TYPE', 'application/json']], VERDICT, 403],
    ['upper-case names, rebinding Host', [['HOST', `REBIND.EVIL.EXAMPLE:${port}`], ['CONTENT-TYPE', 'application/json']], VERDICT, 403],
    ['lower-case names, text/plain', [['host', OWN], ['content-type', 'text/plain']], VERDICT, 415],
  ];
  for (const [label, sent, body, status] of cases) {
    const { res, written } = await send({ headers: sent, body });
    assert.equal(res.status, status, `${label}: ${res.body}`);
    assert.equal(written, 0, `${label}: no memory write`);
    assert.match(JSON.parse(res.body).error, /^Refused: /, label);
    assert.deepEqual(corsHeaders(res), [], `${label}: no CORS header`);
  }
  const noHost = await send({ headers: [['Content-Type', 'application/json']], http10: true });
  assert.equal(noHost.res.status, 403, 'a request without a Host header');
  assert.equal(noHost.written, 0);
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    assert.equal((await send({ method, headers: headers(OWN, EVIL, 'application/json') })).res.status, 403, `${method} cross-site`);
    assert.equal((await send({ method, headers: headers(OWN, null, 'text/plain') })).res.status, 415, `${method} text/plain`);
  }
  const demo = await rawRequest(port, { path: '/api/demo', headers: [['Host', OWN]] });
  assert.equal(JSON.parse(demo.body).memoryCount, 0, 'memory is still empty');
});

test('guard: same-origin and local JSON requests still store a verdict', async () => {
  const cases = [
    ['page fetch from 127.0.0.1', headers(OWN, OWN_ORIGIN, 'application/json')],
    ['page fetch from localhost', headers(`localhost:${port}`, `http://localhost:${port}`, 'application/json')],
    ['local client without Origin', headers(OWN, null, 'application/json')],
    ['upper-case header names', [['HOST', OWN], ['ORIGIN', OWN_ORIGIN], ['CONTENT-TYPE', 'application/json']]],
    ['lower-case header names', [['host', OWN], ['origin', OWN_ORIGIN], ['content-type', 'application/json']]],
    ['case of the values, charset', [['Host', `LOCALHOST:${port}`], ['Content-Type', 'Application/JSON; Charset=UTF-8']]],
  ];
  for (const [label, sent] of cases) {
    const { res, written } = await send({ headers: sent });
    assert.equal(res.status, 200, `${label}: ${res.body}`);
    assert.equal(written, 1, `${label}: one memory write`);
    assert.deepEqual(corsHeaders(res), [], label);
  }
});

test('guard: a rebinding Host or a foreign Origin reads no route; the page can read', async () => {
  for (const route of ['/', '/api/demo', '/api/live']) {
    const rebind = await rawRequest(port, { path: route, headers: [['Host', `rebind.evil.example:${port}`]] });
    assert.equal(rebind.status, 403, `rebinding ${route}`);
    assert.ok(!rebind.body.includes('decisions') && !rebind.body.includes('<script'), `rebinding ${route}: no data`);
    const foreign = await rawRequest(port, { path: route, headers: [['Host', OWN], ['Origin', EVIL]] });
    assert.equal(foreign.status, 403, `foreign Origin ${route}`);
    const own = await rawRequest(port, { path: route, headers: [['Host', OWN]] });
    assert.equal(own.status, 200, `own ${route}`);
    assert.deepEqual(corsHeaders(own), [], route);
  }
  const withOrigin = await rawRequest(port, { path: '/api/demo', headers: [['Host', OWN], ['Origin', OWN_ORIGIN]] });
  assert.equal(withOrigin.status, 200);
});

test('guard: a preflight gets no allow headers', async () => {
  const preflight = (origin) => rawRequest(port, {
    method: 'OPTIONS', path: '/api/verdict',
    headers: [['Host', OWN], ['Origin', origin], ['Access-Control-Request-Method', 'POST'], ['Access-Control-Request-Headers', 'content-type']],
  });
  const foreign = await preflight(EVIL);
  assert.equal(foreign.status, 403);
  assert.deepEqual(corsHeaders(foreign), []);
  const own = await preflight(OWN_ORIGIN);
  assert.equal(own.status, 415);
  assert.deepEqual(corsHeaders(own), []);
});

test('guard: no framing, no sniffing, and a page policy with the inline hashes', async () => {
  const html = readFileSync(path.join(REPO, 'public', 'index.html'), 'utf8');
  const hash = (tag) => `'sha256-${createHash('sha256').update(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(html)[1]).digest('base64')}'`;
  for (const route of ['/', '/api/demo', '/api/nothing']) {
    const res = await rawRequest(port, { path: route, headers: [['Host', OWN]] });
    assert.equal(res.headers['x-frame-options'], 'DENY', route);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', route);
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/, route);
  }
  const page = await rawRequest(port, { path: '/', headers: [['Host', OWN]] });
  const policy = page.headers['content-security-policy'];
  assert.ok(policy.includes(`script-src ${hash('script')}`) && policy.includes(`style-src ${hash('style')}`), policy);
  assert.ok(policy.includes("default-src 'none'") && policy.includes("connect-src 'self'") && !policy.includes('unsafe'), policy);
  const refused = await rawRequest(port, { path: '/', headers: [['Host', 'evil.example']] });
  assert.equal(refused.headers['x-frame-options'], 'DENY', 'refusals too');
});

// Streams a chunked body of up to `limit` bytes with back pressure, until
// the server closes the connection. Returns how much the client sent.
function streamBody(limit) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let received = '';
    let sent = 0;
    let settled = false;
    const done = (how) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ how, sent, status: Number(received.split(' ')[1] ?? 0) });
    };
    socket.on('data', (chunk) => { received += chunk.toString('latin1'); });
    socket.on('error', (error) => done(error.code ?? 'error'));
    socket.on('close', () => done('closed'));
    socket.on('connect', () => {
      socket.write(`POST /api/verdict HTTP/1.1\r\nHost: ${OWN}\r\nOrigin: ${OWN_ORIGIN}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n`);
      const chunk = `2000\r\n${'x'.repeat(8192)}\r\n`;
      const pump = () => {
        while (sent < limit && !settled) {
          sent += 8192;
          if (!socket.write(chunk)) { socket.once('drain', pump); return; }
        }
        if (!settled) socket.end('0\r\n\r\n');
      };
      pump();
    });
  });
}

test('guard: a huge body is refused, not read to the end, and not stored', async () => {
  const declared = await send({ headers: headers(OWN, OWN_ORIGIN, 'application/json'), declaredLength: 100 * 1024 * 1024, body: '' });
  assert.equal(declared.res.status, 413, 'a declared length above the limit');
  assert.equal(declared.res.headers.connection, 'close');
  assert.equal(declared.written, 0);
  const before = writes();
  const limit = 64 * 1024 * 1024;
  const streamed = await streamBody(limit);
  assert.ok(streamed.sent < limit / 2, `the server stopped the upload (client sent ${streamed.sent} bytes)`);
  assert.ok(streamed.status === 413 || streamed.status === 0, `413 or a closed connection, got ${streamed.status}`);
  assert.equal(writes() - before, 0);
  const near = await send({ headers: headers(OWN, null, 'application/json'), body: JSON.stringify({ pattern: 'p', kind: 'expected', note: 'n'.repeat(BODY_LIMIT_BYTES - 60) }) });
  assert.equal(near.res.status, 400, 'a body under the limit is read and checked');
  assert.equal(server.exitCode(), null, 'the server still runs');
  assert.equal((await rawRequest(port, { path: '/api/demo', headers: [['Host', OWN]] })).status, 200, 'and still answers');
});

test('guard: the server listens on 127.0.0.1 only', { skip: process.platform !== 'linux' && 'needs /proc/net' }, () => {
  const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
  const listening = ['tcp', 'tcp6'].flatMap((file) => readFileSync(`/proc/net/${file}`, 'utf8').trim().split('\n').slice(1)
    .map((line) => line.trim().split(/\s+/)).filter((cols) => cols[1].endsWith(`:${hexPort}`) && cols[3] === '0A').map((cols) => `${file} ${cols[1]}`));
  assert.deepEqual(listening, [`tcp 0100007F:${hexPort}`]);
});

test('guard rules in process: port 80 forms, types and declared length', () => {
  const lists = (pairs) => Object.fromEntries(pairs.map(([name, value]) => [name, [value]]));
  assert.equal(checkRequest('GET', lists([['host', '127.0.0.1']]), 80), null);
  assert.equal(checkRequest('POST', lists([['host', 'localhost'], ['origin', 'http://localhost'], ['content-type', 'application/json']]), 80), null);
  assert.equal(checkRequest('POST', lists([['host', 'localhost'], ['origin', 'http://localhost:80'], ['content-type', 'application/json']]), 80)?.status, 403);
  assert.equal(checkRequest('GET', lists([['host', '127.0.0.1:4173']]), 4173), null);
  assert.equal(checkRequest('HEAD', lists([['host', '127.0.0.1:4173']]), 4173), null);
  const post = (extra) => checkRequest('POST', lists([['host', '127.0.0.1:4173'], ['content-type', 'application/json'], ...extra]), 4173)?.status ?? 200;
  assert.equal(post([]), 200);
  assert.equal(post([['content-length', String(BODY_LIMIT_BYTES)]]), 200);
  assert.equal(post([['content-length', String(BODY_LIMIT_BYTES + 1)]]), 413);
  assert.equal(checkRequest('POST', { host: ['127.0.0.1:4173'], 'content-type': ['application/json'], 'content-length': ['5', '5'] }, 4173)?.status, 413);
  assert.equal(checkRequest('OPTIONS', lists([['host', '127.0.0.1:4173']]), 4173)?.status, 415);
});
