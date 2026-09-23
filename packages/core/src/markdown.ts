import type { ArchNode } from "./model.js";

/** Wraps text in backticks for inline Markdown code. */
export const code = (text: string): string => `\`${text}\``;

/** One-line description of a component: its name, kind and, when known, its image or type. */
export const describeNode = (node: ArchNode): string => {
  const detail = node.image ?? node.type;
  return detail ? `${code(node.name)} (${node.kind}, ${code(detail)})` : `${code(node.name)} (${node.kind})`;
};
