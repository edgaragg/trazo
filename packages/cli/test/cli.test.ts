import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/index.js";

let dir: string;
let vars: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trazo-"));
  vars = {}; // never inherit the real CI environment
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(...args: string[]) {
  let out = "";
  let err = "";
  const code = await run(args, {
    cwd: dir,
    out: (text) => (out += text),
    err: (text) => (err += text),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    vars,
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
  it("prints a Mermaid diagram of the compose files it finds", async () => {
    write("docker-compose.yml", "services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:16\n");
    const { code, out } = await cli("generate");

    expect(code).toBe(0);
    expect(out).toContain("flowchart LR");
    expect(out).toContain("n_api --> n_db");
  });

  it("can print the model as JSON", async () => {
    write("docker-compose.yml", "services:\n  api: {}\n");
    const { code, out } = await cli("generate", "--format", "json");

    expect(code).toBe(0);
    expect(JSON.parse(out).nodes[0].id).toBe("api");
  });

  it("finds compose files in subdirectories but skips node_modules", async () => {
    write("deploy/compose.yaml", "services:\n  api: {}\n");
    write("node_modules/pkg/docker-compose.yml", "services:\n  ignored: {}\n");
    const { out } = await cli("generate", "--format", "json");

    expect(JSON.parse(out).nodes.map((n: { id: string }) => n.id)).toEqual(["api"]);
  });

  it("fails with a clear message when there is nothing to read", async () => {
    const { code, err } = await cli("generate");

    expect(code).toBe(1);
    expect(err).toContain("no supported infrastructure files found");
  });

  it("reports malformed YAML instead of crashing", async () => {
    write("docker-compose.yml", "services: [");
    const { code, err } = await cli("generate");

    expect(code).toBe(1);
    expect(err).toContain("Invalid YAML in docker-compose.yml");
  });

  it("can render a full architecture document as Markdown", async () => {
    write("docker-compose.yml", "services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:16\n");
    const { code, out } = await cli("generate", "--format", "markdown");

    expect(code).toBe(0);
    expect(out).toContain("<!-- trazo-architecture -->");
    expect(out).toContain("```mermaid");
    expect(out).toContain("## Components");
    expect(out).toContain("`api` → `db`");
  });

  it("writes to a file instead of stdout with --out", async () => {
    write("docker-compose.yml", "services:\n  api: {}\n");
    const { code, out } = await cli("generate", "--format", "markdown", "--out", "ARCHITECTURE.md");

    expect(code).toBe(0);
    expect(out).toBe("");
    expect(readFileSync(join(dir, "ARCHITECTURE.md"), "utf8")).toContain("`api` (service)");
  });

  it("resolves --out against cwd, not against the scanned directory", async () => {
    write("deploy/docker-compose.yml", "services:\n  api: {}\n");
    const { code } = await cli("generate", "deploy", "--out", "ARCHITECTURE.md");

    expect(code).toBe(0);
    expect(existsSync(join(dir, "ARCHITECTURE.md"))).toBe(true);
    expect(existsSync(join(dir, "deploy", "ARCHITECTURE.md"))).toBe(false);
  });

  it("with --out, writes a file saying so instead of failing when nothing is found", async () => {
    const { code, err } = await cli("generate", "--format", "markdown", "--out", "ARCHITECTURE.md");

    expect(code).toBe(0);
    expect(err).toBe("");
    expect(readFileSync(join(dir, "ARCHITECTURE.md"), "utf8")).toContain(
      "No supported infrastructure files were found.",
    );
  });

  it("reads a SAM template and an Amplify backend found next to each other", async () => {
    write(
      "api/template.yaml",
      "Resources:\n  Table: { Type: \"AWS::DynamoDB::Table\" }\n  Fn:\n    Type: AWS::Lambda::Function\n    Properties: { Environment: { Variables: { T: !Ref Table } } }\n",
    );
    write(
      "app/amplify/backend/backend-config.json",
      JSON.stringify({ function: { checkout: { service: "Lambda", dependsOn: [{ category: "storage", resourceName: "orders" }] } }, storage: { orders: { service: "DynamoDB" } } }),
    );
    const { code, out } = await cli("generate", "--format", "json");

    expect(code).toBe(0);
    const model = JSON.parse(out) as { nodes: Array<{ name: string }>; edges: unknown[] };
    expect(model.nodes.map((n) => n.name).sort()).toEqual(["Fn", "Table", "checkout", "orders"]);
    expect(model.edges).toHaveLength(2);
  });

  it.each([
    [".aws-sam", ".aws-sam/packaged.yaml"],
    ["cdk.out", "cdk.out/Stack.template.json"],
    ["Amplify's copy of the deployed backend", "amplify/#current-cloud-backend/function/fn/fn-cloudformation-template.json"],
  ])("skips %s, which only duplicates the real templates", async (_label, path) => {
    write("template.yaml", "Resources:\n  Real: { Type: \"AWS::Lambda::Function\" }\n");
    write(path, JSON.stringify({ Resources: { Copy: { Type: "AWS::Lambda::Function" } } }));
    const { out } = await cli("generate", "--format", "json");

    expect(JSON.parse(out).nodes.map((n: { name: string }) => n.name)).toEqual(["Real"]);
  });

  it("can still scan a build directory when it is named explicitly", async () => {
    write("cdk.out/Stack.template.json", JSON.stringify({ Resources: { Copy: { Type: "AWS::Lambda::Function" } } }));
    const { out } = await cli("generate", "cdk.out", "--format", "json");

    expect(JSON.parse(out).nodes.map((n: { name: string }) => n.name)).toEqual(["Copy"]);
  });

  it("does not read data files too big to be a template", async () => {
    write("real.template.json", JSON.stringify({ Resources: { Real: { Type: "AWS::Lambda::Function" } } }));
    write("huge.json", JSON.stringify({ Resources: { Huge: { Type: "AWS::Lambda::Function" } }, padding: "x".repeat(2_100_000) }));
    const { out } = await cli("generate", "--format", "json");

    expect(JSON.parse(out).nodes.map((n: { name: string }) => n.name)).toEqual(["Real"]);
  });

  it("rejects an unknown format", async () => {
    write("docker-compose.yml", "services:\n  api: {}\n");
    const { code, err } = await cli("generate", "--format", "yaml");

    expect(code).toBe(1);
    expect(err).toContain('unknown format "yaml"');
  });
});

describe("trazo diff", () => {
  it("reports what changed since a git revision", async () => {
    git("init", "-q", "-b", "main");
    write("docker-compose.yml", "services:\n  api: {}\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");

    write("docker-compose.yml", "services:\n  api:\n    depends_on: [cache]\n  cache:\n    image: redis:7\n");
    const { code, out } = await cli("diff", "--base", "main");

    expect(code).toBe(0);
    expect(out).toContain("### Added components");
    expect(out).toContain("`cache`");
    expect(out).toContain("`api` → `cache`");
  });

  it("reports every component as added when the base has no compose file", async () => {
    git("init", "-q", "-b", "main");
    write("README.md", "# nothing to see\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");

    write("docker-compose.yml", "services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:16\n");
    const { code, out } = await cli("diff", "--base", "main");

    expect(code).toBe(0);
    expect(out).toContain("### Added components");
    expect(out).toContain("`api`");
    expect(out).toContain("`db` (database, `postgres:16`)");
    expect(out).toContain("`api` → `db`");
    expect(out).not.toContain("Removed");
  });

  it("reports every component as added when the base commit is empty", async () => {
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "empty base");

    write("docker-compose.yml", "services:\n  api: {}\n");
    const { code, out } = await cli("diff", "--base", "main");

    expect(code).toBe(0);
    expect(out).toContain("`api`");
  });

  it("requires --base", async () => {
    const { code, err } = await cli("diff");

    expect(code).toBe(1);
    expect(err).toContain("--base");
  });

  it("explains how to fix an unknown revision", async () => {
    git("init", "-q", "-b", "main");
    const { code, err } = await cli("diff", "--base", "does-not-exist");

    expect(code).toBe(1);
    expect(err).toContain('Could not read git revision "does-not-exist"');
    expect(err).toContain("fetch-depth: 0");
  });
});

describe("trazo bitbucket-comment", () => {
  it("does nothing outside a pull request build", async () => {
    const { code, out, err } = await cli("bitbucket-comment");

    expect(code).toBe(0);
    expect(out).toContain("Not a pull request build");
    expect(err).toBe("");
  });

  it("reports a missing token as a failure with a clear message", async () => {
    vars = { BITBUCKET_PR_ID: "7" };
    const { code, err } = await cli("bitbucket-comment");

    expect(code).toBe(1);
    expect(err).toContain("TRAZO_BITBUCKET_TOKEN");
  });
});

describe("trazo", () => {
  it("prints help and rejects unknown commands", async () => {
    const help = (await cli("--help")).out;
    expect(help).toContain("Usage:");
    expect(help).toContain("bitbucket-comment");
    expect((await cli("nope")).code).toBe(1);
  });
});

describe("trazo.config.yaml", () => {
  const compose = "services:\n  api:\n    depends_on: [files]\n  files:\n    image: minio/minio\n";

  it("writes the document to .trazo/architecture.md with --write, without any config", async () => {
    write("docker-compose.yml", compose);
    const { code, out } = await cli("generate", "--write");

    expect(code).toBe(0);
    expect(out).toBe("");
    expect(readFileSync(join(dir, ".trazo", "architecture.md"), "utf8")).toContain("<!-- trazo-architecture -->");
  });

  it("writes where output.dir and output.file say, relative to the scanned directory", async () => {
    write("app/docker-compose.yml", compose);
    write("app/trazo.config.yaml", "output:\n  dir: docs/arch\n  file: system.md\n");
    const { code } = await cli("generate", "app", "--write");

    expect(code).toBe(0);
    expect(existsSync(join(dir, "app", "docs", "arch", "system.md"))).toBe(true);
    expect(existsSync(join(dir, ".trazo"))).toBe(false);
  });

  it("does not let --write be mixed with --out or another format", async () => {
    write("docker-compose.yml", compose);
    expect((await cli("generate", "--write", "--out", "x.md")).code).toBe(1);
    expect((await cli("generate", "--write", "--format", "json")).err).toContain("--write always writes the Markdown");
    expect((await cli("generate", "--write", "--format", "markdown")).code).toBe(0);
  });

  it("with --write, writes a document saying so instead of failing when nothing is found", async () => {
    const { code } = await cli("generate", "--write");

    expect(code).toBe(0);
    expect(readFileSync(join(dir, ".trazo", "architecture.md"), "utf8")).toContain("No supported infrastructure files");
  });

  it("applies the extractor rules and the kind styles", async () => {
    write("docker-compose.yml", compose);
    write(
      "trazo.config.yaml",
      "kinds:\n  storage:\n    shape: hexagon\n    stroke: '#112233'\nextractors:\n  docker-compose:\n    minio: storage\n",
    );
    const { out } = await cli("generate");

    expect(out).toContain('n_files{{"files"}}');
    expect(out).toContain("classDef kind_storage fill:#f3f4f6,stroke:#112233");
  });

  it("also reads trazo.config.yml", async () => {
    write("docker-compose.yml", compose);
    write("trazo.config.yml", "extractors:\n  docker-compose:\n    minio: ignore\n");

    expect((await cli("generate", "--format", "json")).out).not.toContain("files");
  });

  it("uses the file named by --config, resolved against the scanned directory", async () => {
    write("docker-compose.yml", compose);
    write("ci/trazo.yaml", "extractors:\n  docker-compose:\n    minio: ignore\n");

    expect((await cli("generate", "--format", "json", "--config", "ci/trazo.yaml")).out).not.toContain("files");
    const missing = await cli("generate", "--config", "nope.yaml");
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("Config file not found: nope.yaml");
  });

  it("reports an invalid config instead of guessing", async () => {
    write("docker-compose.yml", compose);
    write("trazo.config.yaml", "extractors:\n  terraform: {}\n");
    const { code, err } = await cli("generate");

    expect(code).toBe(1);
    expect(err).toContain('Invalid config trazo.config.yaml: unknown extractor "terraform"');
  });

  it("applies the same config to both sides of a diff, so changing it is not an architecture change", async () => {
    git("init", "-q", "-b", "main");
    write("docker-compose.yml", compose);
    write("trazo.config.yaml", "extractors:\n  docker-compose:\n    minio: ignore\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");

    write("trazo.config.yaml", "extractors:\n  docker-compose:\n    minio: storage\nkinds:\n  storage: {}\n");
    const { out } = await cli("diff", "--base", "main");
    expect(out).toContain("No architecture changes detected.");
  });

  it("does not treat the config file as infrastructure", async () => {
    write("trazo.config.yaml", "kinds:\n  storage: {}\n");
    const { code, err } = await cli("generate");

    expect(code).toBe(1);
    expect(err).toContain("no supported infrastructure files found");
  });

  const SERVICE = "services:\n  api: {}\n";

  it.each([
    [["generate", "--write"], ".trazo/architecture.md", "trazo generate --write"],
    [["generate", "app", "--write"], "app/.trazo/architecture.md", "trazo generate app --write"],
    [["generate", "--write", "--config", "ci/trazo.yaml"], ".trazo/architecture.md", "trazo generate --write --config ci/trazo.yaml"],
    [["generate", "--format", "markdown", "--out", "docs/arq.md"], "docs/arq.md", "trazo generate --format markdown --out docs/arq.md"],
    [["generate", "app", "--format", "markdown", "--out", "my docs/a.md"], "my docs/a.md", 'trazo generate app --format markdown --out "my docs/a.md"'],
  ])("names the command that rewrites the document it wrote: %j", async (args, file, command) => {
    write("docker-compose.yml", SERVICE);
    write("app/docker-compose.yml", SERVICE);
    write("ci/trazo.yaml", "");
    expect((await cli(...args)).code).toBe(0);

    expect(readFileSync(join(dir, file), "utf8")).toContain(`regenerate it with \`${command}\`.`);
  });

  it("names the command when the document is printed instead of written", async () => {
    write("docker-compose.yml", SERVICE);
    const { out } = await cli("generate", "--format", "markdown");

    expect(out).toContain("regenerate it with `trazo generate --format markdown`.");
  });
});
