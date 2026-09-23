import type { ArchitectureModel } from "../model.js";
import type { ExtractOptions } from "./rules.js";

/** A file handed to the extractors. Core never touches the filesystem itself. */
export interface SourceFile {
  /** Path relative to the scanned root, always using forward slashes. */
  path: string;
  content: string;
}

/**
 * Teaches Trazo to read one kind of infrastructure file.
 *
 * Extractors must be deterministic: the same file content and options always produce the
 * same model, because diffs compare models produced from different revisions.
 */
export interface Extractor {
  /** Short identifier, used in error messages and as the key of its section in the config file. */
  readonly name: string;
  /** Whether this extractor understands the file at `path`. Decided from the path alone. */
  matches(path: string): boolean;
  /**
   * Reads a file that `matches` accepted.
   *
   * @param options - The user's rules for this extractor, when there are any.
   * @throws {Error} If the file content is malformed. The message names the file.
   */
  extract(file: SourceFile, options?: ExtractOptions): ArchitectureModel;
}
