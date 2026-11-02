// One-time setup: create a Walrus Memory account for the owner wallet and
// register a delegate key. Order of work:
// 1. Check the network, the owner key (local decode, no network) and the
//    output path; reserve the output file (mode 600, outside the repository).
// 2. Create the account. 3. Generate the delegate key and write it to the
//    reserved file. 4. Register the delegate key on chain.
// The secret is on disk before the chain registration, so a failed or lost
// run never loses a registered key. Only the public key, the delegate Sui
// address, the account id and the digests are printed. Errors print fixed
// text only: a sign or decode error can carry key text in its message.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDelegateKey, createAccount, generateDelegateKey } from '@mysten-incubation/memwal/account';
import { requireSecret, resolveNetwork } from './config.js';
import { FixedError, failureText, installFixedCrashHandlers } from './errors.js';
import { reserveKeyFile } from './key-file.js';
import { parseSuiKeypair } from './keys.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The step that runs now. The error boundary names it instead of printing
// a dependency message.
let stage = 'check settings, key and output path';

async function main(): Promise<void> {
  const network = resolveNetwork();
  const suiPrivateKey = requireSecret('SUI_PRIVATE_KEY', 'Set SUI_PRIVATE_KEY or SUI_PRIVATE_KEY_FILE to the owner wallet key file.');
  parseSuiKeypair(suiPrivateKey, 'SUI_PRIVATE_KEY');
  const reserved = reserveKeyFile(process.env.MEMWAL_DELEGATE_KEY_OUT, REPO_ROOT);
  try {
    stage = 'create the Walrus Memory account';
    const account = await createAccount({ packageId: network.memwalPackageId, registryId: network.memwalRegistryId, suiPrivateKey, suiNetwork: network.name });
    process.stdout.write(`network=${network.name}\nowner=${account.owner}\naccountId=${account.accountId}\ncreateDigest=${account.digest}\n`);
    if (account.accountId === '') throw new FixedError('Account creation returned no account id. Read the digest on an explorer to find the created account object.');

    stage = 'generate the delegate key';
    const delegate = await generateDelegateKey();
    reserved.write(`${delegate.privateKey}\n`);
    process.stdout.write('delegateKeyFile=written (mode 600, value not printed)\n');
    stage = 'register the delegate key (the key file holds a key that may not be registered)';
    const added = await addDelegateKey({
      packageId: network.memwalPackageId,
      registryId: network.memwalRegistryId,
      accountId: account.accountId,
      publicKey: delegate.publicKey,
      label: 'recall-watchdog',
      suiPrivateKey,
      suiNetwork: network.name,
    });
    process.stdout.write(`delegateSuiAddress=${added.suiAddress}\naddKeyDigest=${added.digest}\n`);
    process.stdout.write('Next: set MEMWAL_KEY_FILE to that file and MEMWAL_ACCOUNT_ID to the account id above.\n');
  } catch (error) {
    reserved.discardIfEmpty();
    throw error;
  } finally {
    reserved.close();
  }
}

installFixedCrashHandlers('setup-account failed');
main().catch((error: unknown) => {
  process.stderr.write(`setup-account failed: ${failureText(error, stage)}\n`);
  process.exit(1);
});
