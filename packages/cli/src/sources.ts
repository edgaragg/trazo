import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultExtractors, type SourceFile } from "@edgaragg/trazo-core";

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor"]);

const isSupported = (path: string) => defaultExtractors.some((extractor) => extractor.matches(path));

/**
 * Reads every supported file under `root` from the working tree, skipping
 * dependency and build directories.
 *
 * @returns Files with paths relative to `root`, using forward slashes.
 */
export function collectWorkingTree(root: string): SourceFile[] {
  const files: SourceFile[] = [];

  const walk = (relativeDir: string) => {
    for (const entry of readdirSync(join(root, relativeDir), { withFileTypes: true })) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(relativePath);
      } else if (entry.isFile() && isSupported(relativePath)) {
        files.push({ path: relativePath, content: readFileSync(join(root, relativePath), "utf8") });
      }
    }
  };

  walk("");
  return files;
}

/**
 * Reads every supported file under `root` as it existed at a git revision,
 * without touching the working tree.
 *
 * @param root - Directory inside a git repository. Only files under it are read.
 * @param ref - Any revision git understands: a branch, a tag or a commit SHA.
 * @throws {Error} If `ref` cannot be resolved. In CI this usually means the
 * repository was checked out with a shallow history.
 */
export function collectAtRef(root: string, ref: string): SourceFile[] {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });

  let listing: string;
  try {
    listing = git("ls-tree", "-r", "--name-only", ref);
  } catch {
    throw new Error(
      `Could not read git revision "${ref}". Make sure it exists and, in CI, that the repository was checked out with full history (fetch-depth: 0).`,
    );
  }

  return listing
    .split("\n")
    .filter((path) => path !== "" && isSupported(path))
    .map((path) => ({ path, content: git("show", `${ref}:./${path}`) }));
}
