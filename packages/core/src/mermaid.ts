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

// Border colour per kind, on top of the shape each already has. Values are the first four
// slots of the project's validated categorical palette (blue/orange/aqua/yellow, in that fixed
// order — see the dataviz skill), which pass its CVD and normal-vision checks against a light
// surface. Only the border changes, not the fill: text inside stays Mermaid's default colour,
// so legibility never depends on how a given hue reads under it. The colours are one static set
// baked into the diagram, not adapted to the viewer's light/dark GitHub theme, since a rendered
// Mermaid SVG can't detect that.
const KIND_ORDER: readonly NodeKind[] = ["service", "database", "cache", "queue"];
const KIND_STROKE: Record<NodeKind, string> = {
  service: "#2a78d6",
  database: "#eb6834",
  cache: "#1baf7a",
  queue: "#eda100",
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
 * asymmetric flag shape, each also bordered in its own colour. The output is
 * stable for equal models.
 *
 * A component in `options.added` is bordered green instead of its kind's colour — being new
 * is the more useful signal in a diff, so it takes priority; the shape still shows its kind.
 *
 * @param model - Model to draw. Dependencies pointing at unknown components are skipped.
 */
export function toMermaid(model: ArchitectureModel, options: MermaidOptions = {}): string {
  const ids = assignIds(model.nodes);
  // No `%%{init: {theme: ...}}%%` directive: tried pinning the "base" theme, since GitHub
  // respects it and classDef already overrides its colours anyway, but on a dark page it left
  // the cylinder/stadium/flag shapes and edges nearly invisible (no fill of their own, and
  // base's default text/line colour is too dark to read on a dark surface) — confirmed by
  // rendering it, not assumed. Leaving the theme unset renders correctly on both a light and a
  // dark page, which matters since the same static diagram has to work on either.
  const lines = ["flowchart LR"];

  for (const node of model.nodes) {
    lines.push(`  ${ids.get(node.id)}${SHAPES[node.kind](escapeLabel(node.name))}`);
  }
  for (const edge of model.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from && to) lines.push(`  ${from} --> ${to}`);
  }

  const addedIds = new Set(options.added ?? []);

  // A node gets exactly one class: "added" wins over its kind's colour, so the two classDefs
  // never have to be merged on the same node — Mermaid's rule for combining two classes on one
  // node isn't something to depend on when a single, unambiguous style says the same thing.
  for (const kind of KIND_ORDER) {
    const kindIds = model.nodes
      .filter((node) => node.kind === kind && !addedIds.has(node.id))
      .flatMap((node) => ids.get(node.id) ?? []);
    if (kindIds.length === 0) continue;
    lines.push(`  classDef kind_${kind} stroke:${KIND_STROKE[kind]},stroke-width:2px`);
    lines.push(`  class ${kindIds.join(",")} kind_${kind}`);
  }

  const added = [...addedIds].flatMap((id) => ids.get(id) ?? []);
  if (added.length > 0) {
    lines.push("  classDef added stroke:#2da44e,stroke-width:3px");
    lines.push(`  class ${added.join(",")} added`);
  }
  return lines.join("\n");
}
