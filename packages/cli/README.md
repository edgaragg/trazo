# @edgaragg/trazo-cli

> **Alpha.** Trazo works end to end, but it is at version 0.x: the command line, the configuration format and the library API can still change between minor versions, and some of what it reads is not covered yet (see the [limitations](https://github.com/edgaragg/trazo#limitations)). Pin the version you use.

Architecture docs that can't go stale. Trazo reads your Docker Compose files, Kubernetes manifests, CloudFormation / SAM templates and AWS Amplify backends, draws the architecture as a [Mermaid](https://mermaid.js.org) diagram, and reports what changed between two git revisions.

The diagram is generated from the files that already define your system, not guessed by a language model, so it can't invent things that aren't there.

The command is called `trazo`. Run it without installing, or install it once:

```bash
npx @edgaragg/trazo-cli generate
npm install -g @edgaragg/trazo-cli   # then just: trazo generate
```

```bash
trazo generate                                          # print a Mermaid diagram of the current directory
trazo generate --format markdown --out ARCHITECTURE.md  # or a full document, written to a file
trazo generate --write                                  # or written to .trazo/architecture.md
trazo diff --base main                                  # what changed since a git revision
trazo bitbucket-comment                                 # post that report on a Bitbucket pull request
```

A `trazo.config.yaml` in the scanned directory changes where `--write` puts the document, how components are drawn, and what each extractor's findings become; see the [main README](https://github.com/edgaragg/trazo#configuration).

`trazo diff` reads the base revision straight from git, so it never touches your working tree. In CI it needs the full history (`fetch-depth: 0` on GitHub Actions, `clone: depth: full` on Bitbucket).

## On Bitbucket Pipelines

`trazo bitbucket-comment` posts the report as a pull request comment. One comment is kept up to date on every push, and nothing is posted when the architecture didn't change.

```yaml
pipelines:
  pull-requests:
    '**':
      - step:
          name: Architecture
          image: node:22
          clone:
            depth: full # Trazo compares against the destination revision, so it needs history.
          script:
            - npx @edgaragg/trazo-cli bitbucket-comment
```

Bitbucket doesn't hand a pipeline a token that can write to pull requests, so add one: a [Repository Access Token](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-tokens/) with the `pullrequest:write` permission, saved as a secured repository variable named `TRAZO_BITBUCKET_TOKEN`.

By default Bitbucket doesn't run a pull-request pipeline for a pull request opened from a fork, so this never runs on those.

## On GitHub

Use the GitHub Action described in the [main README](https://github.com/edgaragg/trazo#readme).

Requires Node.js 20 or later. MIT licensed.
