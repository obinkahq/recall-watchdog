// Stub for @mysten-incubation/memwal. MemWal.create returns a client backed
// by the SDK's own MemWalMock (same recall), with listMemories and health.
// MemWalMock (demo memory) is the SDK mock; STUB_FAIL_AT=mock<Method> makes
// that method throw an error that repeats STUB_ECHO (a fake secret text).
import { MemWalMock as SdkMock } from '@mysten-incubation/memwal';
import { maybeFail, maybeFailLate, record } from './stub-common.mjs';

export const MemWalMock = {
  create(config) {
    const mock = SdkMock.create(config);
    return new Proxy(mock, {
      get(target, name) {
        const value = Reflect.get(target, name, target);
        if (typeof value !== 'function' || typeof name !== 'string') return value;
        return (...args) => {
          maybeFail(`mock${name[0].toUpperCase()}${name.slice(1)}`, process.env.STUB_ECHO);
          return value.apply(target, args);
        };
      },
    });
  },
};

export const MemWal = {
  create(config) {
    record({ module: 'memwal', method: 'create', hasKey: typeof config.key === 'string', serverUrl: config.serverUrl });
    maybeFail('memwalCreate', config.key);
    const mock = SdkMock.create({ namespace: config.namespace });
    let stored = 0;
    return {
      async rememberAndWait(text) {
        record({ module: 'memwal', method: 'rememberAndWait' });
        maybeFail('rememberAndWait', config.key);
        stored += 1;
        return mock.rememberAndWait(text);
      },
      async recall(query) {
        record({ module: 'memwal', method: 'recall' });
        maybeFail('recall', config.key);
        return mock.recall(query);
      },
      async listMemories() {
        record({ module: 'memwal', method: 'listMemories' });
        maybeFail('listMemories', config.key);
        return { memories: Array.from({ length: stored }, (_, i) => ({ id: `m${i}` })), has_more: false, next_cursor: null };
      },
      async health() {
        record({ module: 'memwal', method: 'health' });
        maybeFail('health', config.key);
        const late = maybeFailLate('health', config.key);
        if (late !== null) return late;
        return { status: 'ok' };
      },
      destroy() {
        mock.destroy();
      },
    };
  },
};
