import { describe, expect, it } from "vitest";
import { diffModels, isEmptyDiff, type ArchitectureModel } from "../src/index.js";

const node = (id: string, extra: Partial<ArchitectureModel["nodes"][number]> = {}) => ({
  id,
  name: id,
  kind: "service" as const,
  source: "docker-compose.yml",
  ...extra,
});

const before: ArchitectureModel = {
  nodes: [node("api"), node("db", { kind: "database", image: "postgres:15" })],
  edges: [{ from: "api", to: "db" }],
};

describe("diffModels", () => {
  it("reports no changes for identical models", () => {
    expect(isEmptyDiff(diffModels(before, before))).toBe(true);
  });

  it("detects added and removed components and dependencies", () => {
    const after: ArchitectureModel = {
      nodes: [node("api"), node("cache", { kind: "cache" }), node("db", { kind: "database", image: "postgres:15" })],
      edges: [{ from: "api", to: "cache" }],
    };
    const diff = diffModels(before, after);

    expect(diff.addedNodes.map((n) => n.id)).toEqual(["cache"]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.addedEdges).toEqual([{ from: "api", to: "cache" }]);
    expect(diff.removedEdges).toEqual([{ from: "api", to: "db" }]);
  });

  it("detects a changed image", () => {
    const after: ArchitectureModel = {
      ...before,
      nodes: [node("api"), node("db", { kind: "database", image: "postgres:16" })],
    };
    const diff = diffModels(before, after);

    expect(diff.changedNodes).toHaveLength(1);
    expect(diff.changedNodes[0]?.after.image).toBe("postgres:16");
  });

  it("does not treat a component moving to another file as a change", () => {
    const after: ArchitectureModel = {
      ...before,
      nodes: [node("api", { source: "deploy/compose.yml" }), before.nodes[1]!],
    };
    expect(isEmptyDiff(diffModels(before, after))).toBe(true);
  });
});
