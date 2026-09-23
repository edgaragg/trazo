import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../src/index.js";

const parse = (yaml: string) => parseConfig(yaml, "trazo.config.yaml");

describe("parseConfig", () => {
  it("gives the defaults for an empty file, and never shares them between calls", () => {
    expect(parse("")).toEqual(DEFAULT_CONFIG);
    expect(parse("# only a comment\n")).toEqual(DEFAULT_CONFIG);
    parse("").output.dir = "changed";
    expect(parse("").output.dir).toBe(".trazo");
  });

  it("defaults the output to .trazo/architecture.md", () => {
    expect(DEFAULT_CONFIG.output).toEqual({ dir: ".trazo", file: "architecture.md" });
  });

  it("reads every section", () => {
    const config = parse(`
output:
  dir: docs/architecture/
  file: system.md
kinds:
  storage:
    shape: cylinder
    stroke: "#112233"
    fill: "#eee"
  database:
    fill: "#ffffff"
extractors:
  cloudformation:
    "AWS::S3::Bucket": storage
    "AWS::Logs::*": ignore
  docker-compose:
    minio: storage
`);
    expect(config.output).toEqual({ dir: "docs/architecture", file: "system.md" });
    expect(config.kinds).toEqual({
      storage: { shape: "cylinder", stroke: "#112233", fill: "#eee" },
      database: { fill: "#ffffff" },
    });
    expect(config.extractors).toEqual({
      cloudformation: { "AWS::S3::Bucket": "storage", "AWS::Logs::*": "ignore" },
      "docker-compose": { minio: "storage" },
    });
  });

  it("accepts sections and entries with nothing in them", () => {
    expect(parse("output:\nkinds:\nextractors:\n").kinds).toEqual({});
    expect(parse("kinds:\n  storage:\n").kinds).toEqual({ storage: {} });
    expect(parse("extractors:\n  kubernetes:\n").extractors).toEqual({ kubernetes: {} });
  });

  it.each([
    ["is not a mapping", "- a\n- b\n", "expected a mapping"],
    ["is not YAML", "key: [unclosed\n", "Invalid config trazo.config.yaml"],
    ["has an unknown key", "outptu: {}\n", 'unknown key "outptu"'],
    ["has an unknown output key", "output:\n  folder: x\n", 'unknown key "output.folder"'],
    ["puts output.dir outside the project", "output:\n  dir: ../out\n", "inside the project"],
    ["gives an absolute output.dir", "output:\n  dir: /var/out\n", "inside the project"],
    ["gives a Windows absolute output.dir", "output:\n  dir: 'C:\out'\n", "inside the project"],
    ["gives an empty output.dir", 'output:\n  dir: ""\n', "inside the project"],
    ["gives output.file a directory", "output:\n  file: docs/a.md\n", "without a directory"],
    ["gives kinds as a list", "kinds: [a]\n", '"kinds" must be a mapping'],
    ["names a kind badly", 'kinds:\n  "a b":\n    shape: circle\n', "must start with a letter"],
    ["uses an unknown shape", "kinds:\n  a:\n    shape: blob\n", "shape"],
    ["uses a colour that is not hex", 'kinds:\n  a:\n    stroke: "red"\n', "hex colour"],
    ["tries to smuggle Mermaid into a colour", 'kinds:\n  a:\n    fill: "#fff;stroke:red"\n', "hex colour"],
    ["has an unknown style key", "kinds:\n  a:\n    color: '#fff'\n", 'unknown key "kinds.a.color"'],
    ["names an unknown extractor", "extractors:\n  terraform: {}\n", 'unknown extractor "terraform"'],
    ["maps to an undefined kind", "extractors:\n  amplify:\n    Lambda: storage\n", "must be ignore, a built-in kind"],
    ["maps to something that is not a name", "extractors:\n  amplify:\n    Lambda: [a]\n", "must be ignore"],
  ])("rejects a file that %s", (_label, yaml, message) => {
    expect(() => parse(yaml)).toThrow(message);
  });

  it("names the file in every error", () => {
    expect(() => parseConfig("nope: 1", "docs/trazo.config.yml")).toThrow(/Invalid config docs\/trazo\.config\.yml/);
  });

  it("accepts a kind defined in the same file, whatever the order of the sections", () => {
    const config = parse("extractors:\n  amplify:\n    Lambda: worker\nkinds:\n  worker: {}\n");
    expect(config.extractors["amplify"]).toEqual({ Lambda: "worker" });
  });
});
