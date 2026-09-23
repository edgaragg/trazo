# trazo

Architecture docs that can't go stale. Trazo reads your Docker Compose files and Kubernetes manifests, draws the architecture as a [Mermaid](https://mermaid.js.org) diagram, and reports what changed between two git revisions.

The diagram is generated from the files that already define your system, not guessed by a language model, so it can't invent things that aren't there.

```bash
npx trazo generate                                    # print a Mermaid diagram of the current directory
npx trazo generate --format markdown --out ARCHITECTURE.md   # or a full document, written to a file
npx trazo diff --base main                            # what changed since a git revision
```

`trazo diff` reads the base revision straight from git, so it never touches your working tree. In CI it needs the full history (`fetch-depth: 0` on GitHub Actions).

## In CI

To get the diff posted as a pull request comment, use the GitHub Action or the Bitbucket Pipelines step from the [main README](https://github.com/edgaragg/trazo#readme).

Requires Node.js 20 or later. MIT licensed.
