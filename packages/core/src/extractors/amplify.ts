import type { ArchEdge, ArchNode, NodeKind } from "../model.js";
import { IGNORE, ruleFor } from "./rules.js";
import type { Extractor } from "./types.js";

const BACKEND_CONFIG = /(^|\/)amplify\/backend\/backend-config\.json$/;

// Amplify services that are a data store or a message stream; every other service (Lambda, Cognito,
// AppSync, API Gateway, hosting, analytics...) is drawn as a plain component.
const SERVICE_KINDS: Record<string, NodeKind> = {
  dynamodb: "database",
  s3: "database",
  kinesis: "queue",
  kinesisfirehose: "queue",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the backend of an AWS Amplify (Gen 1) project from `amplify/backend/backend-config.json`.
 *
 * That file is Amplify's own summary of the backend: each resource sits under its category
 * (`function`, `storage`, `api`, `auth`...) with the service it uses, and lists in `dependsOn` the
 * resources it needs — which function reads which table, which API calls which function. Each
 * resource becomes a component with the service as its type, and each `dependsOn` entry a
 * dependency. A resource's id is `category/name`, and it is drawn under its bare name unless two
 * categories share it (an API and the function behind it are often both called the same).
 *
 * Only this file is read. The CloudFormation Amplify generates under `amplify/backend` is skipped
 * on purpose: every function's template names its resource `LambdaFunction`, so it would only add
 * noise. The user's rules are keyed by service (`Lambda`, `DynamoDB`...): they choose the kind a
 * resource is drawn as, or `ignore` to leave it out. Amplify Gen 2 has no such file — its backend is TypeScript — and is not supported.
 */
export const amplifyExtractor: Extractor = {
  name: "amplify",

  matches: (path) => BACKEND_CONFIG.test(path),

  extract(file, options) {
    let config: unknown;
    try {
      config = JSON.parse(file.content);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON in ${file.path}: ${reason}`);
    }

    const nodes: ArchNode[] = [];
    const edges: ArchEdge[] = [];
    if (!isRecord(config)) return { nodes, edges };

    const entries: Array<{ category: string; name: string }> = [];
    for (const [category, resources] of Object.entries(config)) {
      if (!isRecord(resources)) continue;
      for (const [name, definition] of Object.entries(resources)) {
        if (!isRecord(definition)) continue;
        const service = typeof definition["service"] === "string" ? definition["service"] : undefined;
        const kind = ruleFor(options?.rules, service) || (service && SERVICE_KINDS[service.toLowerCase()]) || "service";
        if (kind === IGNORE) continue;
        entries.push({ category, name });

        nodes.push({
          id: `${category}/${name}`,
          name,
          kind,
          source: file.path,
          ...(service !== undefined && { type: service }),
        });

        const dependsOn = Array.isArray(definition["dependsOn"]) ? definition["dependsOn"] : [];
        for (const dependency of dependsOn) {
          if (!isRecord(dependency)) continue;
          const target = dependency["resourceName"] ?? dependency["resource"];
          if (typeof dependency["category"] === "string" && typeof target === "string") {
            edges.push({ from: `${category}/${name}`, to: `${dependency["category"]}/${target}`, label: "dependsOn" });
          }
        }
      }
    }

    const nameCount = new Map<string, number>();
    for (const { name } of entries) nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
    for (const node of nodes) if ((nameCount.get(node.name) ?? 0) > 1) node.name = node.id;

    return { nodes, edges };
  },
};
