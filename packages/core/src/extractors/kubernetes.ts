import { parseAllDocuments } from "yaml";
import type { ArchEdge, ArchNode } from "../model.js";
import { classifyImage } from "./classify.js";
import type { Extractor } from "./types.js";

/** Kinds that run containers. Each one becomes an architecture component. */
const WORKLOAD_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Pod"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `parent[key]` as a plain object, or undefined if it isn't one. */
function child(parent: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = parent?.[key];
  return isRecord(value) ? value : undefined;
}

/** Keeps only the string-valued entries of a map, such as a Service's `selector` or a Pod's `labels`. */
function stringEntries(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const map: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) if (typeof v === "string") map[key] = v;
  return map;
}

/**
 * Splits a file into its YAML documents.
 *
 * `parseAllDocuments` does not throw on malformed YAML; it records the problem on each
 * document instead, so the errors have to be checked explicitly.
 *
 * @throws {Error} If any document in the file fails to parse.
 */
function parseDocuments(content: string, path: string): unknown[] {
  const documents = parseAllDocuments(content);
  const error = documents.flatMap((doc) => doc.errors)[0];
  if (error) throw new Error(`Invalid YAML in ${path}: ${error.message.split("\n")[0]}`);
  return documents.map((doc) => doc.toJS()).filter((doc) => doc !== null && doc !== undefined);
}

/** A parsed document recognised as a Kubernetes resource. */
interface Resource {
  kind: string;
  name: string;
  spec: Record<string, unknown>;
  /** Labels on the pods this resource manages, used to resolve a Service's selector. Empty for kinds without pods. */
  podLabels: Record<string, string>;
  /** The first container's image, for workload kinds. */
  image: string | undefined;
}

function firstContainerImage(spec: Record<string, unknown> | undefined): string | undefined {
  const containers = spec?.["containers"];
  const first = Array.isArray(containers) ? containers[0] : undefined;
  return isRecord(first) && typeof first["image"] === "string" ? first["image"] : undefined;
}

/** The pod template (`{ metadata, spec }`) a workload's pods are created from. */
function podTemplate(kind: string, spec: Record<string, unknown>): Record<string, unknown> | undefined {
  if (kind === "CronJob") return child(child(child(spec, "jobTemplate"), "spec"), "template");
  return child(spec, "template");
}

/** Recognises a document as a Kubernetes resource and reads what the extractor needs from it. */
function parseResource(doc: unknown): Resource | undefined {
  if (!isRecord(doc) || typeof doc["apiVersion"] !== "string" || typeof doc["kind"] !== "string") {
    return undefined;
  }
  const kind = doc["kind"];
  const name = child(doc, "metadata")?.["name"];
  if (typeof name !== "string") return undefined;
  const spec = child(doc, "spec") ?? {};

  if (kind === "Pod") {
    return { kind, name, spec, podLabels: stringEntries(child(doc, "metadata")?.["labels"]), image: firstContainerImage(spec) };
  }
  if (WORKLOAD_KINDS.has(kind)) {
    const template = podTemplate(kind, spec);
    return {
      kind,
      name,
      spec,
      podLabels: stringEntries(child(template, "metadata")?.["labels"]),
      image: firstContainerImage(child(template, "spec")),
    };
  }
  return { kind, name, spec, podLabels: {}, image: undefined };
}

/** A Service selects a workload when every key in its selector matches that workload's pod labels. */
function selects(selector: Record<string, string>, podLabels: Record<string, string>): boolean {
  const keys = Object.keys(selector);
  return keys.length > 0 && keys.every((key) => podLabels[key] === selector[key]);
}

/**
 * Names of the Services an Ingress declares as a backend, covering both the stable
 * `networking.k8s.io/v1` shape (`backend.service.name`) and the legacy `extensions/v1beta1`
 * shape (`backend.serviceName`).
 */
function ingressBackends(spec: Record<string, unknown>): string[] {
  const names: string[] = [];
  const addBackend = (backend: unknown) => {
    if (!isRecord(backend)) return;
    const name = child(backend, "service")?.["name"] ?? backend["serviceName"];
    if (typeof name === "string") names.push(name);
  };

  addBackend(spec["backend"]);
  addBackend(spec["defaultBackend"]);
  for (const rule of Array.isArray(spec["rules"]) ? spec["rules"] : []) {
    const paths = child(rule, "http")?.["paths"];
    for (const path of Array.isArray(paths) ? paths : []) {
      if (isRecord(path)) addBackend(path["backend"]);
    }
  }
  return names;
}

/**
 * Reads Kubernetes manifests: Deployments, StatefulSets, DaemonSets, Jobs, CronJobs and bare
 * Pods each become a component, classified by their first container's image. Ingresses become
 * a component too, with a dependency on the workload(s) their backend Service selects.
 *
 * A Service is never drawn on its own; it only resolves an Ingress's backend name to the
 * workload it points at. That resolution only works when the Service and the workload it
 * selects are declared in the same file, because extractors read one file at a time. A Service
 * defined in another file, or one with no matching workload, produces no dependency.
 *
 * Matches every `.yaml`/`.yml` file not already claimed by a more specific extractor, since
 * manifests can have any filename. A document without a recognised Kubernetes `kind` is read as
 * empty, so pointing this extractor at an unrelated YAML file is harmless.
 */
export const kubernetesExtractor: Extractor = {
  name: "kubernetes",

  matches: (path) => /\.ya?ml$/.test(path),

  extract(file) {
    const resources = parseDocuments(file.content, file.path)
      .map(parseResource)
      .filter((resource): resource is Resource => resource !== undefined);

    const nodes: ArchNode[] = [];
    const services: Array<{ name: string; selector: Record<string, string> }> = [];
    const ingresses: Array<{ name: string; backends: string[] }> = [];

    for (const resource of resources) {
      if (WORKLOAD_KINDS.has(resource.kind)) {
        nodes.push({
          id: resource.name,
          name: resource.name,
          kind: classifyImage(resource.image),
          source: file.path,
          ...(resource.image !== undefined && { image: resource.image }),
        });
      } else if (resource.kind === "Service") {
        services.push({ name: resource.name, selector: stringEntries(resource.spec["selector"]) });
      } else if (resource.kind === "Ingress") {
        nodes.push({ id: resource.name, name: resource.name, kind: "service", source: file.path });
        ingresses.push({ name: resource.name, backends: ingressBackends(resource.spec) });
      }
    }

    const edges: ArchEdge[] = [];
    for (const ingress of ingresses) {
      for (const backendName of ingress.backends) {
        const service = services.find((candidate) => candidate.name === backendName);
        if (!service) continue;
        for (const resource of resources) {
          if (WORKLOAD_KINDS.has(resource.kind) && selects(service.selector, resource.podLabels)) {
            edges.push({ from: ingress.name, to: resource.name, label: "routes to" });
          }
        }
      }
    }
    return { nodes, edges };
  },
};
