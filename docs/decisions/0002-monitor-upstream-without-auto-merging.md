# 0002: Monitor Horizon without automatic imports

## Status

Accepted on 2026-07-14.

## Context

N8Forged benefits from Shopify's Horizon fixes and platform compatibility, but
upstream theme changes can conflict with store configuration, schema validation,
apps, and future brand customizations.

## Decision

A scheduled read-only workflow detects upstream Horizon commits and opens or
updates a maintenance issue. Upstream code is never merged automatically. Each
update is evaluated and tested on a dedicated feature branch before promotion.

## Consequences

- New Horizon work becomes visible without requiring manual monitoring.
- Automation cannot unexpectedly modify the storefront.
- A human or Codex review remains required for conflicts and regression testing.
- Maintenance issues provide an auditable update history.
