// One-time setup: create a Walrus Memory account for the owner wallet and
// register a delegate key. The delegate secret is written to a file with
// mode 600 outside the repository. Only the public key, the delegate Sui
// address, the account id, and the digests are printed. The owner key is
// decoded locally before any chain call. Errors print fixed text only: a
// sign or decode error can carry key text in its message.
import { chmodSync, writeFileSync } from 'node:fs';
import { addDelegateKey, createAccount, generateDelegateKey } from '@mysten-incubation/memwal/account';
import { requireSecret, resolveNetwork } from './config.js';
import { FixedError, failureText, installFixedCrashHandlers } from './errors.js';
import { parseSuiKeypair } from './keys.js';

// The step that runs now. The error boundary names it instead of printing
// a dependency message.
let stage = 'check settings and key';

async function main(): Promise<void> {
  const network = resolveNetwork();
  const suiPrivateKey = requireSecret('SUI_PRIVATE_KEY', 'Set SUI_PRIVATE_KEY or SUI_PRIVATE_KEY_FILE to the owner wallet key file.');
  parseSuiKeypair(suiPrivateKey, 'SUI_PRIVATE_KEY');
  const outPath = process.env.MEMWAL_DELEGATE_KEY_OUT?.trim();
  if (outPath === undefined || outPath === '') {
    throw new FixedError('Set MEMWAL_DELEGATE_KEY_OUT to a file path outside the repository (it will hold the delegate secret, mode 600).');
  }

  stage = 'create the Walrus Memory account';
  const account = await createAccount({ packageId: network.memwalPackageId, registryId: network.memwalRegistryId, suiPrivateKey, suiNetwork: network.name });
  process.stdout.write(`network=${network.name}\nowner=${account.owner}\naccountId=${account.accountId}\ncreateDigest=${account.digest}\n`);
  if (account.accountId === '') throw new FixedError('Account creation returned no account id. Read the digest on an explorer to find the created account object.');

  stage = 'generate the delegate key';
  const delegate = await generateDelegateKey();
  stage = 'register the delegate key';
  const added = await addDelegateKey({
    packageId: network.memwalPackageId,
    registryId: network.memwalRegistryId,
    accountId: account.accountId,
    publicKey: delegate.publicKey,
    label: 'recall-watchdog',
    suiPrivateKey,
    suiNetwork: network.name,
  });
  stage = 'write the delegate key file';
  writeFileSync(outPath, `${delegate.privateKey}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(outPath, 0o600);
  process.stdout.write(`delegateSuiAddress=${added.suiAddress}\naddKeyDigest=${added.digest}\ndelegateKeyFile=written (mode 600, value not printed)\n`);
  process.stdout.write('Next: set MEMWAL_KEY_FILE to that file and MEMWAL_ACCOUNT_ID to the account id above.\n');
}

installFixedCrashHandlers('setup-account failed');
main().catch((error: unknown) => {
  process.stderr.write(`setup-account failed: ${failureText(error, stage)}\n`);
  process.exit(1);
});
