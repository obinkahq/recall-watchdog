// Error text policy. Only text that this repository writes is shown to the
// user. A dependency error message can repeat its input (for example a key
// that failed to decode), so no code path prints, logs, throws again, or
// sends in an HTTP response the message of an error that it did not make.
// FixedError marks a message built from constants and public values only.
// Each entry point has one error boundary that prints failureText().

export class FixedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixedError';
  }
}

// A FixedError that the caller caused (bad request body, bad query).
export class RequestError extends FixedError {
  constructor(message: string) {
    super(message);
    this.name = 'RequestError';
  }
}

const GRPC_CODE_NAMES: readonly string[] = [
  'OK', 'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS',
  'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE',
  'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED',
];

// The gRPC status name of an error when it is one of the fixed names, else
// null. The raw value is never returned.
export function safeCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && GRPC_CODE_NAMES.includes(code)) return code;
  if (typeof code === 'number' && Number.isInteger(code)) return GRPC_CODE_NAMES[code] ?? null;
  return null;
}

export const WITHHELD = 'details withheld (a dependency error can hold key text)';

// The text to show for an error: a FixedError message as is; for any other
// error the step name, a known gRPC status, and a fixed note only.
export function failureText(error: unknown, stage: string): string {
  if (error instanceof FixedError) return error.message;
  const code = safeCode(error);
  return `${stage} failed${code === null ? '' : ` (${code})`}; ${WITHHELD}`;
}

// Last line of defence for an entry point: an error that escapes every
// catch (for example from a dependency callback) prints fixed text only.
// Node's default handler would print the full message and stack.
export function installFixedCrashHandlers(prefix: string): void {
  const crash = (error: unknown): void => {
    process.stderr.write(`${prefix}: ${failureText(error, 'background task')}\n`);
    process.exit(1);
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
}
