# N8Forged Shopify Theme

This repository is the canonical source for the N8Forged storefront at
[n8forged.com](https://n8forged.com). The theme is based on Shopify's official
[Horizon](https://github.com/Shopify/horizon) theme and is maintained through a
GitHub-first development and release process.

## Environments

| Branch | Purpose | Shopify theme |
| --- | --- | --- |
| `main` | Production source | Live theme (`165037768944`) |
| `development` | Integrated active work | Unpublished development theme (`165037277424`) |
| `feature/*` | Isolated changes | Local development preview |

Never commit directly to `main` or publish a theme as part of routine
development. See [CONTRIBUTING.md](CONTRIBUTING.md) for the required workflow.

## Local setup

Requirements: Git, Node.js 20 or newer, and access to the N8Forged Shopify
store.

```sh
npm ci
npm run shopify:login
npm run theme:check
npm run theme:dev
```

`theme:dev` creates a safe development preview; it does not publish the live
theme. Authentication is stored by Shopify CLI and must never be committed.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run theme:check` | Validate Liquid, JSON, schema, JavaScript, and CSS |
| `npm run theme:dev` | Start a local preview against the N8Forged store |
| `npm run theme:list` | Display Shopify theme IDs and publication state |

## Documentation

- [Development guide](docs/development.md)
- [Release process](docs/releases.md)
- [Rollback procedure](docs/rollback.md)
- [Architecture decisions](docs/decisions/README.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Upstream and license

The local `upstream` Git remote tracks `Shopify/horizon`. Upstream updates must
be imported on a feature branch and promoted through the normal release
process. N8Forged-specific work and Shopify Horizon history remain separate and
auditable in Git.

Copyright (c) 2025-present Shopify Inc. Horizon remains subject to
[LICENSE.md](LICENSE.md).
