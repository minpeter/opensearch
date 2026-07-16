import assert from "node:assert/strict";
import { test } from "node:test";
import { retryOperation } from "./package-smoke.mjs";

test("registry smoke retries transient install failures", async () => {
  const operationAttempts = [];
  const retriedAttempts = [];

  const result = await retryOperation({
    attempts: 3,
    delayMs: 0,
    operation: (attempt) => {
      operationAttempts.push(attempt);
      if (attempt < 3) {
        throw new Error(`registry lag ${attempt}`);
      }
      return "installed";
    },
    onRetry: ({ attempt }) => {
      retriedAttempts.push(attempt);
    },
  });

  assert.equal(result, "installed");
  assert.deepEqual(operationAttempts, [1, 2, 3]);
  assert.deepEqual(retriedAttempts, [1, 2]);
});

test("registry smoke preserves the final install failure", async () => {
  const finalFailure = new Error("package is invalid");
  let operationAttempts = 0;

  await assert.rejects(
    retryOperation({
      attempts: 2,
      delayMs: 0,
      operation: () => {
        operationAttempts += 1;
        throw operationAttempts === 2
          ? finalFailure
          : new Error("registry lag");
      },
    }),
    (error) => error === finalFailure
  );
  assert.equal(operationAttempts, 2);
});
