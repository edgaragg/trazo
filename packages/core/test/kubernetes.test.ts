import { describe, expect, it } from "vitest";
import { extractModel, kubernetesExtractor } from "../src/index.js";

const manifest = (content: string, path = "k8s/app.yaml") => ({ path, content });

describe("kubernetesExtractor", () => {
  it.each(["deployment.yaml", "k8s/base/api.yml", "anything.yaml"])("matches %s", (path) => {
    expect(kubernetesExtractor.matches(path)).toBe(true);
  });

  it.each(["Dockerfile", "package.json", "notes.txt"])("ignores %s", (path) => {
    expect(kubernetesExtractor.matches(path)).toBe(false);
  });

  it("turns a Deployment into a component classified by its image", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
spec:
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - image: postgres:16
`),
    );

    expect(model.nodes).toEqual([
      { id: "db", name: "db", kind: "database", source: "k8s/app.yaml", image: "postgres:16" },
    ]);
    expect(model.edges).toEqual([]);
  });

  it.each(["StatefulSet", "DaemonSet"])("reads a %s the same way as a Deployment", (kind) => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: apps/v1
kind: ${kind}
metadata:
  name: cache
spec:
  template:
    spec:
      containers:
        - image: redis:7
`),
    );
    expect(model.nodes[0]).toMatchObject({ id: "cache", kind: "cache", image: "redis:7" });
  });

  it("reads a CronJob's image from its nested job template", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-cleanup
spec:
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - image: ghcr.io/acme/cleanup:1.0
`),
    );
    expect(model.nodes[0]).toMatchObject({ id: "nightly-cleanup", kind: "service", image: "ghcr.io/acme/cleanup:1.0" });
  });

  it("reads a bare Pod's image and labels from its own spec, not a template", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: v1
kind: Pod
metadata:
  name: debug
spec:
  containers:
    - image: busybox:1.36
`),
    );
    expect(model.nodes[0]).toMatchObject({ id: "debug", image: "busybox:1.36" });
  });

  it("ignores resources that are not workloads, Services or Ingresses", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
data:
  key: value
`),
    );
    expect(model).toEqual({ nodes: [], edges: [] });
  });

  it("does not draw a Service on its own", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector:
    app: api
`),
    );
    expect(model.nodes).toEqual([]);
  });

  it("links an Ingress to the workload its backend Service selects (v1 shape)", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - image: acme/api:1.0
---
apiVersion: v1
kind: Service
metadata:
  name: api-svc
spec:
  selector:
    app: api
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  rules:
    - http:
        paths:
          - path: /
            backend:
              service:
                name: api-svc
`),
    );

    expect(model.nodes.map((n) => n.id).sort()).toEqual(["api", "web"]);
    expect(model.edges).toEqual([{ from: "web", to: "api", label: "routes to" }]);
  });

  it("also reads the legacy extensions/v1beta1 backend and defaultBackend shape", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - image: acme/api:1.0
---
apiVersion: v1
kind: Service
metadata:
  name: api-svc
spec:
  selector:
    app: api
---
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: web
spec:
  backend:
    serviceName: api-svc
    servicePort: 80
`),
    );
    expect(model.edges).toEqual([{ from: "web", to: "api", label: "routes to" }]);
  });

  it("links to every workload a Service's selector matches", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-a
spec:
  template:
    metadata:
      labels:
        tier: api
    spec:
      containers: [{ image: acme/api:1.0 }]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-b
spec:
  template:
    metadata:
      labels:
        tier: api
    spec:
      containers: [{ image: acme/api:1.0 }]
---
apiVersion: v1
kind: Service
metadata:
  name: api-svc
spec:
  selector:
    tier: api
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  defaultBackend:
    service:
      name: api-svc
`),
    );
    expect(model.edges.map((e) => e.to).sort()).toEqual(["api-a", "api-b"]);
  });

  it("does not link a Service with no selector, to avoid matching every workload", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  template:
    spec:
      containers: [{ image: acme/api:1.0 }]
---
apiVersion: v1
kind: Service
metadata:
  name: api-svc
spec: {}
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  defaultBackend:
    service:
      name: api-svc
`),
    );
    expect(model.edges).toEqual([]);
  });

  it("drops an Ingress backend whose Service is not declared in the file", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  defaultBackend:
    service:
      name: elsewhere-svc
`),
    );
    expect(model.nodes).toEqual([{ id: "web", name: "web", kind: "service", source: "k8s/app.yaml" }]);
    expect(model.edges).toEqual([]);
  });

  it("reads every document in a multi-document file", () => {
    const model = kubernetesExtractor.extract(
      manifest(`
apiVersion: apps/v1
kind: Deployment
metadata: { name: a }
spec:
  template:
    spec:
      containers: [{ image: x }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: b }
spec:
  template:
    spec:
      containers: [{ image: y }]
`),
    );
    expect(model.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("is a harmless no-op on YAML without a Kubernetes kind", () => {
    const model = kubernetesExtractor.extract(manifest("name: CI\non: push\njobs: {}\n", ".github/workflows/ci.yml"));
    expect(model).toEqual({ nodes: [], edges: [] });
  });

  it("treats an empty file as an empty model", () => {
    expect(kubernetesExtractor.extract(manifest(""))).toEqual({ nodes: [], edges: [] });
  });

  it("names the file when a document is malformed", () => {
    expect(() => kubernetesExtractor.extract(manifest("kind: [Deployment\n", "bad/app.yaml"))).toThrow(
      /Invalid YAML in bad\/app\.yaml/,
    );
  });
});

describe("extractModel with Kubernetes files", () => {
  it("lets docker-compose claim compose-named files ahead of the broader kubernetes matcher", () => {
    const model = extractModel([manifest("services:\n  api: {}\n", "docker-compose.yml")]);
    expect(model.nodes).toEqual([
      { id: "api", name: "api", kind: "service", source: "docker-compose.yml" },
    ]);
  });

  it("resolves an Ingress to a workload declared in a different manifest file", () => {
    const model = extractModel([
      manifest(
        `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  template:
    metadata:
      labels:
        app: api
    spec:
      containers: [{ image: acme/api:1.0 }]
---
apiVersion: v1
kind: Service
metadata:
  name: api-svc
spec:
  selector:
    app: api
`,
        "k8s/api.yaml",
      ),
      manifest(
        `
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  defaultBackend:
    service:
      name: api-svc
`,
        "k8s/ingress.yaml",
      ),
    ]);

    // A Service defined in a different file from the Ingress that references it cannot be
    // resolved by either single extract() call, so no edge is produced — a documented limit.
    expect(model.nodes.map((n) => n.id).sort()).toEqual(["api", "web"]);
    expect(model.edges).toEqual([]);
  });
});
