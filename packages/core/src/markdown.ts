import type { ArchNode } from "./model.js";

/** Wraps text in backticks for inline Markdown code. */
export const code = (text: string): string => `\`${text}\``;

/** One-line description of a component: its name, kind and, when known, its image. */
export const describeNode = (node: ArchNode): string =>
  node.image ? `${code(node.name)} (${node.kind}, ${code(node.image)})` : `${code(node.name)} (${node.kind})`;
