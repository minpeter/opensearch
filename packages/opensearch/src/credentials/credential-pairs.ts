import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { readApiKeyPool } from "./api-key-pool.ts";

export type CredentialPair = readonly [string, string];

export interface CredentialPairPool {
  getAttemptOrder: () => readonly CredentialPair[];
  hasCredentials: () => boolean;
}

const credentialPairPools = new WeakMap<
  EnvironmentReader,
  Map<string, CredentialPairPool>
>();

export function readCredentialPairs(
  loginName: string,
  passwordName: string,
  env: EnvironmentReader
): readonly CredentialPair[] {
  const logins = readApiKeyPool(loginName, env);
  const passwords = readApiKeyPool(passwordName, env);

  if (logins.length === 0 && passwords.length === 0) {
    return [];
  }

  if (logins.length !== passwords.length) {
    throw createCredentialPairCountError(
      loginName,
      logins.length,
      passwordName,
      passwords.length
    );
  }

  const pairs: CredentialPair[] = [];
  for (const [index, login] of logins.entries()) {
    const password = passwords[index];
    if (!password) {
      throw createCredentialPairCountError(
        loginName,
        logins.length,
        passwordName,
        passwords.length
      );
    }
    pairs.push([login, password]);
  }

  return pairs;
}

export function createCredentialPairPool(
  loginName: string,
  passwordName: string,
  env: EnvironmentReader = processEnvironmentReader
): CredentialPairPool {
  let credentialIndex = 0;
  let credentialSource: string | undefined;
  let processEnvReference = globalThis.process?.env;

  return {
    getAttemptOrder() {
      const pairs = readPairs();
      if (pairs.length === 0) {
        return [];
      }

      const startIndex = credentialIndex % pairs.length;
      credentialIndex = (startIndex + 1) % pairs.length;

      return [...pairs.slice(startIndex), ...pairs.slice(0, startIndex)];
    },
    hasCredentials() {
      return readPairs().length > 0;
    },
  };

  function readPairs(): readonly CredentialPair[] {
    if (
      env === processEnvironmentReader &&
      globalThis.process?.env !== processEnvReference
    ) {
      credentialIndex = 0;
      credentialSource = undefined;
      processEnvReference = globalThis.process?.env;
    }

    const source = `${env.read(loginName) ?? ""}\u0000${env.read(passwordName) ?? ""}`;

    if (source !== credentialSource) {
      credentialIndex = 0;
      credentialSource = source;
    }

    return readCredentialPairs(loginName, passwordName, env);
  }
}

export function getCredentialPairPool(
  loginName: string,
  passwordName: string,
  env: EnvironmentReader = processEnvironmentReader
): CredentialPairPool {
  const poolKey = `${loginName}\u0000${passwordName}`;
  const existingPools = credentialPairPools.get(env);
  const existingPool = existingPools?.get(poolKey);
  if (existingPool) {
    return existingPool;
  }

  const pool = createCredentialPairPool(loginName, passwordName, env);
  const pools = existingPools ?? new Map<string, CredentialPairPool>();
  pools.set(poolKey, pool);

  if (!existingPools) {
    credentialPairPools.set(env, pools);
  }

  return pool;
}

function createCredentialPairCountError(
  loginName: string,
  loginCount: number,
  passwordName: string,
  passwordCount: number
): Error {
  return new Error(
    `${loginName} has ${loginCount} entries but ${passwordName} has ${passwordCount} entries`
  );
}
