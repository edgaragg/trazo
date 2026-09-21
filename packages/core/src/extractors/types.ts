import type { ArchitectureModel } from "../model.js";

/** A file handed to the extractors. Core never touches the filesystem itself. */
export interface SourceFile {
  /** Path relative to the scanned root, always using forward slashes. */
  path: string;
  content: string;
}

/**
 * Teaches Trazo to read one kind of infrastructure file.
 *
 * Extractors must be deterministic: the same file content always produces the
 * same model, because diffs compare models produced from different revisions.
 */
export interface Extractor {
  /** Short identifier, used in error messages. */
  readonly name: string;
  /** Whether this extractor understands the file at `path`. Decided from the path alone. */
  matches(path: string): boolean;
  /**
   * Reads a file that `matches` accepted.
   *
   * @throws {Error} If the file content is malformed. The message names the file.
   */
  extract(file: SourceFile): ArchitectureModel;
}
