import { describe, expect, it } from "vitest";
import { amplifyExtractor, extractModel } from "../src/index.js";

const CONFIG = "amplify/backend/backend-config.json";
const config = (value: unknown, path = CONFIG) => ({ path, content: JSON.stringify(value) });

describe("amplifyExtractor", () => {
  it("only reads the backend config of an Amplify project", () => {
    expect(amplifyExtractor.matches("amplify/backend/backend-config.json")).toBe(true);
    expect(amplifyExtractor.matches("apps/web/amplify/backend/backend-config.json")).toBe(true);
    expect(amplifyExtractor.matches("backend-config.json")).toBe(false);
    expect(amplifyExtractor.matches("amplify/backend/function/fn/parameters.json")).toBe(false);
  });

  it("turns each resource into a component, with its service as the type", () => {
    const model = amplifyExtractor.extract(
      config({
        function: { checkout: { service: "Lambda", providerPlugin: "awscloudformation", build: true } },
        storage: { orders: { service: "DynamoDB" }, uploads: { service: "S3" } },
        auth: { shopauth: { service: "Cognito" } },
        analytics: { events: { service: "Kinesis" } },
      }),
    );

    const byId = Object.fromEntries(model.nodes.map((node) => [node.id, node]));
    expect(byId["function/checkout"]).toMatchObject({ name: "checkout", kind: "service", type: "Lambda", source: CONFIG });
    expect(byId["storage/orders"]).toMatchObject({ kind: "database", type: "DynamoDB" });
    expect(byId["storage/uploads"]).toMatchObject({ kind: "database", type: "S3" });
    expect(byId["auth/shopauth"]).toMatchObject({ kind: "service", type: "Cognito" });
    expect(byId["analytics/events"]).toMatchObject({ kind: "queue", type: "Kinesis" });
  });

  it("draws an unfamiliar or missing service as a plain component", () => {
    const model = amplifyExtractor.extract(
      config({ custom: { thing: { service: "customCloudformation" }, bare: { providerPlugin: "x" } } }),
    );
    expect(model.nodes.map((node) => [node.name, node.kind, node.type])).toEqual([
      ["thing", "service", "customCloudformation"],
      ["bare", "service", undefined],
    ]);
    expect("type" in (model.nodes[1] ?? {})).toBe(false);
  });

  it("turns dependsOn into dependencies", () => {
    const model = amplifyExtractor.extract(
      config({
        api: {
          shopapi: {
            service: "AppSync",
            dependsOn: [
              { category: "auth", resourceName: "shopauth", attributes: ["UserPoolId"] },
              { category: "function", resourceName: "checkout", attributes: ["Name", "Arn"] },
            ],
          },
        },
        auth: { shopauth: { service: "Cognito", dependsOn: [] } },
        function: { checkout: { service: "Lambda" } },
      }),
    );

    expect(model.edges).toEqual([
      { from: "api/shopapi", to: "auth/shopauth", label: "dependsOn" },
      { from: "api/shopapi", to: "function/checkout", label: "dependsOn" },
    ]);
  });

  it("accepts the shorter `resource` spelling of a dependency, and skips malformed entries", () => {
    const model = amplifyExtractor.extract(
      config({
        function: {
          fn: {
            service: "Lambda",
            dependsOn: [{ category: "storage", resource: "orders" }, "nonsense", { category: "storage" }, null],
          },
        },
        storage: { orders: { service: "DynamoDB" } },
      }),
    );
    expect(model.edges).toEqual([{ from: "function/fn", to: "storage/orders", label: "dependsOn" }]);
  });

  it("shows category/name when two categories share a resource name", () => {
    const model = amplifyExtractor.extract(
      config({
        api: { checkout: { service: "API Gateway" }, shop: { service: "AppSync" } },
        function: { checkout: { service: "Lambda" } },
      }),
    );
    const names = Object.fromEntries(model.nodes.map((node) => [node.id, node.name]));
    expect(names).toEqual({
      "api/checkout": "api/checkout",
      "api/shop": "shop",
      "function/checkout": "function/checkout",
    });
  });

  it("ignores top-level entries that are not categories of resources", () => {
    const model = amplifyExtractor.extract(config({ version: 1, function: "oops", storage: { orders: 3 } }));
    expect(model).toEqual({ nodes: [], edges: [] });
  });

  it("names the file when it is not valid JSON", () => {
    expect(() => amplifyExtractor.extract({ path: "x/amplify/backend/backend-config.json", content: "{ nope" })).toThrow(
      /Invalid JSON in x\/amplify\/backend\/backend-config\.json/,
    );
  });

  it("drops a dependency on a resource the file doesn't declare", () => {
    const model = extractModel([
      config({ function: { fn: { service: "Lambda", dependsOn: [{ category: "storage", resourceName: "gone" }] } } }),
    ]);
    expect(model.nodes).toHaveLength(1);
    expect(model.edges).toEqual([]);
  });
});
