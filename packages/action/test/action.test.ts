import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAction } from "../src/action.js";

// Drives the Action against a fake GitHub API and a real git repository, so the whole flow is
// covered: reading the base revision, diffing, and creating or updating the pull request comment.

const MARKER = "<!-- trazo-report -->";
const PR = 7;
const REPO = "octo/demo";
const COMPOSE = "docker-compose.yml";

const API_ONLY = "services:\n  api: {}\n";
const WITH_CACHE = "services:\n  api:\n    depends_on: [cache]\n  cache:\n    image: redis:7\n";
const WITH_CACHE_AND_DB = `${WITH_CACHE}  db:\n    image: postgres:16\n`;

interface FakeGitHub {
  url: string;
  comments: Array<{ id: number; body: string }>;
  requests: string[];
  /** Makes every following request fail with this status. */
  failWith(status: number): void;
  close(): Promise<void>;
}

async function startFakeGitHub(): Promise<FakeGitHub> {
  const comments: FakeGitHub["comments"] = [];
  const requests: string[] = [];
  let failing: number | undefined;

  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      requests.push(`${request.method} ${request.url}`);
      response.setHeader("Content-Type", "application/json");
      if (failing) {
        response.statusCode = failing;
        return response.end('{"message":"nope"}');
      }
      if (request.method === "GET") return response.end(JSON.stringify(comments));
      if (request.method === "POST") {
        const comment = { id: 100 + comments.length, body: JSON.parse(body).body as string };
        comments.push(comment);
        return response.end(JSON.stringify(comment));
      }
      if (request.method === "PATCH") {
        const id = Number(request.url?.split("/").pop());
        const comment = comments.find((candidate) => candidate.id === id);
        if (comment) comment.body = JSON.parse(body).body;
        return response.end("{}");
      }
      response.statusCode = 404;
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    comments,
    requests,
    failWith: (status) => (failing = status),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

let workspace: string;
let github: FakeGitHub;
let baseSha: string;

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "core.autocrlf=false", ...args], {
    cwd: workspace,
    encoding: "utf8",
  }).trim();

const setCompose = (content: string) => writeFileSync(join(workspace, COMPOSE), content);

const writeEvent = (event: unknown) => {
  const path = join(workspace, ".git", "event.json");
  writeFileSync(path, JSON.stringify(event));
  return path;
};

const pullRequestEvent = (sha = baseSha) => ({ pull_request: { number: PR, base: { sha } } });

/** Environment GitHub would provide to the Action. */
const actionEnv = (eventPath: string): NodeJS.ProcessEnv => ({
  GITHUB_EVENT_PATH: eventPath,
  GITHUB_REPOSITORY: REPO,
  GITHUB_WORKSPACE: workspace,
  GITHUB_API_URL: github.url,
  "INPUT_GITHUB-TOKEN": "fake-token",
});

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), "trazo-action-"));
  git("init", "-q", "-b", "main");
  setCompose(API_ONLY);
  git("add", ".");
  git("commit", "-q", "-m", "base");
  baseSha = git("rev-parse", "HEAD");
  github = await startFakeGitHub();
});

afterEach(async () => {
  await github.close();
  rmSync(workspace, { recursive: true, force: true });
});

describe("runAction", () => {
  it("stays quiet when the architecture did not change", async () => {
    const logs: string[] = [];
    await runAction(actionEnv(writeEvent(pullRequestEvent())), (message) => logs.push(message));

    expect(github.comments).toEqual([]);
    expect(github.requests.filter((request) => !request.startsWith("GET"))).toEqual([]);
    expect(logs).toEqual(["No architecture changes, no comment posted."]);
  });

  it("posts a report when the pull request changes the architecture", async () => {
    setCompose(WITH_CACHE);
    await runAction(actionEnv(writeEvent(pullRequestEvent())), () => {});

    expect(github.requests).toContain(`POST /repos/${REPO}/issues/${PR}/comments`);
    expect(github.comments).toHaveLength(1);
    expect(github.comments[0]?.body.startsWith(MARKER)).toBe(true);
    expect(github.comments[0]?.body).toContain("`cache`");
    expect(github.comments[0]?.body).toContain("```mermaid");
  });

  it("updates its own comment on the next push instead of adding another", async () => {
    const env = actionEnv(writeEvent(pullRequestEvent()));
    setCompose(WITH_CACHE);
    await runAction(env, () => {});
    setCompose(WITH_CACHE_AND_DB);
    await runAction(env, () => {});

    expect(github.comments).toHaveLength(1);
    expect(github.comments[0]?.body).toContain("`db`");
    expect(github.requests.filter((request) => request.startsWith("PATCH"))).toHaveLength(1);
  });

  it("rewrites the report to say nothing changed once the change is reverted", async () => {
    const env = actionEnv(writeEvent(pullRequestEvent()));
    setCompose(WITH_CACHE);
    await runAction(env, () => {});
    setCompose(API_ONLY);
    await runAction(env, () => {});

    expect(github.comments).toHaveLength(1);
    expect(github.comments[0]?.body).toContain("No architecture changes detected.");
  });

  it("reports every component when the pull request introduces the first compose file", async () => {
    // The base holds no compose file at all, so its tree is empty.
    git("rm", "-q", COMPOSE);
    git("commit", "-q", "-m", "remove compose");
    const emptyBase = git("rev-parse", "HEAD");
    setCompose(WITH_CACHE);
    await runAction(actionEnv(writeEvent(pullRequestEvent(emptyBase))), () => {});

    const body = github.comments[0]?.body ?? "";
    expect(github.comments).toHaveLength(1);
    expect(body).toContain("### Added components");
    expect(body).toContain("`api`");
    expect(body).toContain("`cache` (cache, `redis:7`)");
    expect(body).toContain("`api` → `cache`");
    expect(body).toContain("```mermaid");
    expect(body).not.toContain("No architecture changes");
  });

  it("ignores comments that are not its own", async () => {
    github.comments.push({ id: 1, body: "LGTM" });
    setCompose(WITH_CACHE);
    await runAction(actionEnv(writeEvent(pullRequestEvent())), () => {});

    expect(github.comments).toHaveLength(2);
    expect(github.comments[0]?.body).toBe("LGTM");
  });

  it("does nothing for events that are not pull requests", async () => {
    const logs: string[] = [];
    await runAction(actionEnv(writeEvent({ ref: "refs/heads/main" })), (message) => logs.push(message));

    expect(github.requests).toEqual([]);
    expect(logs).toEqual(["Not a pull_request event, nothing to do."]);
  });

  it("explains how to fix a base revision it cannot read", async () => {
    const env = actionEnv(writeEvent(pullRequestEvent("0".repeat(40))));

    await expect(runAction(env, () => {})).rejects.toThrow(/fetch-depth: 0/);
    expect(github.comments).toEqual([]);
  });

  it("fails clearly when a required variable is missing", async () => {
    const env = actionEnv(writeEvent(pullRequestEvent()));
    delete env["INPUT_GITHUB-TOKEN"];

    await expect(runAction(env, () => {})).rejects.toThrow(/github-token/);
  });

  it("reports the status when the GitHub API rejects a request", async () => {
    github.failWith(403);

    await expect(runAction(actionEnv(writeEvent(pullRequestEvent())), () => {})).rejects.toThrow(/403/);
  });

  it("names the file when a compose file is malformed", async () => {
    setCompose("services: [");

    await expect(runAction(actionEnv(writeEvent(pullRequestEvent())), () => {})).rejects.toThrow(
      /Invalid YAML in docker-compose\.yml/,
    );
  });

  it("finds compose files in subdirectories", async () => {
    mkdirSync(join(workspace, "deploy"));
    writeFileSync(join(workspace, "deploy", "compose.yaml"), "services:\n  worker: {}\n");
    await runAction(actionEnv(writeEvent(pullRequestEvent())), () => {});

    expect(github.comments[0]?.body).toContain("`worker`");
  });
});

// The published Action is the bundled file, not the sources, so it needs its own check: a missing
// dependency or a bundling mistake would only show up there. CI builds before it runs the tests.
const bundle = fileURLToPath(new URL("../dist/index.cjs", import.meta.url));

describe.skipIf(!existsSync(bundle))("the bundled Action", () => {
  it("runs as GitHub would run it and posts the report", async () => {
    setCompose(WITH_CACHE);
    const env = { ...process.env, ...actionEnv(writeEvent(pullRequestEvent())) };

    const result = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [bundle], { env });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (status) => resolve({ status, stderr }));
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(github.comments[0]?.body).toContain("`cache`");
  });

  it("exits with a failure code and a readable message when something is wrong", async () => {
    const env = { ...process.env, ...actionEnv(writeEvent(pullRequestEvent("0".repeat(40)))) };

    const result = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [bundle], { env });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (status) => resolve({ status, stderr }));
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fetch-depth: 0");
  });
});
