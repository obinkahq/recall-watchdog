// Shared stub state. STUB_FIXTURE names a JSON file with the chain data.
// STUB_LOG names a file that gets one JSON line per stub call (no key
// values, only flags such as hasApiKey). STUB_FAIL_AT names one method that
// throws; its error message repeats the key input the stub saw, like the
// worst dependency would, so tests can prove that no such text gets out.
import { appendFileSync, readFileSync } from 'node:fs';

export function fixture() {
  const file = process.env.STUB_FIXTURE;
  return file ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

export function record(entry) {
  const file = process.env.STUB_LOG;
  if (file) appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

// STUB_FAIL_AT=<method>Late: the call never settles and a timer throws an
// error that repeats the key, outside every catch (an uncaught exception).
export function maybeFailLate(method, keyText) {
  if (process.env.STUB_FAIL_AT !== `${method}Late`) return null;
  setTimeout(() => { throw new Error(`late ${method} failure for input ${String(keyText)}`); }, 5);
  return new Promise(() => {});
}

export function maybeFail(method, keyText) {
  if (process.env.STUB_FAIL_AT !== method) return;
  const error = new Error(`stub ${method} failed for input ${String(keyText)}`);
  error.code = 'INTERNAL';
  throw error;
}
