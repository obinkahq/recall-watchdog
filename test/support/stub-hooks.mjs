// Load with: node --import ./test/support/stub-hooks.mjs dist/<entry>.js
// Replaces the third-party SDK modules at the network edge with local stubs
// (the app code itself is the real build), and blocks outside network use.
import { registerHooks } from 'node:module';
import './deny-network.mjs';

const here = (name) => new URL(name, import.meta.url).href;
const STUBS = {
  '@mysten/sui/grpc': here('./stub-sui-grpc.mjs'),
  '@protobuf-ts/grpc-transport': here('./stub-grpc-transport.mjs'),
  '@mysten-incubation/memwal': here('./stub-memwal.mjs'),
  '@mysten-incubation/memwal/account': here('./stub-memwal-account.mjs'),
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = STUBS[specifier];
    const fromStub = context.parentURL !== undefined && context.parentURL.includes('/test/support/');
    if (target !== undefined && !fromStub) return { url: target, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
