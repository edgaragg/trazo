import { describe, expect, it } from "vitest";
import { ARCHITECTURE_MARKER, extractModel, renderArchitectureMarkdown, type SourceFile } from "../src/index.js";

const compose = (content: string): SourceFile => ({ path: "docker-compose.yml", content });

describe("renderArchitectureMarkdown", () => {
  it("starts with the marker and says so when there is nothing to draw", () => {
    const doc = renderArchitectureMarkdown({ nodes: [], edges: [] });

    expect(doc.startsWith(ARCHITECTURE_MARKER)).toBe(true);
    expect(doc).toContain("No supported infrastructure files were found.");
    expect(doc).not.toContain("mermaid");
  });

  it("lists every component and dependency alongside the diagram", () => {
    const model = extractModel([
      compose("services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:16\n"),
    ]);
    const doc = renderArchitectureMarkdown(model);

    expect(doc).toContain("```mermaid");
    expect(doc).toContain("## Components");
    expect(doc).toContain("`api` (service)");
    expect(doc).toContain("`db` (database, `postgres:16`)");
    expect(doc).toContain("## Dependencies");
    expect(doc).toContain("`api` → `db`");
  });

  it("omits the Dependencies section when there are no edges", () => {
    const model = extractModel([compose("services:\n  api: {}\n")]);
    const doc = renderArchitectureMarkdown(model);

    expect(doc).toContain("## Components");
    expect(doc).not.toContain("## Dependencies");
  });

  it("tells the reader which command regenerates the file, when it is given one", () => {
    const doc = renderArchitectureMarkdown({ nodes: [], edges: [] }, { command: "trazo generate --write" });
    expect(doc).toContain("regenerate it with `trazo generate --write`.");
    expect(doc).not.toContain("ARCHITECTURE.md");
  });

  it("falls back to the default command when the given one would break the Markdown", () => {
    const doc = renderArchitectureMarkdown({ nodes: [], edges: [] }, { command: "trazo generate --out a`b" });
    expect(doc).toContain("--out ARCHITECTURE.md");
  });
});
