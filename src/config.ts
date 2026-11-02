// Configuration. No secret is hard coded. Each secret is read from the
// environment or from a file path that an environment variable names.
// This file never prints a secret value.
import { readFileSync } from 'node:fs';
import { FixedError } from './errors.js';

export type NetworkName = 'testnet' | 'mainnet';

export interface NetworkConfig {
  readonly name: NetworkName;
  readonly memwalServerUrl: string;
  readonly memwalPackageId: string;
  readonly memwalRegistryId: string;
  readonly tatumGrpcHost: string;
  readonly tatumJsonRpcUrl: string | null;
  readonly publicGrpcUrl: string;
  readonly explorerUrl: string;
}

// Public chain objects from the Walrus Memory contract docs (network ids).
// Testnet values match GET /config on the testnet relayer.
const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: 'testnet',
    memwalServerUrl: 'https://relayer.dev.memwal.ai',
    memwalPackageId: '0x0a625e2db2af6f591a4c80a3d8551ddf11656089cc3a20c5e9e7f8fb75b9265c',
    memwalRegistryId: '0x736aef9906798fca4460490ccdf8e8502ef170122dc26ecae32111b78c6b42dd',
    tatumGrpcHost: 'sui-testnet-grpc.gateway.tatum.io:443',
    tatumJsonRpcUrl: null,
    publicGrpcUrl: 'https://fullnode.testnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/testnet',
  },
  mainnet: {
    name: 'mainnet',
    memwalServerUrl: 'https://relayer.memory.walrus.xyz',
    memwalPackageId: '0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5',
    memwalRegistryId: '0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f',
    tatumGrpcHost: 'sui-mainnet-grpc.gateway.tatum.io:443',
    tatumJsonRpcUrl: 'https://sui-mainnet.gateway.tatum.io',
    publicGrpcUrl: 'https://fullnode.mainnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/mainnet',
  },
};

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{64}$/;
export const DEFAULT_NAMESPACE = 'recall-watchdog';
export const DEFAULT_PORT = 4173;

function envValue(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readSecretFile(path: string, label: string): string {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new FixedError(`${label}: cannot read the secret file at the configured path`);
  }
  const trimmed = text.trim();
  if (trimmed === '') throw new FixedError(`${label}: the secret file is empty`);
  return trimmed;
}

// Read a secret from NAME, or from the file that NAME_FILE names.
// Returns undefined when neither is set. Throws a fixed message on a bad file.
export function readSecret(name: string): string | undefined {
  const direct = envValue(name);
  if (direct !== undefined) return direct;
  const filePath = envValue(`${name}_FILE`);
  if (filePath === undefined) return undefined;
  return readSecretFile(filePath, name);
}

export function requireSecret(name: string, hint: string): string {
  const value = readSecret(name);
  if (value === undefined) throw new FixedError(`Missing ${name}. ${hint}`);
  return value;
}

// The network switch. Default is testnet. Mainnet needs ALLOW_MAINNET=1.
export function resolveNetwork(): NetworkConfig {
  const raw = envValue('NETWORK');
  const name: NetworkName = raw === undefined ? 'testnet' : raw.toLowerCase() === 'mainnet' ? 'mainnet' : raw.toLowerCase() === 'testnet' ? 'testnet' : 'invalid' as NetworkName;
  if (name !== 'testnet' && name !== 'mainnet') {
    throw new FixedError('NETWORK must be "testnet" (default) or "mainnet"');
  }
  if (name === 'mainnet' && envValue('ALLOW_MAINNET') !== '1') {
    throw new FixedError('NETWORK=mainnet is refused. Set ALLOW_MAINNET=1 only with mainnet keys and only when you mean to use mainnet.');
  }
  return NETWORKS[name];
}

const WATCH_ADDRESS_INVALID = 'WATCH_ADDRESS must be 0x followed by 64 hex characters.';

export function resolveWatchAddress(): string {
  const address = envValue('WATCH_ADDRESS');
  if (address === undefined) throw new FixedError('Missing WATCH_ADDRESS. Set it to the Sui address to watch (0x + 64 hex).');
  if (!ADDRESS_PATTERN.test(address)) throw new FixedError(WATCH_ADDRESS_INVALID);
  return address.toLowerCase();
}

// For the web server: null only when WATCH_ADDRESS is absent (demo mode by
// choice). A set but malformed value is an error, never a silent fallback.
export function resolveOptionalWatchAddress(): string | null {
  const address = envValue('WATCH_ADDRESS');
  if (address === undefined) return null;
  if (!ADDRESS_PATTERN.test(address)) throw new FixedError(WATCH_ADDRESS_INVALID);
  return address.toLowerCase();
}

export function resolveNamespace(): string {
  return envValue('MEMWAL_NAMESPACE') ?? DEFAULT_NAMESPACE;
}

export function resolveMemwalServerUrl(network: NetworkConfig): string {
  return envValue('MEMWAL_SERVER_URL') ?? network.memwalServerUrl;
}

export function resolvePort(): number {
  const raw = envValue('PORT');
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new FixedError('PORT must be an integer from 1 to 65535.');
  return port;
}

// Shorten an address or digest for display. Never use this on a secret.
export function shortHex(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
