export async function withAbortSignal<T>(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abort = (): void => controller.abort(abortReason(callerSignal?.reason));

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
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const abort = (): void => {
      cleanup();
      reject(abortReason(signal.reason));
    };

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

    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortReason(signal.reason);
  }
}

function abortReason(reason: unknown): unknown {
  return reason === undefined
    ? new DOMException("The operation was aborted", "AbortError")
    : reason;
}
