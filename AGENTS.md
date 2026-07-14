# N8Forged Shopify Engineering Guide

This repository is the permanent source of truth for the N8Forged Shopify theme.

## Branch policy

- `main` is production. Never commit or push directly to it.
- `development` is the integration branch for active work.
- Create feature branches from `development` using `feature/<short-description>`.
- Open pull requests from feature branches into `development`.
- Promote tested releases from `development` to `main` with a pull request.
- Squash feature pull requests; use a merge commit for `development` to `main`
  releases so long-lived branch ancestry is preserved.

## Change policy

- Keep every commit focused and use a meaningful imperative commit message.
- Do not redesign, publish, or change production theme settings without explicit approval.
- Preserve Shopify theme architecture and validate Liquid, JSON, JavaScript, and CSS changes before opening a pull request.
- Install dependencies with `npm ci` and run `npm run theme:check` before each pull request.
- Never commit secrets, Shopify access tokens, customer data, or local environment files.
- Treat changes made in Shopify's visual editor as production drift until they are synchronized back into Git.

## Upstream Horizon updates

The official Shopify Horizon repository is configured locally as `upstream`.
Import upstream releases on a dedicated feature branch, validate them, and merge through `development` before promoting to `main`.

## Operating procedures

- Follow `docs/development.md` for local previews.
- Follow `docs/releases.md` for production promotions.
- Follow `docs/rollback.md` for recovery; never rewrite production history.
- Record durable architecture choices in `docs/decisions/`.
