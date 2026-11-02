// Request-origin guard for the local web server. A web page that the owner
// opens in the same browser can send requests to 127.0.0.1. Without this
// guard such a page could store a verdict (a text/plain POST needs no CORS
// preflight) or, through DNS rebinding, read the live page. Rules:
// - Every request: the Host header is this server's own local address
//   (127.0.0.1:PORT or localhost:PORT), and an Origin header, when sent, is
//   the origin of that same address. 'null' and other origins are refused.
// - Every request except a load of the page itself: when the browser marks
//   it as from another site or another origin (Sec-Fetch-Site), it is
//   refused. An image or script tag on another site sends no Origin header,
//   and such a GET would make the server call Tatum or the memory relayer.
// - Every method other than GET and HEAD: the body is application/json
//   (the only parameter allowed is charset=utf-8), so a cross-site request
//   needs a preflight, and the server answers no preflight with allow
//   headers. A declared body above the limit is refused before it is read.
// The server never sends an Access-Control-* header.
import { createHash } from 'node:crypto';
import { FixedError } from './errors.js';

export const LISTEN_HOST = '127.0.0.1';
export const BODY_LIMIT_BYTES = 16_384;

const LOCAL_NAMES: readonly string[] = [LISTEN_HOST, 'localhost'];
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);
const OWN_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none']);

export interface Refusal {
  readonly status: 403 | 413 | 415;
  readonly error: string;
}

const HOST_REFUSED: Refusal = { status: 403, error: 'Refused: this server answers only requests for its own local address.' };
const ORIGIN_REFUSED: Refusal = { status: 403, error: 'Refused: requests from another origin are not allowed.' };
const SITE_REFUSED: Refusal = { status: 403, error: 'Refused: the browser marks this request as from another site or origin.' };
const TYPE_REFUSED: Refusal = { status: 415, error: 'Refused: send the request body as Content-Type application/json.' };
export const TOO_LARGE: Refusal = { status: 413, error: 'Request body is too large.' };

export type HeaderLists = Readonly<Record<string, readonly string[] | undefined>>;

// The value of a header that is sent exactly once, else null.
function onlyValue(headers: HeaderLists, name: string): string | null {
  const values = headers[name];
  return values !== undefined && values.length === 1 ? (values[0] as string) : null;
}

// Host header forms of this server. A browser leaves out port 80.
function hostForms(port: number): readonly string[] {
  return LOCAL_NAMES.flatMap((name) => (port === 80 ? [name, `${name}:80`] : [`${name}:${port}`]));
}

function originOf(host: string, port: number): string {
  const name = host.split(':')[0] as string;
  return port === 80 ? `http://${name}` : `http://${name}:${port}`;
}

function isJsonType(value: string): boolean {
  const [essence, ...params] = value.split(';').map((part) => part.trim().toLowerCase());
  return essence === 'application/json' && params.length <= 1 && params.every((param) => param === 'charset=utf-8');
}

function declaredTooLarge(headers: HeaderLists): boolean {
  const length = headers['content-length'];
  if (length === undefined) return false;
  const value = onlyValue(headers, 'content-length');
  return value === null || !/^\d{1,9}$/.test(value) || Number(value) > BODY_LIMIT_BYTES;
}

// A load of the page itself may come from a link on another site.
function isPageLoad(method: string, pathname: string): boolean {
  return READ_METHODS.has(method) && pathname === '/';
}

// Null when the request may go on to the routes, else the refusal to send.
// headers: the request headers as lists (IncomingMessage.headersDistinct).
export function checkRequest(method: string, pathname: string, headers: HeaderLists, port: number): Refusal | null {
  const host = onlyValue(headers, 'host')?.toLowerCase() ?? null;
  if (host === null || !hostForms(port).includes(host)) return HOST_REFUSED;
  const origins = headers.origin;
  if (origins !== undefined && (origins.length !== 1 || origins[0] !== originOf(host, port))) return ORIGIN_REFUSED;
  const sites = headers['sec-fetch-site'];
  if (sites !== undefined && !isPageLoad(method, pathname) && (sites.length !== 1 || !OWN_FETCH_SITES.has(sites[0] as string))) return SITE_REFUSED;
  if (READ_METHODS.has(method)) return null;
  const type = onlyValue(headers, 'content-type');
  if (type === null || !isJsonType(type)) return TYPE_REFUSED;
  if (declaredTooLarge(headers)) return TOO_LARGE;
  return null;
}

// Headers for every response: no framing (a framed page could be clicked
// by another site), no type sniffing, and a content policy.
export const API_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
};

function inlineHash(html: string, tag: 'script' | 'style'): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(html);
  if (match === null) throw new FixedError(`public/index.html has no inline ${tag} block.`);
  return `'sha256-${createHash('sha256').update(match[1] as string, 'utf8').digest('base64')}'`;
}

// Page headers: only the page's own inline script and style run, and the
// page connects only to its own origin.
export function pageHeaders(html: string): Readonly<Record<string, string>> {
  const policy = [
    "default-src 'none'",
    `script-src ${inlineHash(html, 'script')}`,
    `style-src ${inlineHash(html, 'style')}`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return { ...API_HEADERS, 'content-security-policy': policy };
}
