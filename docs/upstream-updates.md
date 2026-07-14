# Horizon upstream updates

The official Shopify Horizon repository is configured locally as `upstream`.
A weekly GitHub workflow checks for new commits and opens one maintenance issue
when review is needed. It never imports changes automatically.

## Evaluate an update

1. Read Shopify's release notes and inspect the full upstream diff.
2. Confirm the update is compatible with the current Shopify platform and
   N8Forged customizations.
3. Start `feature/horizon-<version>` from current `development`.
4. Merge the selected signed upstream tag or commit; do not blindly track
   Horizon's moving `main` branch.
5. Resolve conflicts deliberately, preserving N8Forged configuration and GitHub
   integration compatibility fixes.
6. Run `npm ci` and `npm run theme:check`.
7. Preview and regression-test the unpublished development theme.
8. Open a feature pull request into `development` and document upstream release
   notes, conflicts, and retained customizations.
9. Promote through the normal release process only after owner approval.

## Required regression checks

- Header, footer, menus, and search.
- Home, collection, product, cart, contact, and password templates.
- Theme-editor schema loading with no rejected files.
- App blocks, including Printify-created product content.
- Desktop and mobile layout, keyboard navigation, and basic accessibility.
- Shopify GitHub integration logs report zero failed files.

## Compatibility warning

The initial Horizon 4.1.1 import required replacing invalid dynamic color
defaults in block schemas with literal colors for Shopify's GitHub validator.
Every upstream update must check whether those schema defaults were reintroduced
before it can be merged.
