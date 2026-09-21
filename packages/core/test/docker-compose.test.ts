import { describe, expect, it } from "vitest";
import { dockerComposeExtractor, extractModel } from "../src/index.js";

const compose = (content: string, path = "docker-compose.yml") => ({ path, content });

describe("dockerComposeExtractor", () => {
  it.each([
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "docker-compose.prod.yml",
    "deploy/compose.override.yaml",
  ])("matches %s", (path) => {
    expect(dockerComposeExtractor.matches(path)).toBe(true);
  });

  it.each(["package.json", "docker-compose.txt", "my-compose-notes.yml", "Dockerfile"])(
    "ignores %s",
    (path) => {
      expect(dockerComposeExtractor.matches(path)).toBe(false);
    },
  );

  it("turns services into components and depends_on into dependencies", () => {
    const model = dockerComposeExtractor.extract(
      compose(`
services:
  api:
    build: .
    depends_on: [db]
  db:
    image: postgres:16
`),
    );

    expect(model.nodes).toEqual([
      { id: "api", name: "api", kind: "service", source: "docker-compose.yml" },
      { id: "db", name: "db", kind: "database", source: "docker-compose.yml", image: "postgres:16" },
    ]);
    expect(model.edges).toEqual([{ from: "api", to: "db", label: "depends_on" }]);
  });

  it("reads depends_on written as a map and links with aliases", () => {
    const model = dockerComposeExtractor.extract(
      compose(`
services:
  api:
    depends_on:
      db: { condition: service_healthy }
    links:
      - cache:redis
`),
    );

    expect(model.edges).toEqual([
      { from: "api", to: "db", label: "depends_on" },
      { from: "api", to: "cache", label: "links" },
    ]);
  });

  it.each([
    ["postgres:16", "database"],
    ["docker.io/library/mysql:8", "database"],
    ["redis:7-alpine", "cache"],
    ["bitnami/kafka:3.7", "queue"],
    ["rabbitmq:3-management", "queue"],
    ["ghcr.io/acme/backend:1.2", "service"],
  ])("classifies image %s as %s", (image, kind) => {
    const [node] = dockerComposeExtractor.extract(
      compose(`services:\n  thing:\n    image: ${image}\n`),
    ).nodes;
    expect(node?.kind).toBe(kind);
  });

  it("returns an empty model for YAML that is not a compose file", () => {
    expect(dockerComposeExtractor.extract(compose("name: example\n"))).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("names the file when the YAML is malformed", () => {
    expect(() => dockerComposeExtractor.extract(compose("services: [", "bad/compose.yml"))).toThrow(
      /Invalid YAML in bad\/compose\.yml/,
    );
  });
});

describe("extractModel", () => {
  it("sorts its output and ignores files no extractor understands", () => {
    const model = extractModel([
      compose("services:\n  b: {}\n  a:\n    depends_on: [b]\n"),
      { path: "README.md", content: "# not a compose file" },
    ]);

    expect(model.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(model.edges).toEqual([{ from: "a", to: "b", label: "depends_on" }]);
  });

  it("lets a later file override a component defined earlier", () => {
    const model = extractModel([
      compose("services:\n  db:\n    image: postgres:15\n", "docker-compose.yml"),
      compose("services:\n  db:\n    image: postgres:16\n", "docker-compose.override.yml"),
    ]);

    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0]?.image).toBe("postgres:16");
  });

  it("drops dependencies on components that are not defined", () => {
    const model = extractModel([compose("services:\n  api:\n    depends_on: [ghost]\n")]);
    expect(model.edges).toEqual([]);
  });

  it("keeps one dependency when depends_on and links declare the same pair", () => {
    const model = extractModel([
      compose("services:\n  a:\n    depends_on: [b]\n    links: [b]\n  b: {}\n"),
    ]);
    expect(model.edges).toEqual([{ from: "a", to: "b", label: "depends_on" }]);
  });
});
