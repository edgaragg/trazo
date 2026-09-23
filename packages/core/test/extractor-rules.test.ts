import { describe, expect, it } from "vitest";
import { extractModel } from "../src/index.js";

const run = (path: string, content: string, extractors: Record<string, Record<string, string>>) =>
  extractModel([{ path, content }], undefined, { extractors });

const summary = (model: ReturnType<typeof extractModel>) => model.nodes.map((node) => `${node.name}:${node.kind}`).sort();

describe("rules: CloudFormation", () => {
  const template = `
Resources:
  Files: { Type: "AWS::S3::Bucket" }
  Thing: { Type: "Custom::Thing" }
  Worker:
    Type: AWS::Lambda::Function
    Properties: { Environment: { Variables: { F: !Ref Files, T: !Ref Thing } } }
`;

  it("does not draw an unknown type without a rule", () => {
    expect(summary(run("t.yaml", template, {}))).toEqual(["Files:database", "Worker:service"]);
  });

  it("re-maps a known type and draws a type the extractor does not know", () => {
    const model = run("t.yaml", template, { cloudformation: { "AWS::S3::Bucket": "storage", "Custom::*": "service" } });
    expect(summary(model)).toEqual(["Files:storage", "Thing:service", "Worker:service"]);
    expect(model.nodes.find((node) => node.name === "Thing")?.type).toBe("Custom::Thing");
    expect(model.edges).toHaveLength(2);
  });

  it("leaves out an ignored type, and looks through it like any other non-component", () => {
    const model = run(
      "t.yaml",
      `
Resources:
  Table: { Type: "AWS::DynamoDB::Table" }
  Gateway: { Type: "AWS::ApiGateway::RestApi", Properties: { Uses: !Ref Table } }
  Worker: { Type: "AWS::Lambda::Function", Properties: { Api: !Ref Gateway } }
`,
      { cloudformation: { "AWS::ApiGateway::RestApi": "ignore" } },
    );
    expect(summary(model)).toEqual(["Table:database", "Worker:service"]);
    expect(model.edges.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual(["t.yaml#Worker -> t.yaml#Table"]);
  });

  it("only applies a section to its own extractor", () => {
    expect(summary(run("t.yaml", template, { amplify: { "AWS::S3::Bucket": "queue" } }))).toEqual([
      "Files:database",
      "Worker:service",
    ]);
  });
});

describe("rules: Amplify", () => {
  const config = JSON.stringify({
    storage: { orders: { service: "DynamoDB" }, files: { service: "S3" } },
    function: { fn: { service: "Lambda", dependsOn: [{ category: "storage", resourceName: "orders" }] } },
  });
  const path = "amplify/backend/backend-config.json";

  it("re-maps a service", () => {
    expect(summary(run(path, config, { amplify: { s3: "cache" } }))).toEqual(["files:cache", "fn:service", "orders:database"]);
  });

  it("leaves out an ignored service and the dependencies on it", () => {
    const model = run(path, config, { amplify: { DynamoDB: "ignore" } });
    expect(summary(model)).toEqual(["files:database", "fn:service"]);
    expect(model.edges).toEqual([]);
  });
});

describe("rules: Docker Compose", () => {
  const compose =
    "services:\n  api:\n    depends_on: [store, db]\n  store:\n    image: minio/minio:latest\n  db:\n    image: postgres:16\n";

  it("re-maps an image the built-in list does not know", () => {
    expect(summary(run("docker-compose.yml", compose, { "docker-compose": { minio: "storage" } }))).toEqual([
      "api:service",
      "db:database",
      "store:storage",
    ]);
  });

  it("lets a rule beat the built-in classification", () => {
    expect(summary(run("docker-compose.yml", compose, { "docker-compose": { postgres: "service" } }))).toContain("db:service");
  });

  it("leaves out an ignored service and its dependencies", () => {
    const model = run("docker-compose.yml", compose, { "docker-compose": { "post*": "ignore" } });
    expect(summary(model)).toEqual(["api:service", "store:service"]);
    expect(model.edges).toHaveLength(1);
  });
});

describe("rules: Kubernetes", () => {
  const manifest = `
apiVersion: apps/v1
kind: Deployment
metadata: { name: web }
spec:
  template:
    spec:
      containers: [{ name: web, image: "nginx:1" }]
---
apiVersion: batch/v1
kind: CronJob
metadata: { name: nightly }
spec:
  jobTemplate: { spec: { template: { spec: { containers: [{ name: n, image: "postgres:16" }] } } } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: edge }
spec: {}
`;

  it("re-maps by workload kind, and by image", () => {
    const model = run("k.yaml", manifest, { kubernetes: { Ingress: "hexagonal", CronJob: "queue", nginx: "cache" } });
    expect(summary(model)).toEqual(["edge:hexagonal", "nightly:queue", "web:cache"]);
  });

  it("leaves out an ignored workload kind or Ingress", () => {
    expect(summary(run("k.yaml", manifest, { kubernetes: { Ingress: "ignore", CronJob: "ignore" } }))).toEqual(["web:service"]);
  });

  it("puts the workload kind before the image", () => {
    const model = run("k.yaml", manifest, { kubernetes: { Deployment: "queue", nginx: "cache" } });
    expect(summary(model)).toContain("web:queue");
  });
});
