export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class ProviderHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
  }
}

export function getHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return;
  }

  const candidate = error as Error & { readonly status?: unknown };
  return typeof candidate.status === "number" ? candidate.status : undefined;
}
