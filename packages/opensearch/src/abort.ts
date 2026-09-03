export async function withAbortSignal<T>(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abort = (): void => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    abort();
  } else {
    callerSignal?.addEventListener("abort", abort, { once: true });
  }

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abort);
  }
}

export function awaitAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ??
        new DOMException("The operation was aborted", "AbortError")
    );
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void =>
      reject(
        signal.reason ??
          new DOMException("The operation was aborted", "AbortError")
      );
    signal.addEventListener("abort", abort, { once: true });
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw (
      signal.reason ??
      new DOMException("The operation was aborted", "AbortError")
    );
  }
}
