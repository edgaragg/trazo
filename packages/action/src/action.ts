import { readFileSync } from "node:fs";
import { diffModels, extractModel, isEmptyDiff, renderDiffMarkdown, REPORT_MARKER } from "@edgaragg/trazo-core";
import { collectAtRef, collectWorkingTree } from "@edgaragg/trazo-cli";

interface PullRequestEvent {
  pull_request?: { number: number; base: { sha: string } };
}

interface IssueComment {
  id: number;
  body?: string;
}

async function github<T>(
  apiUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/**
 * Compares a pull request with its base revision and keeps a single comment up to date.
 *
 * Reads the same environment GitHub Actions provides: `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY`,
 * `GITHUB_WORKSPACE` (defaults to the current directory), `GITHUB_API_URL` (defaults to
 * github.com) and the `github-token` input as `INPUT_GITHUB-TOKEN`.
 *
 * Behaviour:
 * - Events other than `pull_request` are ignored.
 * - Nothing is posted when the architecture did not change and no earlier report exists, so
 *   unrelated pull requests stay quiet.
 * - An earlier report is found by {@link REPORT_MARKER} and edited in place, never duplicated.
 *   If the change is later reverted, that report is rewritten to say nothing changed.
 * - Only the first 100 comments of the pull request are searched for an earlier report.
 *
 * @param env - Environment to read. Injectable so it can be tested without touching `process.env`.
 * @param log - Where progress messages go.
 * @throws {Error} If required variables are missing, the base revision cannot be read (usually a
 * shallow checkout), a file is malformed, or the GitHub API rejects a request.
 */
export async function runAction(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.log,
): Promise<void> {
  const eventPath = env["GITHUB_EVENT_PATH"];
  const repository = env["GITHUB_REPOSITORY"];
  const token = env["INPUT_GITHUB-TOKEN"];
  if (!eventPath || !repository || !token) {
    throw new Error("Missing GITHUB_EVENT_PATH, GITHUB_REPOSITORY or the github-token input.");
  }

  const pullRequest = (JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestEvent).pull_request;
  if (!pullRequest) {
    log("Not a pull_request event, nothing to do.");
    return;
  }

  const workspace = env["GITHUB_WORKSPACE"] ?? process.cwd();
  const before = extractModel(collectAtRef(workspace, pullRequest.base.sha));
  const after = extractModel(collectWorkingTree(workspace));
  const diff = diffModels(before, after);

  const apiUrl = env["GITHUB_API_URL"] ?? "https://api.github.com";
  const commentsPath = `/repos/${repository}/issues/${pullRequest.number}/comments`;
  const comments = await github<IssueComment[]>(apiUrl, token, "GET", `${commentsPath}?per_page=100`);
  const existing = comments.find((comment) => comment.body?.startsWith(REPORT_MARKER));

  if (isEmptyDiff(diff) && !existing) {
    log("No architecture changes, no comment posted.");
    return;
  }

  const body = renderDiffMarkdown(diff, after);
  if (existing) {
    await github(apiUrl, token, "PATCH", `/repos/${repository}/issues/comments/${existing.id}`, { body });
  } else {
    await github(apiUrl, token, "POST", commentsPath, { body });
  }
  log("Architecture report updated.");
}
