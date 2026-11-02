// One-time setup: create a Walrus Memory account for the owner wallet and
// register a delegate key. The delegate secret is written to a file with
// mode 600 outside the repository. Only the public key, the delegate Sui
// address, the account id, and the digests are printed.
import { chmodSync, writeFileSync } from 'node:fs';
import { addDelegateKey, createAccount, generateDelegateKey } from '@mysten-incubation/memwal/account';
import { requireSecret, resolveNetwork } from './config.js';

async function main(): Promise<void> {
  const network = resolveNetwork();
  const suiPrivateKey = requireSecret('SUI_PRIVATE_KEY', 'Set SUI_PRIVATE_KEY or SUI_PRIVATE_KEY_FILE to the owner wallet key file.');
  const outPath = process.env.MEMWAL_DELEGATE_KEY_OUT?.trim();
  if (outPath === undefined || outPath === '') {
    throw new Error('Set MEMWAL_DELEGATE_KEY_OUT to a file path outside the repository (it will hold the delegate secret, mode 600).');
  }

  const account = await createAccount({
    packageId: network.memwalPackageId,
    registryId: network.memwalRegistryId,
    suiPrivateKey,
    suiNetwork: network.name,
  });
  process.stdout.write(`network=${network.name}\nowner=${account.owner}\naccountId=${account.accountId}\ncreateDigest=${account.digest}\n`);
  if (account.accountId === '') throw new Error('Account creation returned no account id. Read the digest on an explorer to find the created account object.');

  const delegate = await generateDelegateKey();
  const added = await addDelegateKey({
    packageId: network.memwalPackageId,
    registryId: network.memwalRegistryId,
    accountId: account.accountId,
    publicKey: delegate.publicKey,
    label: 'recall-watchdog',
    suiPrivateKey,
    suiNetwork: network.name,
  });
  writeFileSync(outPath, `${delegate.privateKey}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(outPath, 0o600);
  process.stdout.write(`delegateSuiAddress=${added.suiAddress}\naddKeyDigest=${added.digest}\ndelegateKeyFile=written (mode 600, value not printed)\n`);
  process.stdout.write('Next: set MEMWAL_KEY_FILE to that file and MEMWAL_ACCOUNT_ID to the account id above.\n');
}

main().catch((error: unknown) => {
  // Fixed shape only: a sign or decode error can carry key text in its message.
  const code = (error as { code?: unknown })?.code;
  process.stderr.write(`setup-account failed (${typeof code === 'string' ? code : 'see message'}): ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}\n`);
  process.exit(1);
});
