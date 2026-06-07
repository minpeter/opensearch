import { describe, expect, it } from "vitest";

import {
  createApiKeyPool,
  getApiKeyPool,
  parseApiKeyPool,
  readApiKeyPool,
} from "../credentials/api-key-pool.ts";
import { createEnvironmentReader } from "../environment.ts";

describe("ApiKeyPool", () => {
  it("parses semicolon-delimited API key pools with trim and empty segment filtering", () => {
    expect(parseApiKeyPool(" key-a ; ; key-b ;\tkey-c ")).toEqual([
      "key-a",
      "key-b",
      "key-c",
    ]);
    expect(parseApiKeyPool(undefined)).toEqual([]);
    expect(
      readApiKeyPool(
        "TEST_API_KEY",
        createEnvironmentReader({ TEST_API_KEY: " one ; two " })
      )
    ).toEqual(["one", "two"]);
  });

  it("rotates the starting API key on each attempt order request", () => {
    const pool = createApiKeyPool(
      "TEST_API_KEY",
      createEnvironmentReader({ TEST_API_KEY: "a;b;c" })
    );

    expect(pool.getAttemptOrder()).toEqual(["a", "b", "c"]);
    expect(pool.getAttemptOrder()).toEqual(["b", "c", "a"]);
    expect(pool.getAttemptOrder()).toEqual(["c", "a", "b"]);
    expect(pool.getAttemptOrder()).toEqual(["a", "b", "c"]);
  });

  it("resets rotation when the environment source changes", () => {
    let source = "a;b";
    const pool = createApiKeyPool("TEST_API_KEY", {
      read: (name: string) => (name === "TEST_API_KEY" ? source : undefined),
    });

    expect(pool.getAttemptOrder()).toEqual(["a", "b"]);
    expect(pool.getAttemptOrder()).toEqual(["b", "a"]);

    source = "c;d";

    expect(pool.getAttemptOrder()).toEqual(["c", "d"]);
    expect(pool.getAttemptOrder()).toEqual(["d", "c"]);
  });

  it("keeps distinct environment readers isolated", () => {
    const firstPool = createApiKeyPool(
      "TEST_API_KEY",
      createEnvironmentReader({ TEST_API_KEY: "first-a;first-b" })
    );
    const secondPool = createApiKeyPool(
      "TEST_API_KEY",
      createEnvironmentReader({ TEST_API_KEY: "second-a;second-b" })
    );

    expect(firstPool.getAttemptOrder()).toEqual(["first-a", "first-b"]);
    expect(firstPool.getAttemptOrder()).toEqual(["first-b", "first-a"]);
    expect(secondPool.getAttemptOrder()).toEqual(["second-a", "second-b"]);
    expect(firstPool.getAttemptOrder()).toEqual(["first-a", "first-b"]);
  });

  it("reuses one shared pool per environment reader and variable name", () => {
    const env = createEnvironmentReader({ TEST_API_KEY: "a;b" });
    const firstPool = getApiKeyPool("TEST_API_KEY", env);
    const secondPool = getApiKeyPool("TEST_API_KEY", env);

    expect(firstPool).toBe(secondPool);
    expect(firstPool.getAttemptOrder()).toEqual(["a", "b"]);
    expect(secondPool.getAttemptOrder()).toEqual(["b", "a"]);
  });
});
