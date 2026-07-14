# 0001: GitHub is the theme source of truth

## Status

Accepted on 2026-07-14.

## Context

N8Forged needs a maintainable theme workflow that can be managed primarily by
Codex, reviewed through GitHub, and synchronized predictably to Shopify.

## Decision

GitHub is the canonical source for permanent theme changes. `main` represents
production, `development` represents integrated active work, and feature
branches isolate changes. Shopify's GitHub integration connects the long-lived
branches to their corresponding themes. Production changes are promoted by
pull request and never committed directly.

## Consequences

- Every permanent theme change has reviewable Git history.
- Visual-editor changes must be synchronized back into Git.
- Branch protection and automated validation are release requirements.
- Emergency Shopify actions must be reconciled into Git immediately afterward.
