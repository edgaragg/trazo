import { diffModels, extractModel, isEmptyDiff, renderDiffMarkdown, REPORT_MARKER } from "@trazo/core";
import { collectAtRef, collectWorkingTree } from "trazo";

interface BitbucketComment {
  id: number;
  content?: { raw?: string };
}

interface CommentsPage {
  values: BitbucketComment[];
  /** URL of the next page, present only when there is one. */
  next?: string;
}

async function bitbucket<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`Bitbucket API ${method} ${url} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** Fetches every comment on the pull request, following Bitbucket's pagination. */
async function allComments(token: string, commentsUrl: string): Promise<BitbucketComment[]> {
  const comments: BitbucketComment[] = [];
  let url: string | undefined = commentsUrl;
  while (url) {
    const page: CommentsPage = await bitbucket(token, "GET", url);
    comments.push(...page.values);
    url = page.next;
  }
  return comments;
}

/**
 * Compares a Bitbucket pull request with its destination revision and keeps a single comment up
 * to date. Meant to run as a Bitbucket Pipelines step, reading the variables Bitbucket sets on a
 * pull-request-triggered build: `BITBUCKET_WORKSPACE`, `BITBUCKET_REPO_SLUG`, `BITBUCKET_PR_ID`,
 * `BITBUCKET_PR_DESTINATION_COMMIT` and `BITBUCKET_CLONE_DIR`. `TRAZO_BITBUCKET_TOKEN` is not set
 * by Bitbucket itself — it has to be added as a repository or workspace variable, holding an
 * access token with permission to read and write pull requests.
 *
 * Behaviour mirrors the GitHub Action: builds that are not for a pull request are ignored;
 * nothing is posted when the architecture did not change and no earlier report exists; an
 * earlier report is found by {@link REPORT_MARKER} and edited in place, never duplicated, and is
 * rewritten to say nothing changed if the change is later reverted.
 *
 * @param env - Environment to read. Injectable so it can be tested without touching `process.env`.
 * @param log - Where progress messages go.
 * @throws {Error} If `BITBUCKET_PR_ID` is set but a required variable or `TRAZO_BITBUCKET_TOKEN`
 * is missing, the destination revision cannot be read (usually a shallow clone), a file is
 * malformed, or the Bitbucket API rejects a request.
 */
export async function runBitbucketComment(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.log,
): Promise<void> {
  const prId = env["BITBUCKET_PR_ID"];
  if (!prId) {
    log("Not a pull request build, nothing to do.");
    return;
  }

  const workspace = env["BITBUCKET_WORKSPACE"];
  const repoSlug = env["BITBUCKET_REPO_SLUG"];
  const baseCommit = env["BITBUCKET_PR_DESTINATION_COMMIT"];
  const token = env["TRAZO_BITBUCKET_TOKEN"];
  if (!workspace || !repoSlug || !baseCommit || !token) {
    throw new Error(
      "Missing BITBUCKET_WORKSPACE, BITBUCKET_REPO_SLUG, BITBUCKET_PR_DESTINATION_COMMIT or the TRAZO_BITBUCKET_TOKEN repository variable.",
    );
  }

  const clonePath = env["BITBUCKET_CLONE_DIR"] ?? process.cwd();
  const before = extractModel(collectAtRef(clonePath, baseCommit));
  const after = extractModel(collectWorkingTree(clonePath));
  const diff = diffModels(before, after);

  const apiUrl = env["TRAZO_BITBUCKET_API_URL"] ?? "https://api.bitbucket.org/2.0";
  const commentsUrl = `${apiUrl}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`;
  const comments = await allComments(token, commentsUrl);
  const existing = comments.find((comment) => comment.content?.raw?.startsWith(REPORT_MARKER));

  if (isEmptyDiff(diff) && !existing) {
    log("No architecture changes, no comment posted.");
    return;
  }

  const raw = renderDiffMarkdown(diff, after);
  if (existing) {
    await bitbucket(token, "PUT", `${commentsUrl}/${existing.id}`, { content: { raw } });
  } else {
    await bitbucket(token, "POST", commentsUrl, { content: { raw } });
  }
  log("Architecture report updated.");
}
