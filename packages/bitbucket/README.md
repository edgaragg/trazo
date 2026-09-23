# @trazo/bitbucket

Posts [Trazo](https://github.com/edgaragg/trazo)'s architecture report as a comment on Bitbucket pull requests, from a Bitbucket Pipelines step. One comment is kept up to date on every push, and nothing is posted when the architecture didn't change.

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
            - npx --package=@trazo/bitbucket trazo-bitbucket
```

Bitbucket doesn't hand a pipeline a token that can write to pull requests, so add one: a [Repository Access Token](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-tokens/) with the `pullrequest:write` permission, saved as a secured repository variable named `TRAZO_BITBUCKET_TOKEN`.

By default Bitbucket doesn't run a pull-request pipeline for a pull request opened from a fork, so this step never runs on those.

See the [main README](https://github.com/edgaragg/trazo#readme) for what Trazo detects. Requires Node.js 20 or later. MIT licensed.
