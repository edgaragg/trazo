import { isEmptyDiff, type ModelDiff } from "./diff.js";
import { code, describeNode } from "./markdown.js";
import { toMermaid } from "./mermaid.js";
import type { ArchitectureModel } from "./model.js";

/**
 * Hidden marker placed at the top of every report. Integrations use it to find
 * their previous comment and update it instead of posting a new one.
 */
export const REPORT_MARKER = "<!-- trazo-report -->";

function section(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : [`### ${title}`, "", ...items.map((item) => `- ${item}`), ""];
}

/**
 * Renders a diff as a Markdown report, ready to post as a pull request comment.
 *
 * The report always starts with {@link REPORT_MARKER}. When something changed it
 * lists the changes and draws the resulting architecture, with new components
 * highlighted.
 *
 * @param diff - Changes to describe.
 * @param after - Model of the revision being reviewed, drawn as the diagram.
 */
export function renderDiffMarkdown(diff: ModelDiff, after: ArchitectureModel): string {
  const lines = [REPORT_MARKER, "## Trazo: architecture changes", ""];

  if (isEmptyDiff(diff)) {
    lines.push("No architecture changes detected.");
    return lines.join("\n");
  }

  // Dependencies name components by id, which can be a path or namespace; show the name a reader knows.
  const names = new Map([...diff.removedNodes, ...after.nodes].map((node) => [node.id, node.name]));
  const label = (id: string) => code(names.get(id) ?? id);

  lines.push(
    ...section("Added components", diff.addedNodes.map(describeNode)),
    ...section("Removed components", diff.removedNodes.map(describeNode)),
    ...section(
      "Changed components",
      diff.changedNodes.map(({ before, after: next }) => {
        const image =
          before.image !== next.image
            ? `image ${code(before.image ?? "none")} → ${code(next.image ?? "none")}`
            : undefined;
        const type =
          before.type !== next.type
            ? `type ${code(before.type ?? "none")} → ${code(next.type ?? "none")}`
            : undefined;
        const kind = before.kind !== next.kind ? `kind ${before.kind} → ${next.kind}` : undefined;
        return `${code(next.name)}: ${[image, type, kind].filter(Boolean).join(", ")}`;
      }),
    ),
    ...section(
      "New dependencies",
      diff.addedEdges.map((edge) => `${label(edge.from)} → ${label(edge.to)}`),
    ),
    ...section(
      "Removed dependencies",
      diff.removedEdges.map((edge) => `${label(edge.from)} → ${label(edge.to)}`),
    ),
    "### Resulting architecture",
    "",
    "```mermaid",
    toMermaid(after, { added: new Set(diff.addedNodes.map((node) => node.id)) }),
    "```",
  );
  return lines.join("\n");
}
