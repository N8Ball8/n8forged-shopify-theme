# Release process

## Versioning

N8Forged uses Semantic Versioning for theme releases:

- Patch (`0.1.1`): fixes and small non-breaking refinements.
- Minor (`0.2.0`): new sections, templates, or compatible features.
- Major (`1.0.0`): a deliberate launch milestone or incompatible architecture
  change.

The store is pre-launch, so versions remain below `1.0.0` until the first public
production launch.

## Promote a release

1. Confirm all intended feature pull requests are merged into `development`.
2. Verify the unpublished development theme in Shopify on desktop and mobile.
3. Move entries from `Unreleased` into a dated version in `CHANGELOG.md`.
4. Open a pull request from `development` to `main` titled
   `Release v<version>`.
5. Confirm Theme Check passes and review the complete release diff.
6. Merge the release pull request using a merge commit so `main` remains an
   ancestor of `development`. Squash merging long-lived branches causes their
   histories to diverge and must not be used for releases.
7. Verify Shopify's GitHub integration reports zero failed files for `main`.
8. Confirm the public storefront identifies the expected live theme and perform
   a smoke test of navigation, product pages, cart, and checkout entry.
9. Create the annotated Git tag and GitHub release from the merged `main`
   commit.

Publishing or reconnecting a production theme requires explicit owner approval.
Routine release pull requests must not include a manual live-theme command.

## Release checklist

- Required CI checks passed.
- Development theme was tested.
- No secrets or customer data are present.
- Changelog and version agree.
- Shopify integration completed without rejected files.
- Production smoke test passed.
- Rollback target is known before release.

## Merge policy

- Feature branches into `development`: squash merge.
- `development` into `main`: merge commit.
- After production: merge `main` back into `development` if GitHub does not
  already show `main` as an ancestor.

This distinction keeps feature history concise without breaking the ancestry
needed for reliable repeated production promotions.
