import { amplifyExtractor } from "./amplify.js";
import { cloudFormationExtractor } from "./cloudformation.js";
import { dockerComposeExtractor } from "./docker-compose.js";
import { kubernetesExtractor } from "./kubernetes.js";
import type { Extractor } from "./types.js";

/**
 * Extractors used when the caller does not provide their own. Every one whose `matches` accepts a
 * file's path reads it; the ones that match broadly (Kubernetes and CloudFormation are offered every
 * YAML file, CloudFormation every JSON one) return an empty model for a file that isn't theirs.
 */
export const defaultExtractors: readonly Extractor[] = [
  dockerComposeExtractor,
  kubernetesExtractor,
  cloudFormationExtractor,
  amplifyExtractor,
];

export { dockerComposeExtractor } from "./docker-compose.js";
export { kubernetesExtractor } from "./kubernetes.js";
export { cloudFormationExtractor } from "./cloudformation.js";
export { amplifyExtractor } from "./amplify.js";
export type { Extractor, SourceFile } from "./types.js";
export { IGNORE } from "./rules.js";
export type { ExtractOptions, KindRules } from "./rules.js";
