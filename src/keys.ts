// Key parsing with fixed error text. A decode error from the SDK can repeat
// the input (a Bech32 checksum error does), so each parser catches it and
// throws a FixedError that names only the variable. Nothing here logs, and
// no error carries the key or a cause.
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { ADDRESS_PATTERN } from './config.js';
import { FixedError } from './errors.js';

const BECH32_PREFIX = 'suiprivkey1';
const HEX_KEY = /^(0x)?[0-9a-fA-F]{64}$/;
const MAX_KEY_LENGTH = 200;

function decodeEd25519(text: string, name: string): Uint8Array {
  if (text.length > MAX_KEY_LENGTH || !text.toLowerCase().startsWith(BECH32_PREFIX)) {
    throw new FixedError(`${name} must be a Sui Ed25519 private key in the suiprivkey1 (Bech32) form.`);
  }
  let parsed: { readonly scheme: string; readonly secretKey: Uint8Array };
  try {
    parsed = decodeSuiPrivateKey(text);
  } catch {
    throw new FixedError(`${name} is not a valid Sui private key (the Bech32 decode failed).`);
  }
  if (parsed.scheme !== 'ED25519') throw new FixedError(`${name} must be an Ed25519 key.`);
  return parsed.secretKey;
}

// Owner wallet key (suiprivkey1...). Returns the keypair; throws FixedError.
export function parseSuiKeypair(text: string, name: string): Ed25519Keypair {
  const secretKey = decodeEd25519(text, name);
  try {
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    throw new FixedError(`${name} is not a valid Ed25519 private key.`);
  }
}

// Walrus Memory delegate key: 64 hex characters (optional 0x) or the
// suiprivkey1 form. Returns the text unchanged for the SDK.
export function checkMemwalKey(text: string, name: string): string {
  if (HEX_KEY.test(text)) return text;
  if (text.toLowerCase().startsWith(BECH32_PREFIX)) {
    decodeEd25519(text, name);
    return text;
  }
  throw new FixedError(`${name} must be 64 hex characters (an Ed25519 delegate key) or a suiprivkey1 key.`);
}

// Account or object id: 0x + 64 hex. Returns the lower-case form.
export function checkObjectId(text: string, name: string): string {
  if (!ADDRESS_PATTERN.test(text)) throw new FixedError(`${name} must be 0x followed by 64 hex characters.`);
  return text.toLowerCase();
}
