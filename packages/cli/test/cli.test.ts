import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trazo-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cli(...args: string[]) {
  let out = "";
  let err = "";
  const code = run(args, {
    cwd: dir,
    out: (text) => (out += text),
    err: (text) => (err += text),
    writeFile: (path, content) => writeFileSync(path, content),
  });
  return { code, out, err };
}

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: dir,
    stdio: "ignore",
  });

const write = (path: string, content: string) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
};

describe("trazo generate", () => {
  it("prints a Mermaid diagram of the compose files it finds", () => {
    write("docker-compose.yml", "services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:16\n");
    const { code, out } = cli("generate");

    expect(code).toBe(0);
    expect(out).toContain("flowchart LR");
    expect(out).toContain("n_api --> n_db");
  });

  it("can print the model as JSON", () => {
    write("docker-compose.yml", "services:\n  api: {}\n");
    const { code, out } = cli("generate", "--format", "json");

    expect(code).toBe(0);
    expect(JSON.parse(out).nodes[0].id).toBe("api");
  });

  it("finds compose files in subdirectories but skips node_modules", () => {
    write("deploy/compose.yaml", "services:\n  api: {}\n");
    write("node_modules/pkg/docker-compose.yml", "services:\n  ignored: {}\n");
    const { out } = cli("generate", "--format", "json");

    expect(JSON.parse(out).nodes.map((n: { id: string }) => n.id)).toEqual(["api"]);
  });

  it("fails with a clear message when there is nothing to read", () => {
    const { code, err } = cli("generate");

    expect(code).toBe(1);
    expect(err).toContain("no supported infrastructure files found");
  });

  it("reports malformed YAML instead of crashing", () => {
    write("docker-compose.yml", "services: [");
    const { code, err } = cli("generate");

    expect(code).toBe(1);
    expect(err).toContain("Invalid YAML in docker-compose.yml");
  });

  it("can render a full architecture document as Markdown", () => {
    write("docker-compose.yml", "services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:16\n");
    const { code, out } = cli("generate", "--format", "markdown");

    expect(code).toBe(0);
    expect(out).toContain("<!-- trazo-architecture -->");
    expect(out).toContain("```mermaid");
    expect(out).toContain("## Components");
    expect(out).toContain("`api` → `db`");
  });

  it("writes to a file instead of stdout with --out", () => {
    write("docker-compose.yml", "services:\n  api: {}\n");
    const { code, out } = cli("generate", "--format", "markdown", "--out", "ARCHITECTURE.md");

    expect(code).toBe(0);
    expect(out).toBe("");
    expect(readFileSync(join(dir, "ARCHITECTURE.md"), "utf8")).toContain("`api` (service)");
  });

  it("resolves --out against cwd, not against the scanned directory", () => {
    write("deploy/docker-compose.yml", "services:\n  api: {}\n");
    const { code } = cli("generate", "deploy", "--out", "ARCHITECTURE.md");

    expect(code).toBe(0);
    expect(existsSync(join(dir, "ARCHITECTURE.md"))).toBe(true);
    expect(existsSync(join(dir, "deploy", "ARCHITECTURE.md"))).toBe(false);
  });

  it("with --out, writes a file saying so instead of failing when nothing is found", () => {
    const { code, err } = cli("generate", "--format", "markdown", "--out", "ARCHITECTURE.md");

    expect(code).toBe(0);
    expect(err).toBe("");
    expect(readFileSync(join(dir, "ARCHITECTURE.md"), "utf8")).toContain(
      "No supported infrastructure files were found.",
    );
  });

  it("rejects an unknown format", () => {
    write("docker-compose.yml", "services:\n  api: {}\n");
    const { code, err } = cli("generate", "--format", "yaml");

    expect(code).toBe(1);
    expect(err).toContain('unknown format "yaml"');
  });
});

describe("trazo diff", () => {
  it("reports what changed since a git revision", () => {
    git("init", "-q", "-b", "main");
    write("docker-compose.yml", "services:\n  api: {}\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");

    write("docker-compose.yml", "services:\n  api:\n    depends_on: [cache]\n  cache:\n    image: redis:7\n");
    const { code, out } = cli("diff", "--base", "main");

    expect(code).toBe(0);
    expect(out).toContain("### Added components");
    expect(out).toContain("`cache`");
    expect(out).toContain("`api` → `cache`");
  });

  it("reports every component as added when the base has no compose file", () => {
    git("init", "-q", "-b", "main");
    write("README.md", "# nothing to see\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");

    write("docker-compose.yml", "services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:16\n");
    const { code, out } = cli("diff", "--base", "main");

    expect(code).toBe(0);
    expect(out).toContain("### Added components");
    expect(out).toContain("`api`");
    expect(out).toContain("`db` (database, `postgres:16`)");
    expect(out).toContain("`api` → `db`");
    expect(out).not.toContain("Removed");
  });

  it("reports every component as added when the base commit is empty", () => {
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "empty base");

    write("docker-compose.yml", "services:\n  api: {}\n");
    const { code, out } = cli("diff", "--base", "main");

    expect(code).toBe(0);
    expect(out).toContain("`api`");
  });

  it("requires --base", () => {
    const { code, err } = cli("diff");

    expect(code).toBe(1);
    expect(err).toContain("--base");
  });

  it("explains how to fix an unknown revision", () => {
    git("init", "-q", "-b", "main");
    const { code, err } = cli("diff", "--base", "does-not-exist");

    expect(code).toBe(1);
    expect(err).toContain('Could not read git revision "does-not-exist"');
    expect(err).toContain("fetch-depth: 0");
  });
});

describe("trazo", () => {
  it("prints help and rejects unknown commands", () => {
    expect(cli("--help").out).toContain("Usage:");
    expect(cli("nope").code).toBe(1);
  });
});
