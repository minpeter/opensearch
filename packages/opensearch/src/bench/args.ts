export interface CliOptions {
  readonly baseline?: string;
  readonly charts?: string;
  readonly concurrency?: number;
  readonly deadlineMs?: number;
  readonly exclude: ReadonlySet<string>;
  readonly history?: string;
  readonly markdown?: string;
  readonly mode: "offline" | "live";
  readonly numResults?: number;
  readonly out?: string;
  readonly queries?: string;
  readonly topK?: number;
}

function parseNumber(value: string | undefined, flag: string): number {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Flag ${flag} requires a numeric value`);
  }
  const parsed = Number(value);
  if (!(Number.isFinite(parsed) && parsed > 0)) {
    throw new Error(`Flag ${flag} requires a positive finite number`);
  }
  return parsed;
}

/**
 * Parse bench CLI flags. `--` is the standard end-of-options separator (pnpm
 * forwards it when you run `pnpm <script> -- <args>`) and is ignored.
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  let mode: "offline" | "live" = "offline";
  let numResults: number | undefined;
  let topK: number | undefined;
  let queries: string | undefined;
  let outPath: string | undefined;
  let markdown: string | undefined;
  let deadlineMs: number | undefined;
  let concurrency: number | undefined;
  let history: string | undefined;
  let baseline: string | undefined;
  let charts: string | undefined;
  const exclude = new Set<string>();

  const next = (index: number): string | undefined => argv[index + 1];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--":
        break;
      case "--live":
        mode = "live";
        break;
      case "--offline":
        mode = "offline";
        break;
      case "--num-results":
        numResults = parseNumber(next(i), arg);
        i += 1;
        break;
      case "--top-k":
        topK = parseNumber(next(i), arg);
        i += 1;
        break;
      case "--queries":
        queries = next(i);
        i += 1;
        break;
      case "--out":
        outPath = next(i);
        i += 1;
        break;
      case "--markdown":
        markdown = next(i);
        i += 1;
        break;
      case "--deadline":
        deadlineMs = parseNumber(next(i), arg);
        i += 1;
        break;
      case "--concurrency":
        concurrency = parseNumber(next(i), arg);
        i += 1;
        break;
      case "--history":
        history = next(i);
        i += 1;
        break;
      case "--baseline":
        baseline = next(i);
        i += 1;
        break;
      case "--charts":
        charts = next(i);
        i += 1;
        break;
      case "--exclude": {
        const value = next(i);
        if (value !== undefined) {
          for (const name of value.split(",")) {
            const trimmed = name.trim();
            if (trimmed !== "") {
              exclude.add(trimmed);
            }
          }
        }
        i += 1;
        break;
      }
      default:
        if (arg?.startsWith("--")) {
          throw new Error(`Unknown flag: ${arg}`);
        }
    }
  }

  return {
    baseline,
    charts,
    concurrency,
    deadlineMs,
    exclude,
    history,
    markdown,
    mode,
    numResults,
    out: outPath,
    queries,
    topK,
  };
}
