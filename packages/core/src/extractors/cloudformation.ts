import { isAlias, isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";
import type { ArchEdge, ArchNode, NodeKind } from "../model.js";
import { IGNORE, ruleFor, type KindRules } from "./rules.js";
import type { Extractor, SourceFile } from "./types.js";

/** A parsed template value, with intrinsic functions already in their long form (`{ Ref: "X" }`). */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const TEMPLATE_FILE = /\.(json|ya?ml|template)$/i;
// Amplify keeps its generated CloudFormation under amplify/backend, where every function's
// template names its resource `LambdaFunction`; backend-config.json describes that tree instead.
const AMPLIFY_TREE = /(^|\/)amplify\/backend\//;

// Resource types worth drawing. Everything else — IAM roles and policies, log groups, API Gateway
// methods and stages, VPC plumbing — is configuration around these, not a component.
const KINDS: ReadonlyArray<readonly [RegExp, NodeKind]> = [
  [
    /^AWS::(DynamoDB::(Table|GlobalTable)|Serverless::SimpleTable|RDS::(DBInstance|DBCluster)|Neptune::DBCluster|DocDB::DBCluster|Redshift::Cluster|OpenSearchService::Domain|Elasticsearch::Domain|S3::Bucket|Timestream::Table)$/,
    "database",
  ],
  [/^AWS::(ElastiCache::(CacheCluster|ReplicationGroup)|MemoryDB::Cluster)$/, "cache"],
  [
    /^AWS::(SQS::Queue|SNS::Topic|Kinesis::Stream|KinesisFirehose::DeliveryStream|Events::(Rule|EventBus)|MSK::Cluster|AmazonMQ::Broker)$/,
    "queue",
  ],
  [
    /^AWS::(Lambda::Function|Serverless::(Function|Api|HttpApi|StateMachine)|ApiGateway::RestApi|ApiGatewayV2::Api|AppSync::GraphQLApi|StepFunctions::StateMachine|ECS::Service|EC2::Instance|CloudFront::Distribution|Cognito::UserPool|ElasticLoadBalancing::LoadBalancer|ElasticLoadBalancingV2::LoadBalancer|AutoScaling::AutoScalingGroup|AppRunner::Service|Batch::JobDefinition|Glue::Job)$/,
    "service",
  ],
];

/** The kind a resource type is drawn as; undefined when it is not a component. */
function kindOf(type: string, rules: KindRules | undefined): NodeKind | undefined {
  const kind = ruleFor(rules, type) ?? KINDS.find(([pattern]) => pattern.test(type))?.[1];
  return kind === IGNORE ? undefined : kind;
}

function isRecord(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rewrites a YAML short-form tag (`!Ref`, `!GetAtt`, `!Sub`...) into the long form JSON templates use. */
function wrapIntrinsic(tag: string | undefined, value: Json): Json {
  if (!tag || !tag.startsWith("!") || tag.startsWith("!!")) return value;
  const name = tag.slice(1);
  if (name === "Ref" || name === "Condition") return { [name]: value };
  if (name === "GetAtt" && typeof value === "string") {
    const dot = value.indexOf(".");
    return { "Fn::GetAtt": dot < 0 ? [value] : [value.slice(0, dot), value.slice(dot + 1)] };
  }
  return { [`Fn::${name}`]: value };
}

/**
 * Converts a parsed YAML node to plain data. `yaml`'s own `toJS` would drop the tag that says a
 * value is a `!Ref`, and that tag is the whole point of a CloudFormation template.
 */
function toPlain(node: unknown, doc: Document): Json {
  if (isAlias(node)) return toPlain(node.resolve(doc), doc);
  if (isScalar(node)) return wrapIntrinsic(node.tag, (node.value ?? null) as Json);
  if (isSeq(node)) return wrapIntrinsic(node.tag, node.items.map((item) => toPlain(item, doc)));
  if (isMap(node)) {
    const map: Record<string, Json> = {};
    for (const pair of node.items) map[String(toPlain(pair.key, doc))] = toPlain(pair.value, doc);
    return wrapIntrinsic(node.tag, map);
  }
  return null;
}

/**
 * Reads a file as a CloudFormation template.
 *
 * @returns The template's `Resources`, or undefined when the file is not a CloudFormation template.
 * @throws {Error} If a YAML file that looks like a template does not parse.
 */
function readResources(file: SourceFile): Record<string, Json> | undefined {
  // A cheap check first: every template names its resources' types, and this extractor is offered
  // every JSON and YAML file in a repository.
  if (!file.content.includes("AWS::")) return undefined;

  let template: Json;
  if (file.content.trimStart().startsWith("{")) {
    try {
      template = JSON.parse(file.content) as Json;
    } catch {
      return undefined; // Not JSON after all (a tsconfig with comments, say), so not a template.
    }
  } else {
    const doc = parseDocument(file.content);
    const error = doc.errors[0];
    if (error) throw new Error(`Invalid YAML in ${file.path}: ${error.message.split("\n")[0]}`);
    template = toPlain(doc.contents, doc);
  }
  return isRecord(template) && isRecord(template["Resources"]) ? template["Resources"] : undefined;
}

/** Names inside `${...}` in an `Fn::Sub` string, ignoring `${!Literal}` escapes. */
function substitutedNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\$\{([^}]+)\}/g)) {
    const inner = match[1] ?? "";
    if (!inner.startsWith("!")) names.push(inner.split(".")[0]?.trim() ?? "");
  }
  return names;
}

/**
 * Logical ids of the resources a value refers to, through `Ref`, `Fn::GetAtt` and `Fn::Sub`. Only
 * names that are resources in this template count: parameters and pseudo parameters such as
 * `AWS::Region` are not.
 */
function referencesIn(value: Json | undefined, known: ReadonlySet<string>, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) referencesIn(item, known, found);
  } else if (isRecord(value)) {
    for (const [key, inner] of Object.entries(value)) {
      if (key === "Ref" && typeof inner === "string") {
        if (known.has(inner)) found.add(inner);
      } else if (key === "Fn::GetAtt") {
        const first = Array.isArray(inner) ? inner[0] : typeof inner === "string" ? inner.split(".")[0] : undefined;
        if (typeof first === "string" && known.has(first)) found.add(first);
      } else if (key === "Fn::Sub") {
        const [text, variables] = Array.isArray(inner) ? inner : [inner, undefined];
        if (typeof text === "string") for (const name of substitutedNames(text)) if (known.has(name)) found.add(name);
        referencesIn(variables, known, found);
      } else {
        referencesIn(inner, known, found);
      }
    }
  }
  return found;
}

interface Resource {
  type: string;
  properties: Record<string, Json>;
  dependsOn: string[];
}

function asResource(definition: Json | undefined): Resource | undefined {
  if (!isRecord(definition) || typeof definition["Type"] !== "string") return undefined;
  const declared = definition["DependsOn"];
  return {
    type: definition["Type"],
    properties: isRecord(definition["Properties"]) ? definition["Properties"] : {},
    dependsOn: Array.isArray(declared)
      ? declared.filter((name): name is string => typeof name === "string")
      : typeof declared === "string"
        ? [declared]
        : [],
  };
}

/**
 * Resources that only exist to connect two components. Each names the property holding the
 * component that calls, and the properties holding what it calls: nothing references these
 * resources, so following references from a component would never find the link.
 */
const CONNECTORS: Record<string, { from: string[]; to: string[] }> = {
  "AWS::Lambda::Permission": { from: ["SourceArn"], to: ["FunctionName"] },
  "AWS::Lambda::EventSourceMapping": { from: ["EventSourceArn"], to: ["FunctionName"] },
  "AWS::ApiGateway::Method": { from: ["RestApiId"], to: ["Integration"] },
  "AWS::ApiGatewayV2::Integration": { from: ["ApiId"], to: ["IntegrationUri"] },
  "AWS::SNS::Subscription": { from: ["TopicArn"], to: ["Endpoint"] },
  "AWS::AppSync::DataSource": {
    from: ["ApiId"],
    to: [
      "LambdaConfig",
      "DynamoDBConfig",
      "OpenSearchServiceConfig",
      "ElasticsearchConfig",
      "RelationalDatabaseConfig",
      "EventBridgeConfig",
      "HttpConfig",
    ],
  },
};

/** The API a SAM event creates when it doesn't name one. */
const IMPLICIT_APIS: Record<string, { logicalId: string; type: string; property: string }> = {
  Api: { logicalId: "ServerlessRestApi", type: "AWS::Serverless::Api", property: "RestApiId" },
  HttpApi: { logicalId: "ServerlessHttpApi", type: "AWS::Serverless::HttpApi", property: "ApiId" },
};

/**
 * Reads CloudFormation and SAM templates, in JSON or YAML, including the short-form functions
 * (`!Ref`, `!GetAtt`, `!Sub`...).
 *
 * Databases, tables, buckets, queues, topics, functions, APIs and similar resources become
 * components, each with its resource type. A component depends on another when it refers to it
 * through `Ref`, `Fn::GetAtt`, `Fn::Sub` or `DependsOn`. A reference through a resource that isn't a
 * component counts as one to whatever that resource refers to, so a function that uses an IAM role
 * depends on the tables the role grants access to.
 *
 * The arrow points from whoever calls to whoever is called, so an API points at the function
 * behind it, and a queue at the function it triggers: the SAM events of a function, and resources
 * that only connect two others (Lambda permissions and event source mappings, API Gateway
 * methods, SNS subscriptions, AppSync data sources), are read that way round.
 *
 * Templates that don't declare an API but have functions with `Api` or `HttpApi` events get the
 * `ServerlessRestApi` / `ServerlessHttpApi` SAM creates for them. Other stacks, parameter values
 * and `Fn::ImportValue` are not followed, and S3 buckets are drawn as databases.
 *
 * The user's rules are keyed by resource type, with `*` as a wildcard. They choose the kind a type
 * is drawn as — including types this extractor doesn't know, such as `Custom::Thing` — or `ignore`
 * to stop drawing it, in which case it is looked through like any resource that isn't a component.
 *
 * Matches every JSON, YAML and `.template` file outside an Amplify backend, and reads as empty
 * whatever isn't a template. Component ids include the file's path, since two templates commonly
 * reuse a logical id.
 */
export const cloudFormationExtractor: Extractor = {
  name: "cloudformation",

  matches: (path) => TEMPLATE_FILE.test(path) && !AMPLIFY_TREE.test(path),

  extract(file, options) {
    const raw = readResources(file);
    if (!raw) return { nodes: [], edges: [] };

    const resources = new Map<string, Resource>();
    for (const [logicalId, definition] of Object.entries(raw)) {
      const resource = asResource(definition);
      if (resource) resources.set(logicalId, resource);
    }
    const known = new Set(resources.keys());
    const id = (logicalId: string) => `${file.path}#${logicalId}`;

    const nodes = new Map<string, ArchNode>();
    const addNode = (logicalId: string, type: string) => {
      const kind = kindOf(type, options?.rules);
      if (kind) nodes.set(logicalId, { id: id(logicalId), name: logicalId, kind, source: file.path, type });
    };
    for (const [logicalId, { type }] of resources) addNode(logicalId, type);

    const edges = new Map<string, ArchEdge>();
    const link = (from: string, to: string, label: string) => {
      if (from !== to && nodes.has(from) && nodes.has(to)) edges.set(`${from} ${to}`, { from: id(from), to: id(to), label });
    };

    // SAM events describe what triggers a resource, so they are read separately, pointing inwards.
    const references = new Map<string, Set<string>>();
    for (const [logicalId, { properties, dependsOn }] of resources) {
      const { Events: events, ...rest } = properties;
      const outgoing = referencesIn(rest, known);
      for (const name of dependsOn) if (known.has(name)) outgoing.add(name);
      references.set(logicalId, outgoing);

      if (!isRecord(events)) continue;
      for (const event of Object.values(events)) {
        if (!isRecord(event) || typeof event["Type"] !== "string") continue;
        const eventProperties = isRecord(event["Properties"]) ? event["Properties"] : {};
        for (const source of referencesIn(eventProperties, known)) link(source, logicalId, "triggers");

        const implicit = IMPLICIT_APIS[event["Type"]];
        if (implicit && !(implicit.property in eventProperties)) {
          if (!nodes.has(implicit.logicalId)) addNode(implicit.logicalId, implicit.type);
          link(implicit.logicalId, logicalId, "triggers");
        }
      }
    }

    // A component depends on what it refers to, looking through resources that aren't components.
    for (const start of nodes.keys()) {
      const visited = new Set<string>([start]);
      const pending = [...(references.get(start) ?? [])];
      for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
        if (visited.has(name)) continue;
        visited.add(name);
        if (nodes.has(name)) link(start, name, "references");
        else pending.push(...(references.get(name) ?? []));
      }
    }

    for (const [, { type, properties }] of resources) {
      const connector = CONNECTORS[type];
      if (!connector) continue;
      const side = (names: string[]) => {
        const found = new Set<string>();
        for (const name of names) referencesIn(properties[name], known, found);
        return found;
      };
      for (const from of side(connector.from)) for (const to of side(connector.to)) link(from, to, "triggers");
    }

    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  },
};
