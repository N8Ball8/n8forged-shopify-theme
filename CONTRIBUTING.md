# Contributing to the N8Forged Shopify Theme

Install the pinned toolchain with `npm ci`. Detailed setup and preview
instructions are in [docs/development.md](docs/development.md).

## Standard workflow

1. Update local branches:
   `git fetch origin upstream`
2. Start from the integration branch:
   `git switch development && git pull --ff-only origin development`
3. Create a branch:
   `git switch -c feature/<short-description>`
4. Make and validate one focused change at a time with `npm run theme:check`
   and `npm run theme:dev`.
5. Commit with a meaningful imperative message.
6. Push the feature branch and open a pull request into `development`.
7. Test the development theme in Shopify before merging a release pull request into `main`.

Squash-merge feature pull requests into `development`. Merge release pull
requests from `development` into `main` with a merge commit so the long-lived
branches retain shared ancestry.

The complete promotion and recovery procedures are documented in
[docs/releases.md](docs/releases.md) and [docs/rollback.md](docs/rollback.md).

## Production safeguards

- Do not push to `main`.
- Do not connect feature branches directly to the live Shopify theme.
- Do not publish a Shopify theme as part of routine development.
- A production release must be represented by a reviewed pull request from `development` into `main`.

## Branch roles

| Branch | Purpose | Shopify target |
| --- | --- | --- |
| `main` | Production source | Live theme connection |
| `development` | Integrated active work | Unpublished development theme |
| `feature/*` | Isolated major changes | Local preview or temporary test theme |
