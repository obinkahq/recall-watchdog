// The network guard is loaded in every test process (npm test passes
// --import ./test/support/deny-network.mjs), so no test can reach an
// outside endpoint. This checks the guard without opening a connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dns from 'node:dns';

test('guard: outside connections and lookups are blocked in tests', async () => {
  assert.equal(net.Socket.prototype.connect.name, 'guardedConnect');
  assert.throws(() => new net.Socket().connect(443, 'sui-testnet-grpc.gateway.tatum.io'), /deny-network/);
  await assert.rejects(dns.promises.lookup('relayer.dev.memwal.ai'), /deny-network/);
});
