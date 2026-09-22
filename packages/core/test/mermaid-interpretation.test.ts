// @vitest-environment jsdom
import mermaid from "mermaid";
import { beforeAll, describe, expect, it } from "vitest";
import {
  diffModels,
  extractModel,
  renderDiffMarkdown,
  toMermaid,
  type ArchitectureModel,
  type NodeKind,
} from "../src/index.js";

// mermaid.test.ts compares strings, which only proves we emit what we meant to emit.
// These tests hand the output to Mermaid's own parser, the one GitHub uses, and check what
// Mermaid understood: which components, which shapes, which links and which labels.

const source = "docker-compose.yml";

/** Shape names Mermaid reports for each kind of component we draw. */
const SHAPE: Record<NodeKind, string> = {
  service: "square",
  database: "cylinder",
  cache: "stadium",
  queue: "odd",
};

interface Interpreted {
  vertices: Array<{ id: string; type: string; text: string; classes: string[] }>;
  edges: Array<{ start: string; end: string }>;
}

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false });
});

/** Parses a diagram and returns what Mermaid understood. Rejects if the syntax is invalid. */
async function interpret(text: string): Promise<Interpreted> {
  await mermaid.parse(text);
  const { db } = await mermaid.mermaidAPI.getDiagramFromText(text);
  const flowchart = db as unknown as {
    getVertices(): Map<string, Interpreted["vertices"][number]>;
    getEdges(): Interpreted["edges"];
  };
  return { vertices: [...flowchart.getVertices().values()], edges: flowchart.getEdges() };
}

const model = (names: string[], kind: NodeKind = "service"): ArchitectureModel => ({
  nodes: names.map((name) => ({ id: name, name, kind, source })),
  edges: names.slice(1).map((name) => ({ from: names[0]!, to: name })),
});

describe("Mermaid understands what toMermaid produces", () => {
  it("rejects invalid syntax, so the checks below can fail", async () => {
    await expect(interpret("flowchart LR\n  a[[[ --> ")).rejects.toThrow();
  });

  it.each(Object.keys(SHAPE) as NodeKind[])("draws a %s with its own shape", async (kind) => {
    const { vertices } = await interpret(toMermaid(model(["a"], kind)));

    expect(vertices).toHaveLength(1);
    expect(vertices[0]?.type).toBe(SHAPE[kind]);
  });

  it("keeps every component, label and link", async () => {
    const architecture: ArchitectureModel = {
      nodes: [
        { id: "web", name: "web", kind: "service", source },
        { id: "db", name: "db", kind: "database", source },
        { id: "cache", name: "cache", kind: "cache", source },
        { id: "queue", name: "queue", kind: "queue", source },
      ],
      edges: [
        { from: "web", to: "db" },
        { from: "web", to: "cache" },
        { from: "web", to: "queue" },
      ],
    };
    const { vertices, edges } = await interpret(toMermaid(architecture));

    const labelOf = new Map(vertices.map((vertex) => [vertex.id, vertex.text]));
    expect(vertices.map((vertex) => vertex.text).sort()).toEqual(["cache", "db", "queue", "web"]);
    expect(edges.map((edge) => `${labelOf.get(edge.start)}>${labelOf.get(edge.end)}`).sort()).toEqual([
      "web>cache",
      "web>db",
      "web>queue",
    ]);
  });

  it("accepts a model without components", async () => {
    const { vertices, edges } = await interpret(toMermaid({ nodes: [], edges: [] }));
    expect(vertices).toEqual([]);
    expect(edges).toEqual([]);
  });

  // Names come straight from user files, so they can contain whatever the source format allows.
  it.each([
    "my-service",
    "api.v2",
    "my service",
    "3scale",
    "señal-ñandú",
    "end",
    "graph",
    "it's",
    "svc[1]",
    "svc(1)",
    "svc{1}",
    "a|b",
    "a;b",
    "a%%b",
    "svc#1",
    "a&b",
    "a:b",
  ])("shows the component name %j unchanged", async (name) => {
    for (const kind of Object.keys(SHAPE) as NodeKind[]) {
      const { vertices } = await interpret(toMermaid(model([name], kind)));
      expect(vertices.map((vertex) => vertex.text)).toEqual([name]);
    }
  });

  it("never leaves a component with an empty label", async () => {
    for (const name of ['say "hi"', "<svc>", "a<b>c", '"quoted"', "a-->b"]) {
      const { vertices } = await interpret(toMermaid(model([name])));
      expect(vertices[0]?.text, name).toBeTruthy();
    }
  });

  it("keeps quotes and angle brackets that Mermaid would otherwise drop", async () => {
    // Without escaping, Mermaid does not fail: it silently shows `say hi` and an empty label.
    const unescaped = await interpret('flowchart LR\n  n_a["say "hi""]\n  n_b["<svc>"]');
    expect(unescaped.vertices.map((vertex) => vertex.text)).toEqual(["say hi", ""]);

    const escaped = await interpret(toMermaid(model(['say "hi"', "<svc>"])));
    const texts = escaped.vertices.map((vertex) => vertex.text);
    expect(texts[0]).not.toBe("say hi");
    expect(texts[1]).toContain("svc");
  });

  it("gives colliding names their own components", async () => {
    const { vertices } = await interpret(toMermaid(model(["a-b", "a_b", "a.b"])));

    expect(vertices).toHaveLength(3);
    expect(vertices.map((vertex) => vertex.text).sort()).toEqual(["a-b", "a.b", "a_b"]);
  });

  it("marks only the added components", async () => {
    const { vertices } = await interpret(toMermaid(model(["a", "b"]), { added: new Set(["a"]) }));

    expect(vertices.find((vertex) => vertex.text === "a")?.classes).toContain("added");
    expect(vertices.find((vertex) => vertex.text === "b")?.classes).not.toContain("added");
  });

  it.each(Object.keys(SHAPE) as NodeKind[])("classes a %s with its own kind_%s class", async (kind) => {
    const { vertices } = await interpret(toMermaid(model(["a", "b"], kind)));

    for (const vertex of vertices) expect(vertex.classes).toEqual([`kind_${kind}`]);
  });

  it("classes an added component as added instead of by its kind", async () => {
    const { vertices } = await interpret(
      toMermaid(model(["a", "b"], "database"), { added: new Set(["a"]) }),
    );

    const a = vertices.find((vertex) => vertex.text === "a");
    const b = vertices.find((vertex) => vertex.text === "b");
    expect(a?.classes).toEqual(["added"]);
    expect(b?.classes).toEqual(["kind_database"]);
  });

  it("understands the diagram inside a diff report", async () => {
    const before = extractModel([{ path: source, content: "services:\n  api: {}\n" }]);
    const after = extractModel([
      {
        path: source,
        content: "services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:16\n",
      },
    ]);
    const report = renderDiffMarkdown(diffModels(before, after), after);
    const diagram = /```mermaid\n([\s\S]*?)\n```/.exec(report)?.[1];

    expect(diagram).toBeDefined();
    const { vertices, edges } = await interpret(diagram!);
    expect(vertices.map((vertex) => `${vertex.text}:${vertex.type}`).sort()).toEqual([
      "api:square",
      "db:cylinder",
    ]);
    expect(edges).toHaveLength(1);
  });
});
