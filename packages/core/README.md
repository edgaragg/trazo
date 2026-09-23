# @trazo/core

The engine behind [Trazo](https://github.com/edgaragg/trazo): it reads infrastructure files into an architecture model, compares two models, and renders them as Mermaid diagrams and Markdown. It never touches the filesystem, so it is easy to embed and to test.

Most people want the command line ([`trazo`](https://www.npmjs.com/package/trazo)) or a CI integration instead. Use this package to build your own tooling on the same model.

```bash
npm install @trazo/core
```

## Example

```ts
import { extractModel, diffModels, toMermaid, renderDiffMarkdown } from "@trazo/core";

const before = extractModel([{ path: "docker-compose.yml", content: oldYaml }]);
const after = extractModel([{ path: "docker-compose.yml", content: newYaml }]);

console.log(toMermaid(after)); // a Mermaid flowchart
console.log(renderDiffMarkdown(diffModels(before, after), after)); // what changed
```

Files are passed in as `{ path, content }`, with paths relative to the scanned root. Docker Compose files and Kubernetes manifests are recognised; see the [main README](https://github.com/edgaragg/trazo#readme) for what is detected and what is not.

Requires Node.js 20 or later. MIT licensed.
