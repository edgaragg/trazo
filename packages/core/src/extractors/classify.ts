import type { NodeKind } from "../model.js";
import { ruleFor, type KindRules } from "./rules.js";

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
 * Classifies a container image by the kind of component it usually runs. Shared by every
 * extractor that reads a container image, so a Postgres container is drawn the same way
 * whether it comes from Docker Compose or Kubernetes.
 *
 * @param rules - The user's rules, keyed by image name without registry or tag. They win over the built-in patterns.
 * @returns `service` when the image is missing or not recognised, or the rule's value, which may be `ignore`.
 */
export function classifyImage(image: string | undefined, rules?: KindRules): NodeKind {
  if (!image) return "service";
  const name = (image.split("/").pop() ?? image).split(/[:@]/)[0]?.toLowerCase() ?? "";
  return ruleFor(rules, name) ?? KIND_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? "service";
}
