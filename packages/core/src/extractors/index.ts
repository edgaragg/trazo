import { dockerComposeExtractor } from "./docker-compose.js";
import type { Extractor } from "./types.js";

/** Extractors used when the caller does not provide their own. */
export const defaultExtractors: readonly Extractor[] = [dockerComposeExtractor];

export { dockerComposeExtractor } from "./docker-compose.js";
export type { Extractor, SourceFile } from "./types.js";
