# 0004: Custom mission art auction

Status: accepted

## Context

N8Forged needs a one-off, internationally accessible art auction that matches
the storefront and supports proxy bidding, a hidden reserve, anti-sniping
extensions, passwordless bidder verification, transactional email, private
administration, and Shopify winner checkout. Shopify theme Liquid cannot safely
enforce those server-side rules or store private bidder data.

## Decision

Use the Shopify theme for editable artwork content and the bidder interface.
Use Supabase Auth, Postgres, and Edge Functions for all private identity and
authoritative auction behavior. Use Resend for auction email. Create the
winner's payable order through Shopify so tax, shipping, payment, and order
records stay in the existing commerce system.

The browser is never authoritative for price, winner, reserve status, auction
time, or permissions. Bid events are immutable; administrative removal marks
them invalid and records a reason. Sensitive values such as real identity and
Maximum Bid are protected by row-level security and exposed only to the bidder
or sole administrator.

## Launch safety

The page template and homepage promotion ship disabled. Launch requires all of:

- approved content and artwork media;
- successful test-mode acceptance;
- verified sender domain and email delivery;
- Shopify payment, tax, shipping, and draft-order verification;
- a production data backup;
- `approved_to_launch = true`;
- assignment of the page template in Shopify;
- enabling the homepage auction promotion.

## Consequences

The auction is custom and has no Shopify auction-app subscription, but requires
Supabase and Resend accounts plus a Shopify custom app. The server-side
integration must be deployed and monitored through auction close. The database
and audit trail remain available for one year, after which personal contact
details are deleted and the bid archive is anonymized.
