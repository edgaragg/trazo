import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBitbucketComment } from "../src/comment.js";

// Drives the integration against a fake Bitbucket API and a real git repository: reading the
// destination revision, diffing, and creating or updating the pull request comment. The fake API
// paginates comments two at a time regardless of how many exist, so pagination is actually
// exercised rather than assumed.

const MARKER = "<!-- trazo-report -->";
const PR_ID = "7";
const WORKSPACE = "octo";
const REPO_SLUG = "demo";
const COMPOSE = "docker-compose.yml";
const PAGE_SIZE = 2;

const API_ONLY = "services:\n  api: {}\n";
const WITH_CACHE = "services:\n  api:\n    depends_on: [cache]\n  cache:\n    image: redis:7\n";
const WITH_CACHE_AND_DB = `${WITH_CACHE}  db:\n    image: postgres:16\n`;

interface FakeBitbucket {
  url: string;
  comments: Array<{ id: number; content: { raw: string } }>;
  requests: string[];
  failWith(status: number): void;
  close(): Promise<void>;
}

async function startFakeBitbucket(): Promise<FakeBitbucket> {
  const comments: FakeBitbucket["comments"] = [];
  const requests: string[] = [];
  let failing: number | undefined;
  let url = "";

  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      requests.push(`${request.method} ${request.url}`);
      response.setHeader("Content-Type", "application/json");
      if (failing) {
        response.statusCode = failing;
        return response.end(JSON.stringify({ error: { message: "nope" } }));
      }

      if (request.method === "GET" && request.url?.includes("/comments")) {
        const current = new URL(request.url, url);
        const page = Number(current.searchParams.get("page") ?? "1");
        const start = (page - 1) * PAGE_SIZE;
        const values = comments.slice(start, start + PAGE_SIZE);
        let next: string | undefined;
        if (start + PAGE_SIZE < comments.length) {
          const nextUrl = new URL(request.url, url);
          nextUrl.searchParams.set("page", String(page + 1));
          next = nextUrl.toString();
        }
        return response.end(JSON.stringify({ values, ...(next && { next }) }));
      }
      if (request.method === "POST") {
        const comment = { id: 100 + comments.length, content: JSON.parse(body).content as { raw: string } };
        comments.push(comment);
        return response.end(JSON.stringify(comment));
      }
      if (request.method === "PUT") {
        const id = Number(request.url?.split("/").pop());
        const comment = comments.find((candidate) => candidate.id === id);
        if (comment) comment.content = JSON.parse(body).content;
        return response.end(JSON.stringify(comment));
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  url = `http://127.0.0.1:${port}`;

  return {
    url,
    comments,
    requests,
    failWith: (status) => (failing = status),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

let workspaceDir: string;
let bitbucket: FakeBitbucket;
let baseCommit: string;

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "core.autocrlf=false", ...args], {
    cwd: workspaceDir,
    encoding: "utf8",
  }).trim();

const setCompose = (content: string) => writeFileSync(join(workspaceDir, COMPOSE), content);

/** Environment Bitbucket Pipelines would provide to a pull-request-triggered step. */
const prEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  BITBUCKET_WORKSPACE: WORKSPACE,
  BITBUCKET_REPO_SLUG: REPO_SLUG,
  BITBUCKET_PR_ID: PR_ID,
  BITBUCKET_PR_DESTINATION_COMMIT: baseCommit,
  BITBUCKET_CLONE_DIR: workspaceDir,
  TRAZO_BITBUCKET_TOKEN: "fake-token",
  TRAZO_BITBUCKET_API_URL: bitbucket.url,
  ...overrides,
});

beforeEach(async () => {
  workspaceDir = mkdtempSync(join(tmpdir(), "trazo-bitbucket-"));
  git("init", "-q", "-b", "main");
  setCompose(API_ONLY);
  git("add", ".");
  git("commit", "-q", "-m", "base");
  baseCommit = git("rev-parse", "HEAD");
  bitbucket = await startFakeBitbucket();
});

afterEach(async () => {
  await bitbucket.close();
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("runBitbucketComment", () => {
  it("does nothing for a build that is not a pull request", async () => {
    const logs: string[] = [];
    await runBitbucketComment({ BITBUCKET_WORKSPACE: WORKSPACE }, (message) => logs.push(message));

    expect(bitbucket.requests).toEqual([]);
    expect(logs).toEqual(["Not a pull request build, nothing to do."]);
  });

  it("fails clearly when a required variable is missing", async () => {
    const env = prEnv();
    delete env["TRAZO_BITBUCKET_TOKEN"];

    await expect(runBitbucketComment(env, () => {})).rejects.toThrow(/TRAZO_BITBUCKET_TOKEN/);
    expect(bitbucket.requests).toEqual([]);
  });

  it("stays quiet when the architecture did not change", async () => {
    const logs: string[] = [];
    await runBitbucketComment(prEnv(), (message) => logs.push(message));

    expect(bitbucket.comments).toEqual([]);
    expect(bitbucket.requests.filter((request) => !request.startsWith("GET"))).toEqual([]);
    expect(logs).toEqual(["No architecture changes, no comment posted."]);
  });

  it("posts a comment when the pull request changes the architecture", async () => {
    setCompose(WITH_CACHE);
    await runBitbucketComment(prEnv(), () => {});

    expect(bitbucket.requests).toContain(`POST /repositories/${WORKSPACE}/${REPO_SLUG}/pullrequests/${PR_ID}/comments`);
    expect(bitbucket.comments).toHaveLength(1);
    expect(bitbucket.comments[0]?.content.raw.startsWith(MARKER)).toBe(true);
    expect(bitbucket.comments[0]?.content.raw).toContain("`cache`");
  });

  it("updates its own comment on the next push instead of adding another", async () => {
    const env = prEnv();
    setCompose(WITH_CACHE);
    await runBitbucketComment(env, () => {});
    setCompose(WITH_CACHE_AND_DB);
    await runBitbucketComment(env, () => {});

    expect(bitbucket.comments).toHaveLength(1);
    expect(bitbucket.comments[0]?.content.raw).toContain("`db`");
    expect(bitbucket.requests.filter((request) => request.startsWith("PUT"))).toHaveLength(1);
  });

  it("rewrites the comment to say nothing changed once the change is reverted", async () => {
    const env = prEnv();
    setCompose(WITH_CACHE);
    await runBitbucketComment(env, () => {});
    setCompose(API_ONLY);
    await runBitbucketComment(env, () => {});

    expect(bitbucket.comments).toHaveLength(1);
    expect(bitbucket.comments[0]?.content.raw).toContain("No architecture changes detected.");
  });

  it("finds its own comment across paginated pages, ignoring comments that are not its own", async () => {
    // Five unrelated comments, paginated two at a time by the fake server, so the marker comment
    // (added last) only turns up after following two `next` links.
    for (let i = 0; i < 5; i++) bitbucket.comments.push({ id: i, content: { raw: `note ${i}` } });
    bitbucket.comments.push({ id: 99, content: { raw: `${MARKER}\nold report` } });

    setCompose(WITH_CACHE);
    await runBitbucketComment(prEnv(), () => {});

    expect(bitbucket.comments).toHaveLength(6);
    expect(bitbucket.requests.filter((request) => request.startsWith("GET"))).toHaveLength(3);
    expect(bitbucket.requests.filter((request) => request.startsWith("PUT"))).toHaveLength(1);
    expect(bitbucket.comments.find((c) => c.id === 99)?.content.raw).toContain("`cache`");
  });

  it("explains how to fix a destination revision it cannot read", async () => {
    const env = prEnv({ BITBUCKET_PR_DESTINATION_COMMIT: "0".repeat(40) });

    await expect(runBitbucketComment(env, () => {})).rejects.toThrow(/fetch-depth: 0/);
    expect(bitbucket.comments).toEqual([]);
  });

  it("reports the status when the Bitbucket API rejects a request", async () => {
    bitbucket.failWith(403);

    await expect(runBitbucketComment(prEnv(), () => {})).rejects.toThrow(/403/);
  });

  it("names the file when a compose file is malformed", async () => {
    setCompose("services: [");

    await expect(runBitbucketComment(prEnv(), () => {})).rejects.toThrow(/Invalid YAML in docker-compose\.yml/);
  });

  it("finds compose files in subdirectories", async () => {
    mkdirSync(join(workspaceDir, "deploy"));
    writeFileSync(join(workspaceDir, "deploy", "compose.yaml"), "services:\n  worker: {}\n");
    await runBitbucketComment(prEnv(), () => {});

    expect(bitbucket.comments[0]?.content.raw).toContain("`worker`");
  });
});
