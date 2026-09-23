// @vitest-environment jsdom
import mermaid from "mermaid";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SHAPES,
  diffModels,
  renderArchitectureMarkdown,
  renderDiffMarkdown,
  toMermaid,
  type ArchitectureModel,
} from "../src/index.js";

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false });
});

const one = (kind: string): ArchitectureModel => ({
  nodes: [{ id: "a", name: "a", kind, source: "x" }],
  edges: [],
});

async function shapeOf(text: string) {
  await mermaid.parse(text);
  const { db } = await mermaid.mermaidAPI.getDiagramFromText(text);
  const vertices = (db as unknown as { getVertices(): Map<string, { type: string; text: string }> }).getVertices();
  return [...vertices.values()][0]!;
}

describe("toMermaid with kind styles", () => {
  it("draws every configurable shape, each one Mermaid understands and keeps the label of", async () => {
    const seen = new Set<string>();
    for (const shape of SHAPES) {
      const vertex = await shapeOf(toMermaid(one("custom"), { kinds: { custom: { shape } } }));
      expect(vertex.text).toBe("a");
      seen.add(vertex.type);
    }
    expect(seen.size).toBe(SHAPES.length);
  });

  it("changes only what the entry says for a built-in kind", () => {
    const text = toMermaid(one("database"), { kinds: { database: { stroke: "#123456" } } });
    expect(text).toContain('n_a[("a")]');
    expect(text).toContain("fill:#fdede7,stroke:#123456");
  });

  it("draws a custom kind, defined or not, in a neutral style of its own", () => {
    const text = toMermaid(one("storage"));
    expect(text).toContain('n_a["a"]');
    expect(text).toContain("classDef kind_storage fill:#f3f4f6,stroke:#6b7280");
    expect(text).toContain("class n_a kind_storage");
  });

  it("uses the styles given for a custom kind", () => {
    const text = toMermaid(one("storage"), { kinds: { storage: { shape: "hexagon", stroke: "#000000", fill: "#ffffff" } } });
    expect(text).toContain('n_a{{"a"}}');
    expect(text).toContain("classDef kind_storage fill:#ffffff,stroke:#000000");
  });

  it("keeps built-in kinds first and custom kinds alphabetical, so the output is stable", () => {
    const model: ArchitectureModel = {
      nodes: ["zeta", "alpha", "queue", "service"].map((kind) => ({ id: kind, name: kind, kind, source: "x" })),
      edges: [],
    };
    const classes = toMermaid(model)
      .split("\n")
      .filter((line) => line.includes("classDef"))
      .map((line) => line.split(" ")[3]);
    expect(classes).toEqual(["kind_service", "kind_queue", "kind_alpha", "kind_zeta"]);
  });

  it("is passed through by the architecture document and the diff report", () => {
    const kinds = { storage: { fill: "#abcdef" } };
    expect(renderArchitectureMarkdown(one("storage"), kinds)).toContain("fill:#abcdef");
    // The component is unchanged, so it is drawn by its kind rather than as added.
    const same = one("storage");
    expect(renderDiffMarkdown(diffModels(same, same), same, kinds)).toContain("No architecture changes");
    const after: ArchitectureModel = { nodes: [...same.nodes, { id: "b", name: "b", kind: "storage", source: "x" }], edges: [] };
    expect(renderDiffMarkdown(diffModels(same, after), after, kinds)).toContain("fill:#abcdef");
  });
});
