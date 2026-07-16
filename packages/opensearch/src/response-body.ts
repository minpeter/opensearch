export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export class ResponseSizeLimitError extends Error {
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super(`Response body exceeded the ${limitBytes}-byte download limit`);
    this.name = "ResponseSizeLimitError";
    this.limitBytes = limitBytes;
  }
}

interface ResponseBodySource {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly headers: {
    get(name: string): string | null;
  };
}

export async function cancelResponseBody(
  response: Pick<ResponseBodySource, "body">
): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup must not replace the provider error that caused cancellation.
  }
}

export async function limitResponseBody(
  response: Response,
  limitBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<Response> {
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    await cancelResponseBody(response);
    throw new ResponseSizeLimitError(limitBytes);
  }

  if (!response.body) {
    return response;
  }

  let totalBytes = 0;
  const boundedBody = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        totalBytes += chunk.byteLength;
        if (totalBytes > limitBytes) {
          controller.error(new ResponseSizeLimitError(limitBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );

  return new Response(boundedBody, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function readResponseBytes(
  response: ResponseBodySource,
  limitBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    await cancelResponseBody(response);
    throw new ResponseSizeLimitError(limitBytes);
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > limitBytes) {
        await reader.cancel();
        throw new ResponseSizeLimitError(limitBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readResponseText(
  response: ResponseBodySource,
  limitBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<string> {
  return new TextDecoder().decode(
    await readResponseBytes(response, limitBytes)
  );
}

export async function readResponseJson(
  response: ResponseBodySource,
  limitBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<unknown> {
  return JSON.parse(await readResponseText(response, limitBytes));
}

export function assertTextByteLimit(text: string, limitBytes: number): void {
  if (new TextEncoder().encode(text).byteLength > limitBytes) {
    throw new ResponseSizeLimitError(limitBytes);
  }
}
