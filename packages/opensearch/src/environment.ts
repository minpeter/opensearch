export type OpenSearchEnvironment = Readonly<
  Record<string, string | undefined>
>;

export interface EnvironmentReader {
  read: (name: string) => string | undefined;
}

export const processEnvironmentReader: EnvironmentReader = {
  read: (name) => globalThis.process?.env?.[name],
};

export function createEnvironmentReader(
  env: OpenSearchEnvironment = {}
): EnvironmentReader {
  const values = new Map(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );

  return {
    read: (name) => values.get(name),
  };
}
