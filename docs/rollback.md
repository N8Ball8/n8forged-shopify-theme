# Rollback procedure

A rollback restores a known-good production commit while preserving the audit
trail. Never rewrite `main` history.

## Preferred Git rollback

1. Identify the last known-good release tag and the faulty release pull request.
2. Create `hotfix/rollback-<version>` from current `main`.
3. Revert the faulty merge commit with `git revert`; do not reset or force-push.
4. Run `npm run theme:check` and inspect the resulting diff.
5. Open an urgent pull request into `main` and obtain owner approval.
6. Merge after required checks pass, then verify the Shopify GitHub integration
   and storefront.
7. Record the rollback in `CHANGELOG.md` and create a patch release.

## Emergency Shopify rollback

If the storefront is materially broken and GitHub synchronization is too slow,
the store owner may publish the retained previous theme in Shopify Admin. This
is an emergency action and requires explicit approval. Immediately afterward:

1. Record which theme and version were published.
2. Complete the Git revert procedure above.
3. Reconnect or republish the Git-controlled `main` theme only after validation.

Do not delete prior themes until a newer release has been stable and a rollback
target remains available.
