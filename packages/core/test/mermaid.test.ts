import { describe, expect, it } from "vitest";
import { toMermaid, type ArchitectureModel } from "../src/index.js";

const base = { source: "docker-compose.yml" };

describe("toMermaid", () => {
  it("draws each kind of component with its own shape", () => {
    const model: ArchitectureModel = {
      nodes: [
        { id: "web", name: "web", kind: "service", ...base },
        { id: "db", name: "db", kind: "database", ...base },
        { id: "cache", name: "cache", kind: "cache", ...base },
        { id: "queue", name: "queue", kind: "queue", ...base },
      ],
      edges: [
        { from: "web", to: "db" },
        { from: "web", to: "cache" },
        { from: "web", to: "queue" },
      ],
    };

    expect(toMermaid(model)).toBe(
      [
        "flowchart LR",
        '  n_web["web"]',
        '  n_db[("db")]',
        '  n_cache(["cache"])',
        '  n_queue>"queue"]',
        "  n_web --> n_db",
        "  n_web --> n_cache",
        "  n_web --> n_queue",
      ].join("\n"),
    );
  });

  it("keeps identifiers unique when names collapse to the same text", () => {
    const output = toMermaid({
      nodes: [
        { id: "a-b", name: "a-b", kind: "service", ...base },
        { id: "a_b", name: "a_b", kind: "service", ...base },
      ],
      edges: [],
    });

    expect(output).toContain('n_a_b["a-b"]');
    expect(output).toContain('n_a_b_2["a_b"]');
  });

  it("escapes quotes in labels", () => {
    const output = toMermaid({
      nodes: [{ id: "x", name: 'say "hi"', kind: "service", ...base }],
      edges: [],
    });
    expect(output).toContain('n_x["say #quot;hi#quot;"]');
  });

  it("escapes angle brackets so they are not read as HTML", () => {
    const output = toMermaid({
      nodes: [{ id: "x", name: "<svc>", kind: "service", ...base }],
      edges: [],
    });
    expect(output).toContain('n_x["#lt;svc#gt;"]');
  });

  it("skips dependencies that point at unknown components", () => {
    const output = toMermaid({
      nodes: [{ id: "a", name: "a", kind: "service", ...base }],
      edges: [{ from: "a", to: "missing" }],
    });
    expect(output).not.toContain("-->");
  });

  it("highlights added components", () => {
    const output = toMermaid(
      { nodes: [{ id: "a", name: "a", kind: "service", ...base }], edges: [] },
      { added: new Set(["a"]) },
    );
    expect(output).toContain("classDef added");
    expect(output).toContain("class n_a added");
  });
});
