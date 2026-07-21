# N8Forged Mission Art Auction backend

The Shopify theme is the presentation layer. Supabase is the authoritative
backend for bidder identity, proxy bidding, extensions, audit history, and the
email outbox.

## Services

- Supabase Auth: passwordless email OTP codes
- Supabase Postgres: auction state and immutable bid ledger
- Supabase Edge Functions: public API, admin API, email worker, auction close
- Resend: `N8Forged Mission Art Auction <auction@n8forged.com>`
- Shopify Admin API: winning draft order, tax, shipping, invoice, and payment

Never put the Supabase service role key, Resend API key, or Shopify Admin API
token into Liquid, theme settings, Git, or browser JavaScript.

## Initial setup

1. Create the Supabase project in a US region.
2. Link the local project with the Supabase CLI.
3. Apply migrations to a non-production Supabase project.
4. Customize the Supabase OTP template to display `{{ .Token }}`.
5. Add `https://n8forged.com` to the allowed web origins.
6. Add the admin user for `N8Darby@gmail.com` to `auction_admins`.
7. Verify `n8forged.com` in Resend and set reply-to to `N8Darby@gmail.com`.
8. Configure Edge Function secrets from `.env.example`.
9. Run the complete test-mode acceptance checklist before setting
   `approved_to_launch = true` and `test_mode = false`.

The theme section's API URL must remain blank until the backend has passed the
test-mode checklist. A blank value intentionally disables registration and
bidding.
