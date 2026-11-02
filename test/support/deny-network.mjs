// Test guard: every TCP or TLS connection to a host that is not the loopback
// host fails at once, and so does a DNS lookup of such a host. Tests load
// this with --import, so no test can reach Tatum, Sui, Walrus or any other
// outside endpoint, even when a code change (a mutant) would try to.
import dns from 'node:dns';
import net from 'node:net';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);

function blocked(kind) {
  process.stderr.write(`deny-network: blocked a ${kind} to a non-loopback host\n`);
  return new Error(`deny-network: ${kind} to a non-loopback host is blocked in tests`);
}

function hostOf(args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first !== null && typeof first === 'object') {
    if (typeof first.path === 'string') return null;
    return typeof first.host === 'string' ? first.host : 'localhost';
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return typeof args[1] === 'string' ? args[1] : 'localhost';
  }
  return null;
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const host = hostOf(args);
  if (host !== null && !LOOPBACK.has(host)) throw blocked('connection');
  return connect.apply(this, args);
};

const lookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, ...rest) {
  if (!LOOPBACK.has(hostname)) throw blocked('DNS lookup');
  return lookup.call(this, hostname, ...rest);
};
const promiseLookup = dns.promises.lookup;
dns.promises.lookup = async function guardedPromiseLookup(hostname, ...rest) {
  if (!LOOPBACK.has(hostname)) throw blocked('DNS lookup');
  return promiseLookup.call(this, hostname, ...rest);
};
