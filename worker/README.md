# Zyntrix OAuth and Deriv Trading Worker — Milestones 2.1–2.3

This Worker provides OAuth sessions, account-scoped WebSocket authorization, and secure Deriv trading connectivity for the Zyntrix GitHub Pages dashboard.

## Routes

- `GET /health` — backend health check.
- `GET /oauth/start` — creates one-time PKCE/state values and redirects to Deriv.
- `GET /oauth/callback` — validates state, exchanges the one-time code server-side, and stores the Deriv access token in KV.
- `POST /oauth/session/exchange` — exchanges a short-lived, one-time browser handoff for an opaque Zyntrix session token.
- `GET /oauth/session` — validates the Zyntrix session token and returns connection metadata only.
- `GET /oauth/accounts` — retrieves the authenticated user's Demo and Real Options accounts; returns only account metadata and never the Deriv access token.
- `POST /oauth/accounts/{accountId}/balance-otp` — verifies account ownership and returns a short-lived WebSocket URL for balance updates.
- `POST /oauth/accounts/{accountId}/trading-otp` — verifies account ownership and returns a short-lived, account-specific WebSocket URL for trading. The dashboard uses it to request proposals, buy contracts, and monitor settlement.
- `POST /oauth/disconnect` — invalidates the Zyntrix session.

## Required Cloudflare setup

1. Create a Cloudflare Worker named `zyntrix-oauth`.
2. Create a Cloudflare Workers KV namespace named `ZYNTRIX_KV`.
3. Bind that namespace to the Worker using the binding name `ZYNTRIX_KV`.
4. Configure these Worker variables:
   - `DERIV_CLIENT_ID` — the Deriv OAuth application ID (keep it in Worker configuration, not dashboard HTML).
   - `APP_ORIGIN` — `https://lanceer254.github.io`.
   - `APP_URL` — `https://lanceer254.github.io/mirror/`.
5. In `wrangler.toml`, replace the KV namespace ID placeholder with the namespace ID returned by Cloudflare.
6. Deploy this Worker.
7. Derive the exact callback URL from the deployed Worker origin: `https://YOUR-WORKER-HOST/oauth/callback`.
8. Add that exact HTTPS callback URL to the Redirect URLs for the Deriv OAuth application. Do not use the GitHub Pages website URL as the callback.

The Deriv application ID is not a client secret, but this setup keeps it out of the public dashboard source. Never put Deriv access tokens, authorization codes, or PKCE verifiers in frontend files or logs.

## Deploy from this directory

Install Wrangler and authenticate with the Cloudflare account, then run:

```sh
npx wrangler login
npx wrangler kv namespace create ZYNTRIX_KV
```

Copy the returned namespace ID into `wrangler.toml`, then deploy:

```sh
npx wrangler deploy
```

Set `DERIV_CLIENT_ID` in the Cloudflare Worker Variables interface, or configure it through a private deployment workflow. Do not paste credentials into source files or public commits.

## Browser session handoff

The callback no longer depends on a cross-site session cookie. This avoids browsers blocking cookies between the GitHub Pages site and the Worker's `workers.dev` domain.

1. After successful OAuth, the Worker redirects to the dashboard with a short-lived `oauth_handoff` value in the URL fragment.
2. The dashboard must read and immediately remove that fragment value from the address bar.
3. The dashboard sends it in a JSON POST to `/oauth/session/exchange`, with the dashboard's exact `Origin`.
4. The Worker consumes the handoff and returns an opaque `sessionToken` and expiry. The Deriv access token is never returned.
5. The dashboard should keep the opaque session token in `sessionStorage` (not a URL, localStorage, or source code) and send it as `Authorization: Bearer <sessionToken>` when calling `/oauth/session` or `/oauth/disconnect`.
6. The handoff expires after 90 seconds and can be exchanged once. The session token expires with the Deriv access token.

The dashboard consumes the one-time handoff, stores only the opaque Worker session token in sessionStorage, lists Demo and Real accounts, obtains balance WebSocket authorization, and lets the user select the active trading account. Set `OAUTH_WORKER_URL` in `index.html` to the deployed Worker origin before using the connection UI.

## Security and current boundary

- Authorization Code + PKCE (S256) is used.
- OAuth state is random, short-lived, stored server-side, checked against an HttpOnly, Secure, SameSite=Lax cookie, and consumed once.
- Authorization codes are exchanged on the Worker, not in the browser.
- Deriv access tokens are stored in KV with their expiry and are never returned by the Worker.
- Browser-facing session endpoints require the configured dashboard Origin. The session credential is an opaque, revocable Worker session ID, not the Deriv access token.
- The handoff is short-lived and single-use at the application level. Cloudflare KV is eventually consistent, so it should not be treated as a transactional store for high-volume concurrent operations.
- No refresh token is assumed; reauthorization is required after expiry.
- Only the already-approved `trade` scope is requested.
- Account discovery is read-only. Balance streams use Deriv's short-lived, one-time WebSocket OTP; the long-lived Deriv access token remains in Worker KV.
- Trading authorization is issued only for Demo or Real Options accounts belonging to the authenticated Deriv identity. The Deriv access token remains in Worker KV.
- The dashboard obtains a fresh trading OTP for each trade connection; OTP URLs are not stored in the repository or browser storage.
- No account creation, deposits, or withdrawals are included.
- The Worker and dashboard source are committed, but there is no production deployment until the Worker is deployed in the user's Cloudflare account, the KV binding and variables are configured, `OAUTH_WORKER_URL` is set to the deployed Worker origin, and the exact Worker callback URL is registered in the Deriv application's Redirect URLs.

## Dashboard configuration

Before testing, set `OAUTH_WORKER_URL` near the beginning of the dashboard's Deriv account script to the exact deployed Worker origin, for example `https://zyntrix-oauth.YOUR-SUBDOMAIN.workers.dev` (replace the example with the real Cloudflare hostname). Do not include a trailing slash. Add `https://YOUR-WORKER-HOST/oauth/callback` as a Redirect URL in the Deriv application. The Worker computes this callback from its own request origin.

## Deriv references

- https://developers.deriv.com/docs/intro/oauth/
- https://developers.deriv.com/docs/workflows/
