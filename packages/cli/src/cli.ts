import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  diffModels,
  extractModel,
  renderArchitectureMarkdown,
  renderDiffMarkdown,
  toMermaid,
} from "@edgaragg/trazo-core";
import { runBitbucketComment } from "./bitbucket.js";
import { collectAtRef, collectWorkingTree } from "./sources.js";

/** Where the CLI reads its context from and writes its output to. Injected so it can be tested. */
export interface CliEnvironment {
  /** Directory relative paths are resolved against. */
  cwd: string;
  out(text: string): void;
  err(text: string): void;
  /** Writes a file for `--out`. `path` is resolved against `cwd` before this is called. */
  writeFile(path: string, content: string): void;
  /** Environment variables for commands that read CI context. Defaults to `process.env`. */
  vars?: NodeJS.ProcessEnv;
}

const HELP = `trazo - keep your architecture diagrams honest

Usage:
  trazo generate [dir]            Print the architecture found under dir (default: .)
  trazo diff [dir] --base <ref>   Print what changed since a git revision
  trazo bitbucket-comment         Post the report on a Bitbucket pull request (run from Bitbucket Pipelines)

Options:
  -b, --base <ref>     Git revision to compare against (diff only)
  -f, --format <name>  generate: mermaid | json | markdown (default mermaid)
                       diff: markdown | json (default markdown)
  -o, --out <path>     Write the output to a file instead of stdout (generate only)
  -h, --help           Show this help

See the README for the list of supported infrastructure files.`;

/**
 * Runs the command line interface.
 *
 * Never rejects: every failure, including malformed input files, unknown git revisions and
 * rejected API calls, is written to `env.err` and reported through the exit code.
 *
 * @param argv - Arguments after the executable name.
 * @param env - Working directory and output streams. Injected so the CLI can be tested.
 * @returns The process exit code: 0 on success, 1 on failure or invalid usage.
 */
export async function run(argv: readonly string[], env: CliEnvironment): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        base: { type: "string", short: "b" },
        format: { type: "string", short: "f" },
        out: { type: "string", short: "o" },
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
      if (format !== undefined && format !== "mermaid" && format !== "json" && format !== "markdown") {
        env.err(`trazo: unknown format "${format}" for generate (use mermaid, json or markdown).`);
        return 1;
      }
      const model = extractModel(collectWorkingTree(root));
      // Without --out this is an interactive/CI check, so an empty result is treated as a
      // mistake. With --out this is usually unattended (regenerating a committed doc on every
      // push), where a repository legitimately having no infrastructure files yet should not
      // fail the job — the file is written showing that, instead.
      if (model.nodes.length === 0 && !values.out) {
        env.err("trazo: no supported infrastructure files found.");
        return 1;
      }
      const rendered =
        format === "json" ? JSON.stringify(model, null, 2)
        : format === "markdown" ? renderArchitectureMarkdown(model)
        : toMermaid(model);
      if (values.out) {
        env.writeFile(resolve(env.cwd, values.out), rendered);
      } else {
        env.out(rendered);
      }
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

    if (command === "bitbucket-comment") {
      await runBitbucketComment(env.vars ?? process.env, env.out);
      return 0;
    }

    env.err(`trazo: unknown command "${command}".\n\n${HELP}`);
    return 1;
  } catch (error) {
    env.err(`trazo: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
