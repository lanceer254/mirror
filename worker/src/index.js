const DERIV_AUTH_URL = "https://auth.deriv.com/oauth2/auth";
const DERIV_TOKEN_URL = "https://auth.deriv.com/oauth2/token";
const SESSION_COOKIE = "__Host-zyntrix_session";
const STATE_COOKIE = "__Host-zyntrix_oauth_state";
const STATE_TTL = 600;

function headers(origin, env) {
  const allowed = env.APP_ORIGIN;
  const h = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin"
  });
  if (origin && origin === allowed) {
    h.set("Access-Control-Allow-Origin", allowed);
    h.set("Access-Control-Allow-Credentials", "true");
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type");
  }
  return h;
}

function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const item = part.trim();
    const i = item.indexOf("=");
    if (i > -1 && item.slice(0, i) === name) return decodeURIComponent(item.slice(i + 1));
  }
  return null;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "Secure", "HttpOnly"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function json(data, status, h) {
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: h });
}

function appRedirect(env, status) {
  const url = new URL(env.APP_URL);
  url.searchParams.set("oauth", status);
  return Response.redirect(url.toString(), 302);
}

async function startOAuth(request, env) {
  if (!env.DERIV_CLIENT_ID || !env.ZYNTRIX_KV || !env.APP_ORIGIN) {
    return new Response("OAuth backend is not configured.", { status: 503 });
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
  response.headers.append("Set-Cookie", cookie(STATE_COOKIE, state, { maxAge: STATE_TTL, sameSite: "Lax" }));
  return response;
}

async function oauthCallback(request, env) {
  const url = new URL(request.url);
  const returnedState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const stateCookie = cookieValue(request, STATE_COOKIE);

  if (url.searchParams.has("error") || !code || !returnedState || !stateCookie || returnedState !== stateCookie) {
    return appRedirect(env, "failed");
  }

  const stateKey = `oauth_state:${returnedState}`;
  const saved = await env.ZYNTRIX_KV.get(stateKey, "json");
  await env.ZYNTRIX_KV.delete(stateKey);
  if (!saved || Date.now() - saved.createdAt > STATE_TTL * 1000) {
    return appRedirect(env, "failed");
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
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body
    });
  } catch {
    return appRedirect(env, "failed");
  }

  const tokenData = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || !tokenData?.access_token || !Number.isFinite(Number(tokenData.expires_in))) {
    return appRedirect(env, "failed");
  }

  const sessionId = randomToken(32);
  const expiresIn = Math.max(60, Math.min(Number(tokenData.expires_in), 60 * 60 * 24 * 30));
  await env.ZYNTRIX_KV.put(
    `session:${sessionId}`,
    JSON.stringify({
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + expiresIn * 1000
    }),
    { expirationTtl: expiresIn }
  );

  const response = appRedirect(env, "connected");
  response.headers.append("Set-Cookie", cookie(SESSION_COOKIE, sessionId, { maxAge: expiresIn, sameSite: "None" }));
  response.headers.append("Set-Cookie", cookie(STATE_COOKIE, "", { maxAge: 0, sameSite: "Lax" }));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function sessionStatus(request, env, h) {
  const sessionId = cookieValue(request, SESSION_COOKIE);
  if (!sessionId) return json({ connected: false }, 200, h);
  const session = await env.ZYNTRIX_KV.get(`session:${sessionId}`, "json");
  if (!session || session.expiresAt <= Date.now()) {
    await env.ZYNTRIX_KV.delete(`session:${sessionId}`);
    return json({ connected: false }, 200, h);
  }
  return json({ connected: true, expiresAt: session.expiresAt }, 200, h);
}

async function disconnect(request, env, h) {
  const sessionId = cookieValue(request, SESSION_COOKIE);
  if (sessionId) await env.ZYNTRIX_KV.delete(`session:${sessionId}`);
  const response = json({ connected: false }, 200, h);
  response.headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", { maxAge: 0, sameSite: "None" }));
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const h = headers(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "zyntrix-oauth", stage: "2.1" }, 200, h);
    }
    if (url.pathname === "/oauth/start" && request.method === "GET") return startOAuth(request, env);
    if (url.pathname === "/oauth/callback" && request.method === "GET") return oauthCallback(request, env);
    if (url.pathname === "/oauth/session" && request.method === "GET") return sessionStatus(request, env, h);
    if (url.pathname === "/oauth/disconnect" && request.method === "POST") return disconnect(request, env, h);
    return json({ error: "not_found" }, 404, h);
  }
};
