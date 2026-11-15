const DERIV_AUTH_URL = "https://auth.deriv.com/oauth2/auth";
const DERIV_TOKEN_URL = "https://auth.deriv.com/oauth2/token";
const STATE_COOKIE = "__Host-zyntrix_oauth_state";
const STATE_TTL = 600;
const HANDOFF_TTL = 90;

function responseHeaders(origin, env) {
  const h = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin"
  });
  if (origin && origin === env.APP_ORIGIN) {
    h.set("Access-Control-Allow-Origin", env.APP_ORIGIN);
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  return h;
}

function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const item = part.trim();
    const i = item.indexOf("=");
    if (i > -1 && item.slice(0, i) === name) {
      try {
        return decodeURIComponent(item.slice(i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function stateCookie(value, maxAge) {
  return [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ].join("; ");
}

function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function json(data, status, headers) {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers });
}

function appRedirect(env, status, handoff) {
  const url = new URL(env.APP_URL);
  url.searchParams.set("oauth", status);
  if (handoff) {
    // The fragment is not sent to the web server in HTTP requests or Referer headers.
    url.hash = new URLSearchParams({ oauth_handoff: handoff }).toString();
  }
  const response = Response.redirect(url.toString(), 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function validConfiguration(env) {
  if (!env.DERIV_CLIENT_ID || !env.ZYNTRIX_KV || !env.APP_ORIGIN || !env.APP_URL) return false;
  try {
    return new URL(env.APP_URL).origin === env.APP_ORIGIN;
  } catch {
    return false;
  }
}

function requireAllowedOrigin(request, env) {
  return request.headers.get("Origin") === env.APP_ORIGIN;
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  const match = value.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  return match ? match[1] : null;
}

async function startOAuth(request, env) {
  if (!validConfiguration(env)) {
    return new Response("OAuth backend is not configured correctly.", { status: 503 });
  }

  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = await sha256Base64Url(verifier);
  const redirectUri = new URL("/oauth/callback", request.url).toString();

  await env.ZYNTRIX_KV.put(
    `oauth_state:${state}`,
    JSON.stringify({ verifier, redirectUri, createdAt: Date.now() }),
    { expirationTtl: STATE_TTL }
  );

  const authorize = new URL(DERIV_AUTH_URL);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", env.DERIV_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", "trade");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const response = Response.redirect(authorize.toString(), 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.append("Set-Cookie", stateCookie(state, STATE_TTL));
  return response;
}

async function oauthCallback(request, env) {
  if (!validConfiguration(env)) {
    return new Response("OAuth backend is not configured correctly.", { status: 503 });
  }

  const url = new URL(request.url);
  const returnedState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const savedCookieState = cookieValue(request, STATE_COOKIE);

  if (url.searchParams.has("error") || !code || !returnedState || !savedCookieState || returnedState !== savedCookieState) {
    const response = appRedirect(env, "failed");
    response.headers.append("Set-Cookie", stateCookie("", 0));
    return response;
  }

  const stateKey = `oauth_state:${returnedState}`;
  const saved = await env.ZYNTRIX_KV.get(stateKey, "json");
  await env.ZYNTRIX_KV.delete(stateKey);

  if (!saved || !saved.verifier || !saved.redirectUri || Date.now() - saved.createdAt > STATE_TTL * 1000) {
    const response = appRedirect(env, "failed");
    response.headers.append("Set-Cookie", stateCookie("", 0));
    return response;
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.DERIV_CLIENT_ID,
    code,
    code_verifier: saved.verifier,
    redirect_uri: saved.redirectUri
  });

  let tokenResponse;
  try {
    tokenResponse = await fetch(DERIV_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body
    });
  } catch {
    const response = appRedirect(env, "failed");
    response.headers.append("Set-Cookie", stateCookie("", 0));
    return response;
  }

  const tokenData = await tokenResponse.json().catch(() => null);
  const tokenLifetime = Number(tokenData?.expires_in);

  if (!tokenResponse.ok || !tokenData?.access_token || !Number.isFinite(tokenLifetime) || tokenLifetime <= 0) {
    const response = appRedirect(env, "failed");
    response.headers.append("Set-Cookie", stateCookie("", 0));
    return response;
  }

  const sessionId = randomToken(32);
  const now = Date.now();
  const expiresAt = now + tokenLifetime * 1000;
  const sessionTtl = Math.max(60, Math.ceil(tokenLifetime));

  await env.ZYNTRIX_KV.put(
    `session:${sessionId}`,
    JSON.stringify({
      accessToken: tokenData.access_token,
      expiresAt
    }),
    { expirationTtl: sessionTtl }
  );

  // One-time bridge so the GitHub Pages app can receive an opaque session ID
  // without depending on third-party cookies or exposing the Deriv access token.
  const handoff = randomToken(32);
  await env.ZYNTRIX_KV.put(
    `handoff:${handoff}`,
    JSON.stringify({ sessionId, createdAt: now }),
    { expirationTtl: HANDOFF_TTL }
  );

  const response = appRedirect(env, "connected", handoff);
  response.headers.append("Set-Cookie", stateCookie("", 0));
  return response;
}

async function exchangeHandoff(request, env, headers) {
  if (!requireAllowedOrigin(request, env)) {
    return json({ error: "origin_not_allowed" }, 403, headers);
  }
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return json({ error: "content_type_must_be_json" }, 415, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, headers);
  }

  const handoff = typeof body?.handoff === "string" ? body.handoff : "";
  if (!/^[A-Za-z0-9_-]{40,}$/.test(handoff)) {
    return json({ error: "invalid_handoff" }, 400, headers);
  }

  const key = `handoff:${handoff}`;
  const saved = await env.ZYNTRIX_KV.get(key, "json");
  await env.ZYNTRIX_KV.delete(key);

  if (!saved?.sessionId || Date.now() - saved.createdAt > HANDOFF_TTL * 1000) {
    return json({ error: "handoff_expired_or_used" }, 401, headers);
  }

  const session = await env.ZYNTRIX_KV.get(`session:${saved.sessionId}`, "json");
  if (!session || session.expiresAt <= Date.now()) {
    await env.ZYNTRIX_KV.delete(`session:${saved.sessionId}`);
    return json({ error: "session_expired" }, 401, headers);
  }

  return json({
    connected: true,
    sessionToken: saved.sessionId,
    expiresAt: session.expiresAt
  }, 200, headers);
}


async function getValidSession(request, env) {
  const sessionId = bearerToken(request);
  if (!sessionId) return null;
  const session = await env.ZYNTRIX_KV.get(`session:${sessionId}`, "json");
  if (!session || !session.accessToken || session.expiresAt <= Date.now()) {
    await env.ZYNTRIX_KV.delete(`session:${sessionId}`);
    return null;
  }
  return { sessionId, session };
}

async function listAccounts(request, env, headers) {
  if (!requireAllowedOrigin(request, env)) return json({ error: "origin_not_allowed" }, 403, headers);
  const auth = await getValidSession(request, env);
  if (!auth) return json({ error: "session_expired", connected: false }, 401, headers);
  let upstream;
  try {
    upstream = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      method: "GET",
      headers: { "Authorization": `Bearer ${auth.session.accessToken}`, "Accept": "application/json" }
    });
  } catch {
    return json({ error: "deriv_unavailable" }, 502, headers);
  }
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return json({ error: "account_lookup_failed", upstreamStatus: upstream.status, details: payload?.errors || null }, upstream.status, headers);
  }
  const raw = Array.isArray(payload?.data) ? payload.data :
    Array.isArray(payload?.data?.accounts) ? payload.data.accounts :
    Array.isArray(payload?.accounts) ? payload.accounts : [];
  const accounts = raw.map((a) => ({
    account_id: String(a?.account_id || a?.accountId || ""),
    account_type: String(a?.account_type || a?.accountType || "").toLowerCase(),
    currency: typeof a?.currency === "string" ? a.currency : null,
    balance: Number.isFinite(Number(a?.balance)) ? Number(a.balance) : null,
    status: typeof a?.status === "string" ? a.status : null,
    group: typeof a?.group === "string" ? a.group : null
  })).filter((a) => a.account_id && ["demo", "real"].includes(a.account_type));
  return json({ connected: true, accounts }, 200, headers);
}

async function accountBalanceOtp(request, env, headers, accountId) {
  if (!requireAllowedOrigin(request, env)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (request.method !== "POST" || !/^[A-Za-z0-9_-]{4,64}$/.test(accountId)) {
    return json({ error: "invalid_account_request" }, 400, headers);
  }
  const auth = await getValidSession(request, env);
  if (!auth) return json({ error: "session_expired", connected: false }, 401, headers);

  // Confirm that this account belongs to the authenticated Deriv identity.
  let accountResponse;
  try {
    accountResponse = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: { "Authorization": `Bearer ${auth.session.accessToken}`, "Accept": "application/json" }
    });
  } catch {
    return json({ error: "deriv_unavailable" }, 502, headers);
  }
  const accountPayload = await accountResponse.json().catch(() => null);
  const accountList = Array.isArray(accountPayload?.data) ? accountPayload.data :
    Array.isArray(accountPayload?.data?.accounts) ? accountPayload.data.accounts : [];
  const ownsAccount = accountList.some((a) => String(a?.account_id || a?.accountId || "") === accountId);
  if (!accountResponse.ok || !ownsAccount) return json({ error: "account_not_available" }, 404, headers);

  let otpResponse;
  try {
    otpResponse = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${auth.session.accessToken}`, "Accept": "application/json" }
    });
  } catch {
    return json({ error: "deriv_unavailable" }, 502, headers);
  }
  const otpPayload = await otpResponse.json().catch(() => null);
  const wsUrl = otpPayload?.data?.url;
  if (!otpResponse.ok || typeof wsUrl !== "string") {
    return json({ error: "balance_connection_unavailable", upstreamStatus: otpResponse.status }, otpResponse.status || 502, headers);
  }
  let parsed;
  try { parsed = new URL(wsUrl); } catch { return json({ error: "invalid_balance_socket_url" }, 502, headers); }
  if (parsed.protocol !== "wss:" || parsed.hostname !== "api.derivws.com") {
    return json({ error: "invalid_balance_socket_url" }, 502, headers);
  }
  return json({ url: wsUrl }, 200, headers);
}

async function sessionStatus(request, env, headers) {
  if (!requireAllowedOrigin(request, env)) {
    return json({ error: "origin_not_allowed" }, 403, headers);
  }
  const sessionId = bearerToken(request);
  if (!sessionId) return json({ connected: false }, 200, headers);

  const session = await env.ZYNTRIX_KV.get(`session:${sessionId}`, "json");
  if (!session || session.expiresAt <= Date.now()) {
    await env.ZYNTRIX_KV.delete(`session:${sessionId}`);
    return json({ connected: false }, 200, headers);
  }
  return json({ connected: true, expiresAt: session.expiresAt }, 200, headers);
}

async function disconnect(request, env, headers) {
  if (!requireAllowedOrigin(request, env)) {
    return json({ error: "origin_not_allowed" }, 403, headers);
  }
  const sessionId = bearerToken(request);
  if (sessionId) await env.ZYNTRIX_KV.delete(`session:${sessionId}`);
  return json({ connected: false }, 200, headers);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const headers = responseHeaders(origin, env);

    if (request.method === "OPTIONS") {
      if (origin !== env.APP_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "zyntrix-oauth", stage: "2.1" }, 200, headers);
    }
    if (url.pathname === "/oauth/start" && request.method === "GET") return startOAuth(request, env);
    if (url.pathname === "/oauth/callback" && request.method === "GET") return oauthCallback(request, env);
    if (url.pathname === "/oauth/session/exchange" && request.method === "POST") {
      return exchangeHandoff(request, env, headers);
    }
    if (url.pathname === "/oauth/accounts" && request.method === "GET") {
      return listAccounts(request, env, headers);
    }
    const balanceOtpMatch = url.pathname.match(/^\/oauth\/accounts\/([^/]+)\/balance-otp$/);
    if (balanceOtpMatch && request.method === "POST") {
      return accountBalanceOtp(request, env, headers, decodeURIComponent(balanceOtpMatch[1]));
    }
    if (url.pathname === "/oauth/session" && request.method === "GET") {
      return sessionStatus(request, env, headers);
    }
    if (url.pathname === "/oauth/disconnect" && request.method === "POST") {
      return disconnect(request, env, headers);
    }
    return json({ error: "not_found" }, 404, headers);
  }
};
