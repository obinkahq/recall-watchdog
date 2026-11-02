// Live settings. Every value and every key is read and checked here, before
// any network call, and each check throws fixed text only (see errors.ts).
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  readSecret, requireSecret, resolveMemwalServerUrl, resolveNamespace, resolveNetwork, resolveWatchAddress, type NetworkConfig,
} from './config.js';
import { FixedError } from './errors.js';
import { checkMemwalKey, checkObjectId, parseSuiKeypair } from './keys.js';

export interface LiveSettings {
  readonly network: NetworkConfig;
  readonly watchAddress: string;
  readonly namespace: string;
  readonly serverUrl: string;
  readonly tatumKey: string;
  readonly memwalKey: string;
  readonly accountId: string;
  readonly suiKeypair: Ed25519Keypair | null;
}

// One line of printable ASCII without spaces. gRPC metadata rejects other
// text, and its error repeats the value, so the check runs first.
const TATUM_KEY_PATTERN = /^[\x21-\x7e]{8,200}$/;

export function checkTatumKey(text: string): string {
  if (!TATUM_KEY_PATTERN.test(text)) {
    throw new FixedError('TATUM_API_KEY must be one line of 8 to 200 printable characters without spaces.');
  }
  return text;
}

export function readLiveSettings(): LiveSettings {
  const network = resolveNetwork();
  const watchAddress = resolveWatchAddress();
  const namespace = resolveNamespace();
  const tatumKey = checkTatumKey(requireSecret('TATUM_API_KEY', 'Set TATUM_API_KEY or TATUM_API_KEY_FILE.'));
  const memwalKey = checkMemwalKey(
    requireSecret('MEMWAL_KEY', 'Set MEMWAL_KEY or MEMWAL_KEY_FILE (see npm run setup-account).'),
    'MEMWAL_KEY',
  );
  const accountId = checkObjectId(
    requireSecret('MEMWAL_ACCOUNT_ID', 'Set MEMWAL_ACCOUNT_ID or MEMWAL_ACCOUNT_ID_FILE (see npm run setup-account).'),
    'MEMWAL_ACCOUNT_ID',
  );
  const suiKeyText = readSecret('SUI_PRIVATE_KEY');
  const suiKeypair = suiKeyText === undefined ? null : parseSuiKeypair(suiKeyText, 'SUI_PRIVATE_KEY');
  if (suiKeypair !== null && suiKeypair.toSuiAddress().toLowerCase() !== watchAddress) {
    throw new FixedError('SUI_PRIVATE_KEY does not match WATCH_ADDRESS');
  }
  return { network, watchAddress, namespace, serverUrl: resolveMemwalServerUrl(network), tatumKey, memwalKey, accountId, suiKeypair };
}
