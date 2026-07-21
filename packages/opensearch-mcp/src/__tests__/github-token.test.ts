import { describe, expect, it, vi } from "vitest";
import { createGhSubprocessEnv, resolveGitHubToken } from "../github-token.ts";

const noEnv: NodeJS.ProcessEnv = {};

describe("resolveGitHubToken", () => {
  it("passes only gh configuration and process-location variables to gh", () => {
    expect(
      createGhSubprocessEnv({
        API_SECRET: "do-not-forward",
        GH_CONFIG_DIR: "/config",
        HOME: "/home/test",
        PATH: "/bin",
      })
    ).toEqual({
      GH_CONFIG_DIR: "/config",
      HOME: "/home/test",
      NO_COLOR: "1",
      PATH: "/bin",
    });
  });
  it("prefers GITHUB_TOKEN and never invokes gh", async () => {
    const runGh = vi.fn();

    const token = await resolveGitHubToken(
      { GITHUB_TOKEN: "github-token" },
      runGh
    );

    expect(token).toBe("github-token");
    expect(runGh).not.toHaveBeenCalled();
  });

  it("uses GH_TOKEN before invoking gh", async () => {
    const runGh = vi.fn();

    const token = await resolveGitHubToken({ GH_TOKEN: "gh-token" }, runGh);

    expect(token).toBe("gh-token");
    expect(runGh).not.toHaveBeenCalled();
  });

  it("uses the trimmed output of gh auth token", async () => {
    const runGh = vi.fn().mockResolvedValue("ghp_from_cli\n");

    const token = await resolveGitHubToken(noEnv, runGh);

    expect(token).toBe("ghp_from_cli");
    expect(runGh).toHaveBeenCalledWith(["auth", "token"]);
  });

  it("returns undefined when gh is absent or unauthenticated", async () => {
    const runGh = vi.fn().mockRejectedValue(new Error("not found"));

    await expect(resolveGitHubToken(noEnv, runGh)).resolves.toBeUndefined();
  });

  it("does not expose empty gh output as a configured token", async () => {
    const runGh = vi.fn().mockResolvedValue(" \n");

    await expect(resolveGitHubToken(noEnv, runGh)).resolves.toBeUndefined();
  });
});
