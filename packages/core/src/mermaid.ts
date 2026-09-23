import type { KindStyle, Shape } from "./config.js";
import type { ArchitectureModel, ArchNode, NodeKind } from "./model.js";

/** Options for {@link toMermaid}. */
export interface MermaidOptions {
  /** Ids of components to draw with a highlighted border, typically the ones a PR adds. */
  added?: ReadonlySet<string>;
  /**
   * How to draw each kind, on top of the built-in look: a built-in kind keeps whatever the entry
   * leaves out, and a custom kind starts from the plain neutral style.
   */
  kinds?: Readonly<Record<string, Partial<KindStyle>>>;
}

const SHAPES: Record<Shape, (label: string) => string> = {
  rectangle: (label) => `["${label}"]`,
  rounded: (label) => `("${label}")`,
  stadium: (label) => `(["${label}"])`,
  subroutine: (label) => `[["${label}"]]`,
  cylinder: (label) => `[("${label}")]`,
  circle: (label) => `(("${label}"))`,
  flag: (label) => `>"${label}"]`,
  rhombus: (label) => `{"${label}"}`,
  hexagon: (label) => `{{"${label}"}}`,
  parallelogram: (label) => `[/"${label}"/]`,
};

// Border colour per kind, on top of the shape each already has. Strokes are the first four
// slots of the project's validated categorical palette (blue/orange/aqua/yellow, in that fixed
// order — see the dataviz skill), which pass its CVD and normal-vision checks against a light
// surface. Fills are those same hues lightened toward white (12% colour / 88% white — computed,
// not eyeballed), so text always sits on a near-white background regardless of the hue: every
// fill clears a 14.9:1 contrast ratio against #1a1a1a text, far past WCAG's 4.5:1 floor. The
// colours are one static set baked into the diagram, not adapted to the viewer's light/dark
// GitHub theme, since a rendered Mermaid SVG can't detect that — the light fills are what makes
// that safe to do: a light box reads fine on either a light or a dark page.
const BUILT_IN_STYLES: Record<string, KindStyle> = {
  service: { shape: "rectangle", stroke: "#2a78d6", fill: "#e5effa" },
  database: { shape: "cylinder", stroke: "#eb6834", fill: "#fdede7" },
  cache: { shape: "stadium", stroke: "#1baf7a", fill: "#e4f5ef" },
  queue: { shape: "flag", stroke: "#eda100", fill: "#fdf4e0" },
};
// A kind nobody styled: neutral grey, so it reads as "not one of the known kinds" rather than as one of them.
const NEUTRAL_STYLE: KindStyle = { shape: "rectangle", stroke: "#6b7280", fill: "#f3f4f6" };
const KIND_ORDER = Object.keys(BUILT_IN_STYLES);

function styleOf(kind: NodeKind, overrides: MermaidOptions["kinds"]): KindStyle {
  return { ...(BUILT_IN_STYLES[kind] ?? NEUTRAL_STYLE), ...overrides?.[kind] };
}
const TEXT_COLOR = "#1a1a1a";
const ADDED_STROKE = "#2da44e";
const ADDED_FILL = "#e6f4ea";
// Mermaid's "base" theme is the one meant to be built on top of, and GitHub respects the
// directive that selects it. Its own default line colour is too dark to read on a dark page,
// so it's overridden here too — confirmed by rendering the diagram against both a light and a
// dark page, not assumed: an earlier attempt at "base" alone (no fill, no lineColor) left edges
// and unfilled shapes nearly invisible on dark.
const INIT_DIRECTIVE = `%%{init: {'theme':'base','themeVariables':{'lineColor':'#6b7280'}}}%%`;

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
 * Markdown. By default databases are cylinders, caches are stadiums and queues
 * use the asymmetric flag shape, each also bordered in its own colour; `options.kinds` changes
 * that and defines custom kinds. The output is stable for equal models.
 *
 * A component in `options.added` is bordered green instead of its kind's colour — being new
 * is the more useful signal in a diff, so it takes priority; the shape still shows its kind.
 *
 * @param model - Model to draw. Dependencies pointing at unknown components are skipped.
 */
export function toMermaid(model: ArchitectureModel, options: MermaidOptions = {}): string {
  const ids = assignIds(model.nodes);
  const lines = [INIT_DIRECTIVE, "flowchart LR"];

  for (const node of model.nodes) {
    lines.push(`  ${ids.get(node.id)}${SHAPES[styleOf(node.kind, options.kinds).shape](escapeLabel(node.name))}`);
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
  // Built-in kinds first, in a fixed order, then any custom ones alphabetically, so output stays stable.
  const customKinds = [...new Set(model.nodes.map((node) => node.kind))].filter((kind) => !KIND_ORDER.includes(kind)).sort();
  for (const kind of [...KIND_ORDER, ...customKinds]) {
    const style = styleOf(kind, options.kinds);
    const kindIds = model.nodes
      .filter((node) => node.kind === kind && !addedIds.has(node.id))
      .flatMap((node) => ids.get(node.id) ?? []);
    if (kindIds.length === 0) continue;
    lines.push(
      `  classDef kind_${kind} fill:${style.fill},stroke:${style.stroke},stroke-width:2px,color:${TEXT_COLOR}`,
    );
    lines.push(`  class ${kindIds.join(",")} kind_${kind}`);
  }

  const added = [...addedIds].flatMap((id) => ids.get(id) ?? []);
  if (added.length > 0) {
    lines.push(`  classDef added fill:${ADDED_FILL},stroke:${ADDED_STROKE},stroke-width:3px,color:${TEXT_COLOR}`);
    lines.push(`  class ${added.join(",")} added`);
  }
  return lines.join("\n");
}
