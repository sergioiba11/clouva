# HTTPS Load Balancer for clouva.com.ar (Phase 12)

Status 2026-07-28: **infrastructure created, DNS not touched.** `clouva.com.ar` still resolves to Railway. Nothing here affects production until the DNS record change below is explicitly confirmed and applied.

## Resources created

| Resource | Name | Notes |
|---|---|---|
| Global static IP | `clouva-web-ip` | `136.69.74.221` |
| Serverless NEG | `clouva-web-neg` (us-central1) | points at Cloud Run service `clouva-web` |
| Backend service | `clouva-web-backend` | `EXTERNAL_MANAGED`, backed by the NEG above |
| Managed SSL cert | `clouva-web-cert` | domain `clouva.com.ar` only (no `www.` -- not used anywhere in the app or DNS today, confirmed by grep) |
| URL map | `clouva-web-lb` | default service `clouva-web-backend` |
| Target HTTPS proxy | `clouva-web-https-proxy` | uses `clouva-web-cert` |
| HTTPS forwarding rule | `clouva-web-https-rule` | `136.69.74.221:443` |
| HTTP redirect URL map | `clouva-web-http-redirect` | `httpsRedirect: true`, permanent redirect |
| Target HTTP proxy | `clouva-web-http-proxy` | uses the redirect URL map |
| HTTP forwarding rule | `clouva-web-http-rule` | `136.69.74.221:80` |

Compute Engine API was not enabled on this project before this phase (this project has been Cloud-Run-only until now) -- enabled it to create these resources.

## Certificate status

`clouva-web-cert` is `PROVISIONING` and will stay that way until DNS actually resolves `clouva.com.ar` to `136.69.74.221` -- Google's managed-cert issuance validates domain control by receiving a real HTTPS request for that hostname through the LB, which can't happen before the DNS change. This is expected, not a problem to fix now.

## Exact DNS record needed (not yet applied)

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `clouva.com.ar` (apex/root) | `136.69.74.221` | 300 (5 min, low on purpose for a fast rollback window during cutover) |

No other DNS records need to change. `NEXT_PUBLIC_SITE_URL` / canonical URL, Supabase Auth redirect URLs, and any OAuth/webhook callback configuration all key off the hostname `clouva.com.ar` itself, not the IP behind it, so none of those need updating for this step.

## Verified so far

- `curl -H "Host: clouva.com.ar" http://136.69.74.221/` against the LB's IP directly (bypassing DNS, simulating what real traffic will see once the A record changes) -- took a few minutes to propagate to Google's edge after creation (expected for a global LB), then confirmed: `301` -> `https://clouva.com.ar:443/`. The explicit `:443` in the redirect Location is normal, cosmetic GCP LB behavior, not a bug.
- HTTPS itself can't be verified yet -- the managed cert is still `PROVISIONING` and won't issue until DNS actually points here (see above).

## Not done -- Phase 15 checkpoint

Changing the actual `clouva.com.ar` DNS A record. This is one of the two explicitly confirmed checkpoints for this migration (the other is decommissioning Railway) -- waiting on the user's go-ahead, and only after Phase 14's full E2E verification passes.
