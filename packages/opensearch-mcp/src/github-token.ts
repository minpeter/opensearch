import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 3000;

const GH_ENV_KEYS = [
  "APPDATA",
  "DBUS_SESSION_BUS_ADDRESS",
  "GH_CONFIG_DIR",
  "GH_HOST",
  "GITHUB_HOST",
  "HOME",
  "PATH",
  "SystemRoot",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_RUNTIME_DIR",
] as const;

export type GhTokenRunner = (args: readonly string[]) => Promise<string>;

export async function resolveGitHubToken(
  env: NodeJS.ProcessEnv = process.env,
  runGh: GhTokenRunner = runGhCommand
): Promise<string | undefined> {
  const configured = cleanToken(env.GITHUB_TOKEN) ?? cleanToken(env.GH_TOKEN);
  if (configured) {
    return configured;
  }

  try {
    return cleanToken(await runGh(["auth", "token"]));
  } catch {
    // GitHub code search is optional when gh is absent or unauthenticated.
    return cleanToken("");
  }
}

export function createGhSubprocessEnv(
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const subprocessEnv: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const key of GH_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) {
      subprocessEnv[key] = value;
    }
  }
  return subprocessEnv;
}

async function runGhCommand(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", [...args], {
    encoding: "utf8",
    env: createGhSubprocessEnv(process.env),
    timeout: GH_TIMEOUT_MS,
  });
  return stdout;
}

function cleanToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  return token || undefined;
}
