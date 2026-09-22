import { dockerComposeExtractor } from "./docker-compose.js";
import { kubernetesExtractor } from "./kubernetes.js";
import type { Extractor } from "./types.js";

/**
 * Extractors used when the caller does not provide their own, tried in this order until one
 * matches a file's path. `kubernetesExtractor` matches broadly, so it is listed after the more
 * specific extractors that should get first pick of a file.
 */
export const defaultExtractors: readonly Extractor[] = [dockerComposeExtractor, kubernetesExtractor];

export { dockerComposeExtractor } from "./docker-compose.js";
export { kubernetesExtractor } from "./kubernetes.js";
export type { Extractor, SourceFile } from "./types.js";
