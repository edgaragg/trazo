# @edgaragg/trazo-core

> **Alpha.** Trazo works end to end, but it is at version 0.x: the command line, the configuration format and the library API can still change between minor versions, and some of what it reads is not covered yet (see the [limitations](https://github.com/edgaragg/trazo#limitations)). Pin the version you use.

The engine behind [Trazo](https://github.com/edgaragg/trazo): it reads infrastructure files into an architecture model, compares two models, and renders them as Mermaid diagrams and Markdown. It never touches the filesystem, so it is easy to embed and to test.

Most people want the command line ([`@edgaragg/trazo-cli`](https://www.npmjs.com/package/@edgaragg/trazo-cli)) or a CI integration instead. Use this package to build your own tooling on the same model.

```bash
npm install @edgaragg/trazo-core
```

## Example

```ts
import { extractModel, diffModels, toMermaid, renderDiffMarkdown } from "@edgaragg/trazo-core";

const before = extractModel([{ path: "docker-compose.yml", content: oldYaml }]);
const after = extractModel([{ path: "docker-compose.yml", content: newYaml }]);

console.log(toMermaid(after)); // a Mermaid flowchart
console.log(renderDiffMarkdown(diffModels(before, after), after)); // what changed
```

Files are passed in as `{ path, content }`, with paths relative to the scanned root. Docker Compose files, Kubernetes manifests, CloudFormation / SAM templates and AWS Amplify (Gen 1) backends are recognised; see the [main README](https://github.com/edgaragg/trazo#readme) for what is detected and what is not.

Configuration is passed in too: `parseConfig(yamlText, path)` validates a `trazo.config.yaml`, and its `extractors` section is the third argument of `extractModel` while `kinds` goes to `toMermaid`, `renderDiffMarkdown` and `renderArchitectureMarkdown`. See [Configuration](https://github.com/edgaragg/trazo#configuration).

Requires Node.js 20 or later. MIT licensed.
