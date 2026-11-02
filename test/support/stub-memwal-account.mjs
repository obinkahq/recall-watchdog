// Stub for @mysten-incubation/memwal/account: the chain calls of setup.
// Each call is recorded, so a test can count chain calls (zero when the
// output path is bad). The fake delegate key comes from STUB_DELEGATE_KEY.
import { statSync } from 'node:fs';
import { maybeFail, record } from './stub-common.mjs';

// When STUB_CHECK_FILE is set, each chain call records the state of that
// file at the moment of the call (exists, mode, size).
function checkFile() {
  const file = process.env.STUB_CHECK_FILE;
  if (!file) return undefined;
  try {
    const stat = statSync(file);
    return { exists: true, mode: (stat.mode & 0o777).toString(8), size: stat.size };
  } catch {
    return { exists: false };
  }
}

const hex = (pair) => `0x${pair.repeat(32)}`;

export async function createAccount(opts) {
  record({ module: 'account', method: 'createAccount', network: opts.suiNetwork, checkFile: checkFile() });
  maybeFail('createAccount', opts.suiPrivateKey);
  return { accountId: hex('ac'), owner: hex('0e'), digest: 'StubCreateDigest' };
}

export async function generateDelegateKey() {
  record({ module: 'account', method: 'generateDelegateKey' });
  maybeFail('generateDelegateKey', 'none');
  return { privateKey: process.env.STUB_DELEGATE_KEY ?? 'stub-delegate-key', publicKey: new Uint8Array(32), suiAddress: hex('dd') };
}

export async function addDelegateKey(opts) {
  record({ module: 'account', method: 'addDelegateKey', network: opts.suiNetwork, checkFile: checkFile() });
  maybeFail('addDelegateKey', opts.suiPrivateKey);
  return { suiAddress: hex('dd'), digest: 'StubAddDigest' };
}
