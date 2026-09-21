import type { ArchitectureModel, ArchNode, NodeKind } from "./model.js";

/** Options for {@link toMermaid}. */
export interface MermaidOptions {
  /** Ids of components to draw with a highlighted border, typically the ones a PR adds. */
  added?: ReadonlySet<string>;
}

const SHAPES: Record<NodeKind, (label: string) => string> = {
  service: (label) => `["${label}"]`,
  database: (label) => `[("${label}")]`,
  cache: (label) => `(["${label}"])`,
  queue: (label) => `>"${label}"]`,
};

const LABEL_ENTITIES: Record<string, string> = { '"': "#quot;", "<": "#lt;", ">": "#gt;" };

/**
 * Escapes the characters Mermaid mangles inside a quoted label. It does not reject
 * them: an unescaped quote is silently dropped and text that looks like an HTML tag,
 * such as `<svc>`, is stripped, leaving the component with a wrong or empty label.
 */
const escapeLabel = (text: string) => text.replace(/["<>]/g, (char) => LABEL_ENTITIES[char] ?? char);

/**
 * Assigns each component a Mermaid-safe identifier. Names may contain characters
 * Mermaid rejects, and two names can collapse to the same identifier once
 * sanitised, so a numeric suffix keeps them apart.
 */
function assignIds(nodes: readonly ArchNode[]): Map<string, string> {
  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const node of nodes) {
    const base = `n_${node.id.replace(/[^A-Za-z0-9_]/g, "_")}`;
    let candidate = base;
    for (let suffix = 2; used.has(candidate); suffix++) candidate = `${base}_${suffix}`;
    used.add(candidate);
    ids.set(node.id, candidate);
  }
  return ids;
}

/**
 * Renders a model as a Mermaid `flowchart`, which GitHub draws natively in
 * Markdown. Databases are cylinders, caches are stadiums and queues use the
 * asymmetric flag shape. The output is stable for equal models.
 *
 * @param model - Model to draw. Dependencies pointing at unknown components are skipped.
 */
export function toMermaid(model: ArchitectureModel, options: MermaidOptions = {}): string {
  const ids = assignIds(model.nodes);
  const lines = ["flowchart LR"];

  for (const node of model.nodes) {
    lines.push(`  ${ids.get(node.id)}${SHAPES[node.kind](escapeLabel(node.name))}`);
  }
  for (const edge of model.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from && to) lines.push(`  ${from} --> ${to}`);
  }

  const added = [...(options.added ?? [])].flatMap((id) => ids.get(id) ?? []);
  if (added.length > 0) {
    lines.push("  classDef added stroke:#2da44e,stroke-width:3px");
    lines.push(`  class ${added.join(",")} added`);
  }
  return lines.join("\n");
}
