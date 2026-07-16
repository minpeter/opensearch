export function assertValidMaxConcurrency(maxConcurrency: number): void {
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError("maxConcurrency must be a positive safe integer.");
  }
}

export async function mapWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  maxConcurrency: number,
  mapper: (input: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  assertValidMaxConcurrency(maxConcurrency);

  const results = new Array<TOutput>(inputs.length);
  const entries = inputs.entries();
  let failure: { readonly error: unknown } | undefined;

  const worker = async (): Promise<void> => {
    let entry = entries.next();

    while (!(entry.done || failure)) {
      const [index, input] = entry.value;
      try {
        results[index] = await mapper(input, index);
      } catch (error) {
        failure ??= { error };
        return;
      }
      entry = entries.next();
    }
  };

  const workerCount = Math.min(inputs.length, maxConcurrency);
  await Promise.all(Array.from({ length: workerCount }, worker));

  if (failure) {
    throw failure.error;
  }

  return results;
}
