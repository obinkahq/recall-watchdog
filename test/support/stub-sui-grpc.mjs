// Stub for @mysten/sui/grpc. A client built with a transport is the Tatum
// client; a client built with a baseUrl is the public fullnode client. The
// listTransactions results come from the fixture in the SDK result shape.
import { fixture, maybeFail, record } from './stub-common.mjs';

let transferIndex = 0;

export class SuiGrpcClient {
  constructor(options) {
    const fx = fixture();
    this.via = options.transport ? 'tatum' : 'public';
    const key = options.transport?.apiKey ?? null;
    const via = this.via;
    this.core = {
      async getChainIdentifier() {
        record({ client: via, method: 'getChainIdentifier' });
        maybeFail('getChainIdentifier', key);
        return { chainIdentifier: fx.chainIdentifier ?? 'stub-chain' };
      },
      async getBalance(input) {
        record({ client: via, method: 'getBalance', owner: input.owner, coinType: input.coinType });
        maybeFail('getBalance', key);
        return { balance: { balance: fx.balanceMist ?? '0' } };
      },
    };
    this.key = key;
    this.fx = fx;
  }

  async listTransactions(input) {
    record({ client: this.via, method: 'listTransactions', after: input.after ?? null, order: input.order ?? null, sender: input.filter?.sender ?? null, limit: input.limit ?? null });
    maybeFail('listTransactions', this.key);
    if (input.after === undefined && input.order === 'descending') {
      return { transactions: [], hasNextPage: true, startCursor: this.fx.headCursor, endCursor: this.fx.headCursor };
    }
    const page = (this.fx.pages ?? {})[input.after];
    if (page === undefined) return { transactions: [], hasNextPage: false, startCursor: null, endCursor: null };
    return { transactions: page.transactions, hasNextPage: false, startCursor: input.after, endCursor: page.endCursor };
  }

  async listCoins(input) {
    record({ client: this.via, method: 'listCoins', owner: input.owner });
    return { objects: [] };
  }

  async signAndExecuteTransaction(input) {
    record({ client: this.via, method: 'signAndExecuteTransaction' });
    maybeFail('signAndExecuteTransaction', input.signer.getSecretKey());
    const digest = (this.fx.transferDigests ?? [])[transferIndex] ?? `stub-transfer-${transferIndex}`;
    transferIndex += 1;
    return { $kind: 'Transaction', Transaction: { digest } };
  }
}
