import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG, parseConfig, type TrazoConfig } from "@edgaragg/trazo-core";

/** Names Trazo looks for in the project root, in this order. */
export const CONFIG_FILES = ["trazo.config.yaml", "trazo.config.yml"];

/**
 * Reads the project's `trazo.config.yaml`, or `trazo.config.yml`.
 *
 * A project without one just gets the defaults. For `trazo diff` and the pull request integrations
 * the file in the working tree applies to both sides of the comparison, so a change to the config
 * itself never shows up as a change to the architecture.
 *
 * @param root - Project root, where the file is looked for.
 * @param explicitPath - A config file to use instead, resolved against `root`.
 * @throws {Error} If `explicitPath` does not exist, or the file is not valid. The message names the file.
 */
export function loadConfig(root: string, explicitPath?: string): TrazoConfig {
  if (explicitPath !== undefined) {
    const path = resolve(root, explicitPath);
    if (!existsSync(path)) throw new Error(`Config file not found: ${explicitPath}`);
    return parseConfig(readFileSync(path, "utf8"), explicitPath);
  }
  for (const name of CONFIG_FILES) {
    const path = join(root, name);
    if (existsSync(path)) return parseConfig(readFileSync(path, "utf8"), name);
  }
  return structuredClone(DEFAULT_CONFIG);
}
