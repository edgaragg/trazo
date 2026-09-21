import { describe, expect, it } from "vitest";
import {
  diffModels,
  extractModel,
  renderDiffMarkdown,
  REPORT_MARKER,
  type SourceFile,
} from "../src/index.js";

const compose = (content: string): SourceFile => ({ path: "docker-compose.yml", content });

describe("renderDiffMarkdown", () => {
  it("starts with the marker and reports when nothing changed", () => {
    const model = extractModel([compose("services:\n  api: {}\n")]);
    const report = renderDiffMarkdown(diffModels(model, model), model);

    expect(report.startsWith(REPORT_MARKER)).toBe(true);
    expect(report).toContain("No architecture changes detected.");
    expect(report).not.toContain("mermaid");
  });

  it("lists every kind of change and draws the resulting architecture", () => {
    const before = extractModel([
      compose("services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:15\n  old: {}\n"),
    ]);
    const after = extractModel([
      compose("services:\n  api:\n    depends_on: [cache]\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7\n"),
    ]);
    const report = renderDiffMarkdown(diffModels(before, after), after);

    expect(report).toContain("### Added components");
    expect(report).toContain("`cache` (cache, `redis:7`)");
    expect(report).toContain("### Removed components");
    expect(report).toContain("`old` (service)");
    expect(report).toContain("`db`: image `postgres:15` → `postgres:16`");
    expect(report).toContain("`api` → `cache`");
    expect(report).toContain("### Removed dependencies");
    expect(report).toContain("```mermaid");
    expect(report).toContain("class n_cache added");
  });
});
