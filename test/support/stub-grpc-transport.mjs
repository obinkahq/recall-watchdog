// Stub for @protobuf-ts/grpc-transport: keeps the API key for the stub
// client (to echo in a forced failure) and records only that it was set.
import { record } from './stub-common.mjs';

export class GrpcTransport {
  constructor(options) {
    this.apiKey = options?.meta?.['x-api-key'] ?? null;
    this.host = options?.host ?? null;
    record({ module: 'transport', method: 'constructor', host: this.host, hasApiKey: this.apiKey !== null });
  }
  close() {
    record({ module: 'transport', method: 'close' });
  }
}
