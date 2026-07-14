# Contributing to the N8Forged Shopify Theme

## Standard workflow

1. Update local branches:
   `git fetch origin upstream`
2. Start from the integration branch:
   `git switch development && git pull --ff-only origin development`
3. Create a branch:
   `git switch -c feature/<short-description>`
4. Make and validate one focused change at a time.
5. Commit with a meaningful imperative message.
6. Push the feature branch and open a pull request into `development`.
7. Test the development theme in Shopify before merging a release pull request into `main`.

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
