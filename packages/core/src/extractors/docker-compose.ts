import { parse } from "yaml";
import type { ArchEdge, ArchNode, NodeKind } from "../model.js";
import type { Extractor } from "./types.js";

const COMPOSE_FILE = /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/;

// Matched against the image name without registry or tag, so `bitnami/kafka:3.7`
// is tested as `kafka`. This is a heuristic: it only picks the diagram shape.
const KIND_PATTERNS: ReadonlyArray<readonly [NodeKind, RegExp]> = [
  [
    "database",
    /postgres|mysql|mariadb|mongo|elasticsearch|opensearch|clickhouse|cassandra|influxdb|couchdb/,
  ],
  ["cache", /redis|memcached|valkey|keydb/],
  ["queue", /rabbitmq|kafka|nats|activemq|redpanda|pulsar/],
];

/**
 * Classifies a container image by the kind of component it usually runs.
 *
 * @returns `service` when the image is missing or not recognised.
 */
function classifyImage(image: string | undefined): NodeKind {
  if (!image) return "service";
  const name = (image.split("/").pop() ?? image).split(/[:@]/)[0]?.toLowerCase() ?? "";
  return KIND_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? "service";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `depends_on` is either a list of names or a map keyed by name. */
function dependsOn(definition: Record<string, unknown>): string[] {
  const value = definition["depends_on"];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (isRecord(value)) return Object.keys(value);
  return [];
}

/** `links` entries look like `service` or `service:alias`; only the service matters. */
function links(definition: Record<string, unknown>): string[] {
  const value = definition["links"];
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((link) => link.split(":")[0] ?? link);
}

/**
 * Reads Docker Compose files (`docker-compose.yml`, `compose.yaml` and their
 * `.override` / environment variants).
 *
 * Each entry under `services` becomes a component. `depends_on` and `links`
 * become dependencies. Relationships that are only implied, such as a service
 * reading a database URL from an environment variable, are not detected.
 */
export const dockerComposeExtractor: Extractor = {
  name: "docker-compose",

  matches: (path) => COMPOSE_FILE.test(path),

  extract(file) {
    let document: unknown;
    try {
      document = parse(file.content);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid YAML in ${file.path}: ${reason}`);
    }

    const nodes: ArchNode[] = [];
    const edges: ArchEdge[] = [];
    if (!isRecord(document) || !isRecord(document["services"])) return { nodes, edges };

    for (const [name, raw] of Object.entries(document["services"])) {
      const definition = isRecord(raw) ? raw : {};
      const image = typeof definition["image"] === "string" ? definition["image"] : undefined;

      nodes.push({
        id: name,
        name,
        kind: classifyImage(image),
        source: file.path,
        ...(image !== undefined && { image }),
      });
      for (const target of dependsOn(definition)) {
        edges.push({ from: name, to: target, label: "depends_on" });
      }
      for (const target of links(definition)) {
        edges.push({ from: name, to: target, label: "links" });
      }
    }
    return { nodes, edges };
  },
};
