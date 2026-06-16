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

/** Positive finite number, e.g. a deadline in milliseconds. */
function parsePositiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!(Number.isFinite(parsed) && parsed > 0)) {
    throw new Error(`Flag ${flag} requires a positive finite number`);
  }
  return parsed;
}

/** Positive integer for count flags (--num-results / --top-k / --concurrency). */
function parseCount(value: string, flag: string): number {
  const parsed = Number(value);
  if (!(Number.isInteger(parsed) && parsed > 0)) {
    throw new Error(`Flag ${flag} requires a positive integer`);
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

  // A value-taking flag must be followed by a real value, never another flag or
  // the end of argv. Without this, `--out --markdown r.md` would silently store
  // "--markdown" as the out path and drop --markdown entirely.
  const requireValue = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Flag ${flag} requires a value`);
    }
    return value;
  };

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
        numResults = parseCount(requireValue(i, arg), arg);
        i += 1;
        break;
      case "--top-k":
        topK = parseCount(requireValue(i, arg), arg);
        i += 1;
        break;
      case "--queries":
        queries = requireValue(i, arg);
        i += 1;
        break;
      case "--out":
        outPath = requireValue(i, arg);
        i += 1;
        break;
      case "--markdown":
        markdown = requireValue(i, arg);
        i += 1;
        break;
      case "--deadline":
        deadlineMs = parsePositiveNumber(requireValue(i, arg), arg);
        i += 1;
        break;
      case "--concurrency":
        concurrency = parseCount(requireValue(i, arg), arg);
        i += 1;
        break;
      case "--history":
        history = requireValue(i, arg);
        i += 1;
        break;
      case "--baseline":
        baseline = requireValue(i, arg);
        i += 1;
        break;
      case "--charts":
        charts = requireValue(i, arg);
        i += 1;
        break;
      case "--exclude": {
        const value = requireValue(i, arg);
        for (const name of value.split(",")) {
          const trimmed = name.trim();
          if (trimmed !== "") {
            exclude.add(trimmed);
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
