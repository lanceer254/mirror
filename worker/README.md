# Zyntrix OAuth Worker — Milestone 2.1

This Worker is the server-side OAuth foundation for the Zyntrix GitHub Pages dashboard. It does not change the dashboard UI and does not place trades.

## Routes

- `GET /health` — backend health check.
- `GET /oauth/start` — creates one-time PKCE/state values and redirects to Deriv.
- `GET /oauth/callback` — validates state, exchanges the one-time code server-side, and stores the Deriv access token in KV.
- `GET /oauth/session` — returns connection metadata only; never returns the Deriv token.
- `POST /oauth/disconnect` — removes the server-side session.

## Required Cloudflare setup

1. Create a Cloudflare Worker named `zyntrix-oauth`.
2. Create a Cloudflare Workers KV namespace named `ZYNTRIX_KV`.
3. Bind that namespace to the Worker using the binding name `ZYNTRIX_KV`.
4. Configure these Worker variables:
   - `DERIV_CLIENT_ID` — the Deriv OAuth application ID (keep it in Worker configuration, not dashboard HTML).
   - `APP_ORIGIN` — `https://lanceer254.github.io` (the browser origin used for CORS checks).
   - `APP_URL` — `https://lanceer254.github.io/mirror/` (the dashboard return URL after OAuth).
5. Deploy this Worker.
6. Derive the exact callback URL from the deployed Worker origin: `https://YOUR-WORKER-HOST/oauth/callback`.
7. Add that exact HTTPS callback URL to the Redirect URLs for the Deriv OAuth application. Do not use the GitHub Pages website URL as the callback.
8. Set the Worker's `DERIV_CLIENT_ID` variable to the App ID for the registered Zyntrix OAuth app.

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

Set the non-secret app ID and app origin in `wrangler.toml` or Cloudflare Worker Variables. Do not put Deriv access tokens, authorization codes, or PKCE verifiers in logs or frontend files.

## Security notes and current boundary

- Authorization Code + PKCE (S256) is used.
- State is random, short-lived, checked against an HttpOnly cookie, and consumed once.
- Authorization codes are exchanged on the Worker, not in the browser.
- Deriv access tokens are stored in KV with their expiry and are never returned by the Worker.
- No refresh token is assumed; Deriv requires reauthorization after expiry.
- Only the already-approved `trade` scope is requested.
- This stage does not list accounts, expose balances, select Demo/Real, request quotes, or execute trades.
- The session cookie is cross-site because GitHub Pages and `workers.dev` are different sites. Browser third-party-cookie restrictions may block it. Before wiring the dashboard in the next OAuth stage, test the deployed Worker in the target browser; if blocked, use a same-site custom domain/Worker route or an explicit short-lived session handoff design.
- The Worker has no production deployment until it is deployed in the user's Cloudflare account and the required KV binding and variables are configured.

## Deriv references

- https://developers.deriv.com/docs/intro/oauth/
- https://developers.deriv.com/docs/workflows/
