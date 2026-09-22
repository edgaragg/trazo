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
        "  classDef kind_service stroke:#2a78d6,stroke-width:2px",
        "  class n_web kind_service",
        "  classDef kind_database stroke:#eb6834,stroke-width:2px",
        "  class n_db kind_database",
        "  classDef kind_cache stroke:#1baf7a,stroke-width:2px",
        "  class n_cache kind_cache",
        "  classDef kind_queue stroke:#eda100,stroke-width:2px",
        "  class n_queue kind_queue",
      ].join("\n"),
    );
  });

  it("groups every component of a kind into one class statement", () => {
    const output = toMermaid({
      nodes: [
        { id: "a", name: "a", kind: "service", ...base },
        { id: "b", name: "b", kind: "service", ...base },
      ],
      edges: [],
    });
    expect(output).toContain("classDef kind_service stroke:#2a78d6,stroke-width:2px");
    expect(output).toContain("class n_a,n_b kind_service");
    // One classDef per kind, not one per node.
    expect(output.match(/classDef kind_service/g)).toHaveLength(1);
  });

  it("only defines a class for kinds that are actually present", () => {
    const output = toMermaid({ nodes: [{ id: "a", name: "a", kind: "service", ...base }], edges: [] });
    expect(output).toContain("kind_service");
    expect(output).not.toMatch(/kind_(database|cache|queue)/);
  });

  it("colours an added component green instead of its kind, without dropping the shape", () => {
    const output = toMermaid(
      {
        nodes: [
          { id: "a", name: "a", kind: "database", ...base },
          { id: "b", name: "b", kind: "database", ...base },
        ],
        edges: [],
      },
      { added: new Set(["a"]) },
    );
    // "a" is added: no kind_database class for it, only "added".
    expect(output).toContain("class n_a added");
    expect(output).not.toContain("kind_database stroke:#eb6834,stroke-width:2px\n  class n_a");
    // "b" is unaffected: still coloured by kind, and still a cylinder.
    expect(output).toContain('n_b[("b")]');
    expect(output).toContain("class n_b kind_database");
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
