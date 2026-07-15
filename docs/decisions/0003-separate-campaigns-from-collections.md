# 0003: Separate temporary campaigns from permanent collections

## Status

Accepted on 2026-07-14.

## Context

N8Forged is launching around a mission trip to Costa Rica, but the brand and its
faith-based apparel will continue after the fundraising campaign ends. Replacing
or deleting campaign products later would lose URLs, search equity, customer
links, sales history, and useful product organization.

## Decision

The Costa Rica effort is a temporary marketing campaign, not a permanent product
category. Faith-based shirts belong to the evergreen `Faith Collection`. During
the campaign, selected Faith Collection products can also be featured through a
Costa Rica campaign landing page, navigation entry, or automated collection.

After the trip, campaign messaging and navigation can be retired while the
products remain available in the Faith Collection with stable URLs.

## Consequences

- Campaign messaging can change without migrating or recreating products.
- Faith-based apparel retains a permanent and scalable storefront location.
- Product URLs, analytics, customer links, and sales history remain intact.
- Future fundraising campaigns can reuse the same campaign pattern without
  distorting the long-term catalog structure.
