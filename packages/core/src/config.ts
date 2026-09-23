import { parse } from "yaml";
import { defaultExtractors, IGNORE, type KindRules } from "./extractors/index.js";

/** Shapes a component can be drawn with. Each is a Mermaid flowchart node shape. */
export const SHAPES = [
  "rectangle",
  "rounded",
  "stadium",
  "subroutine",
  "cylinder",
  "circle",
  "flag",
  "rhombus",
  "hexagon",
  "parallelogram",
] as const;

/** One of {@link SHAPES}. */
export type Shape = (typeof SHAPES)[number];

/** How a kind of component is drawn. */
export interface KindStyle {
  shape: Shape;
  /** Border colour, as a hex colour such as `#2a78d6`. */
  stroke: string;
  /** Background colour, as a hex colour. Keep it light: the label is drawn in near-black. */
  fill: string;
}

/**
 * The settings read from `trazo.config.yaml`. Every part is optional in the file; what it leaves out
 * takes the default, so an absent file and an empty one mean the same.
 */
export interface TrazoConfig {
  /** Where `trazo generate --write` puts the document. */
  output: {
    /** Directory relative to the project root. */
    dir: string;
    /** Name of the file inside `dir`. */
    file: string;
  };
  /**
   * How each kind of component is drawn, only for what the file changes or adds. A name that is not
   * one of the built-in kinds (`service`, `database`, `cache`, `queue`) defines a custom kind.
   */
  kinds: Record<string, Partial<KindStyle>>;
  /**
   * Per extractor (see `Extractor.name`), which kind each thing it recognises becomes, or `ignore`
   * to leave it out. What the key means depends on the extractor: a resource type for CloudFormation,
   * a service for Amplify, an image name for Docker Compose, a workload kind or image for Kubernetes.
   */
  extractors: Record<string, KindRules>;
}

/** The kinds every project has, whatever its config says. */
export const BUILT_IN_KINDS = ["service", "database", "cache", "queue"] as const;

/** Settings used for whatever the config file does not say. */
export const DEFAULT_CONFIG: TrazoConfig = {
  output: { dir: ".trazo", file: "architecture.md" },
  kinds: {},
  extractors: {},
};

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const KIND_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads and validates the contents of a `trazo.config.yaml`.
 *
 * Validation is strict on purpose: an unknown key, extractor, shape or kind is almost always a typo,
 * and silently ignoring it would leave the diagram different from what the file says. Colours and
 * kind names end up inside the Mermaid source, so only plain hex colours and identifiers are accepted.
 *
 * @param content - The file's text. Empty content gives {@link DEFAULT_CONFIG}.
 * @param path - Used in error messages only.
 * @throws {Error} If the file is not valid YAML or does not follow the format. The message names `path`.
 */
export function parseConfig(content: string, path: string): TrazoConfig {
  const fail = (message: string): never => {
    throw new Error(`Invalid config ${path}: ${message}`);
  };

  let document: unknown;
  try {
    document = parse(content);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const config = structuredClone(DEFAULT_CONFIG);
  if (document === null || document === undefined) return config;
  if (!isRecord(document)) return fail("expected a mapping at the top level.");

  const known = ["output", "kinds", "extractors"];
  for (const key of Object.keys(document)) {
    if (!known.includes(key)) fail(`unknown key "${key}" (expected ${known.join(", ")}).`);
  }

  const output = document["output"];
  if (output !== undefined && output !== null) {
    if (!isRecord(output)) return fail(`"output" must be a mapping.`);
    for (const key of Object.keys(output)) {
      if (key !== "dir" && key !== "file") fail(`unknown key "output.${key}" (expected dir, file).`);
    }
    const { dir, file } = output;
    if (dir !== undefined) {
      if (typeof dir !== "string" || dir === "" || /^([/\\]|[A-Za-z]:)/.test(dir) || dir.split(/[/\\]/).includes("..")) {
        fail(`"output.dir" must be a directory inside the project, relative to it.`);
      }
      config.output.dir = (dir as string).replace(/\\/g, "/").replace(/\/+$/, "") || ".";
    }
    if (file !== undefined) {
      if (typeof file !== "string" || file === "" || /[/\\]/.test(file)) {
        fail(`"output.file" must be a file name, without a directory.`);
      }
      config.output.file = file as string;
    }
  }

  const kinds = document["kinds"];
  if (kinds !== undefined && kinds !== null) {
    if (!isRecord(kinds)) return fail(`"kinds" must be a mapping of kind name to style.`);
    for (const [name, raw] of Object.entries(kinds)) {
      if (!KIND_NAME.test(name)) fail(`kind "${name}" must start with a letter and use only letters, digits and _.`);
      if (raw !== null && !isRecord(raw)) fail(`"kinds.${name}" must be a mapping (shape, stroke, fill).`);
      const style: Partial<KindStyle> = {};
      for (const [key, value] of Object.entries(isRecord(raw) ? raw : {})) {
        if (key === "shape") {
          if (!SHAPES.includes(value as Shape)) fail(`"kinds.${name}.shape" must be one of ${SHAPES.join(", ")}.`);
          style.shape = value as Shape;
        } else if (key === "stroke" || key === "fill") {
          if (typeof value !== "string" || !HEX_COLOR.test(value)) {
            fail(`"kinds.${name}.${key}" must be a hex colour such as #2a78d6.`);
          }
          style[key] = value as string;
        } else {
          fail(`unknown key "kinds.${name}.${key}" (expected shape, stroke, fill).`);
        }
      }
      config.kinds[name] = style;
    }
  }

  const extractors = document["extractors"];
  if (extractors !== undefined && extractors !== null) {
    if (!isRecord(extractors)) return fail(`"extractors" must be a mapping of extractor name to rules.`);
    const names = defaultExtractors.map((extractor) => extractor.name);
    const allowed = new Set<string>([...BUILT_IN_KINDS, ...Object.keys(config.kinds), IGNORE]);
    for (const [name, raw] of Object.entries(extractors)) {
      if (!names.includes(name)) fail(`unknown extractor "${name}" (expected ${names.join(", ")}).`);
      if (raw !== null && !isRecord(raw)) fail(`"extractors.${name}" must be a mapping of what to recognise to the kind it becomes.`);
      const rules: Record<string, string> = {};
      for (const [key, kind] of Object.entries(isRecord(raw) ? raw : {})) {
        if (typeof kind !== "string" || !allowed.has(kind)) {
          fail(`"extractors.${name}.${key}" must be ${IGNORE}, a built-in kind or one defined under "kinds" (got ${JSON.stringify(kind)}).`);
        }
        rules[key] = kind as string;
      }
      config.extractors[name] = rules;
    }
  }

  return config;
}
