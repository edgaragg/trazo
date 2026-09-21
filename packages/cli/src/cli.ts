import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { diffModels, extractModel, renderDiffMarkdown, toMermaid } from "@trazo/core";
import { collectAtRef, collectWorkingTree } from "./sources.js";

/** Where the CLI reads its context from and writes its output to. Injected so it can be tested. */
export interface CliEnvironment {
  /** Directory relative paths are resolved against. */
  cwd: string;
  out(text: string): void;
  err(text: string): void;
}

const HELP = `trazo - keep your architecture diagrams honest

Usage:
  trazo generate [dir]            Print the architecture found under dir (default: .)
  trazo diff [dir] --base <ref>   Print what changed since a git revision

Options:
  -b, --base <ref>     Git revision to compare against (diff only)
  -f, --format <name>  generate: mermaid | json (default mermaid)
                       diff: markdown | json (default markdown)
  -h, --help           Show this help

Supported files: docker-compose.yml / compose.yaml`;

/**
 * Runs the command line interface.
 *
 * Never throws: every failure, including malformed input files and unknown git revisions,
 * is written to `env.err` and reported through the exit code.
 *
 * @param argv - Arguments after the executable name.
 * @param env - Working directory and output streams. Injected so the CLI can be tested.
 * @returns The process exit code: 0 on success, 1 on failure or invalid usage.
 */
export function run(argv: readonly string[], env: CliEnvironment): number {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        base: { type: "string", short: "b" },
        format: { type: "string", short: "f" },
        help: { type: "boolean", short: "h" },
      },
    });

    const [command, dir = "."] = positionals;
    if (values.help || !command) {
      env.out(HELP);
      return command || values.help ? 0 : 1;
    }

    const root = resolve(env.cwd, dir);
    const format = values.format;

    if (command === "generate") {
      if (format !== undefined && format !== "mermaid" && format !== "json") {
        env.err(`trazo: unknown format "${format}" for generate (use mermaid or json).`);
        return 1;
      }
      const model = extractModel(collectWorkingTree(root));
      if (model.nodes.length === 0) {
        env.err("trazo: no supported files found (looked for docker-compose.yml / compose.yaml).");
        return 1;
      }
      env.out(format === "json" ? JSON.stringify(model, null, 2) : toMermaid(model));
      return 0;
    }

    if (command === "diff") {
      if (!values.base) {
        env.err("trazo: diff needs --base <ref>, for example: trazo diff --base main");
        return 1;
      }
      if (format !== undefined && format !== "markdown" && format !== "json") {
        env.err(`trazo: unknown format "${format}" for diff (use markdown or json).`);
        return 1;
      }
      const before = extractModel(collectAtRef(root, values.base));
      const after = extractModel(collectWorkingTree(root));
      const diff = diffModels(before, after);
      env.out(format === "json" ? JSON.stringify(diff, null, 2) : renderDiffMarkdown(diff, after));
      return 0;
    }

    env.err(`trazo: unknown command "${command}".\n\n${HELP}`);
    return 1;
  } catch (error) {
    env.err(`trazo: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
