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
  return new Response(null, {
    status: 302,
    headers: {
      "Location": url.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
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

  return new Response(null, {
    status: 302,
    headers: {
      "Location": authorize.toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": stateCookie(state, STATE_TTL)
    }
  });
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

async function tradingAccountOtp(request, env, headers, accountId) {
  if (!requireAllowedOrigin(request, env)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (request.method !== "POST" || !/^[A-Za-z0-9_-]{4,64}$/.test(accountId)) {
    return json({ error: "invalid_account_request" }, 400, headers);
  }
  const auth = await getValidSession(request, env);
  if (!auth) return json({ error: "session_expired", connected: false }, 401, headers);

  // The selected account must belong to this authenticated Deriv identity.
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
    Array.isArray(accountPayload?.data?.accounts) ? accountPayload.data.accounts :
    Array.isArray(accountPayload?.accounts) ? accountPayload.accounts : [];
  const account = accountList.find((item) =>
    String(item?.account_id || item?.accountId || "") === accountId
  );
  const accountType = String(account?.account_type || account?.accountType || "").toLowerCase();
  if (!accountResponse.ok || !account || !["demo", "real"].includes(accountType)) {
    return json({ error: "account_not_available" }, 404, headers);
  }

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
    return json({ error: "trading_connection_unavailable", upstreamStatus: otpResponse.status, details: otpPayload?.errors || null }, otpResponse.status || 502, headers);
  }
  let parsed;
  try { parsed = new URL(wsUrl); } catch { return json({ error: "invalid_trading_socket_url" }, 502, headers); }
  if (parsed.protocol !== "wss:" || parsed.hostname !== "api.derivws.com") {
    return json({ error: "invalid_trading_socket_url" }, 502, headers);
  }
  return json({ url: wsUrl, account_id: accountId, account_type: accountType }, 200, headers);
}

async function resetDemoBalance(request, env, headers, accountId) {
  if (!requireAllowedOrigin(request, env)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (request.method !== "POST" || !/^[A-Za-z0-9_-]{4,64}$/.test(accountId)) {
    return json({ error: "invalid_account_request" }, 400, headers);
  }
  const auth = await getValidSession(request, env);
  if (!auth) return json({ error: "session_expired", connected: false }, 401, headers);

  // Verify ownership and account type before calling Deriv. Real accounts are never eligible.
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
    Array.isArray(accountPayload?.data?.accounts) ? accountPayload.data.accounts :
    Array.isArray(accountPayload?.accounts) ? accountPayload.accounts : [];
  const account = accountList.find((a) =>
    String(a?.account_id || a?.accountId || "") === accountId
  );
  const accountType = String(account?.account_type || account?.accountType || "").toLowerCase();
  if (!accountResponse.ok || !account || accountType !== "demo") {
    return json({ error: "demo_account_not_available" }, 404, headers);
  }

  let resetResponse;
  try {
    resetResponse = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/reset-demo-balance`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${auth.session.accessToken}`,
        "Accept": "application/json"
      }
    });
  } catch {
    return json({ error: "deriv_unavailable" }, 502, headers);
  }
  const resetPayload = await resetResponse.json().catch(() => null);
  if (!resetResponse.ok) {
    return json({
      error: "demo_balance_reset_failed",
      upstreamStatus: resetResponse.status,
      details: resetPayload?.errors || null
    }, resetResponse.status, headers);
  }
  return json({ success: true, account_id: accountId }, 200, headers);
}


const GROQ_MODEL = "openai/gpt-oss-20b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_CONTRACTS = {DIGITMATCH:["DIGITMATCH","DIGITDIFF"],DIGITOVER:["DIGITOVER","DIGITUNDER"],DIGITEVEN:["DIGITEVEN","DIGITODD"],RUNHIGH:["RUNHIGH","RUNLOW"],CALL:["CALL","PUT"],UPORDOWN:["UPORDOWN"]};
function groqDigitStats(d,p,barrier) {
 const n=d.length,last=d[n-1],freq=Array(10).fill(0); d.forEach(x=>freq[x]++);
 const even=d.filter(x=>x%2===0).length; let parityStreak=1,repeatStreak=1;
 for(let i=n-2;i>=0&&d[i]%2===last%2;i--)parityStreak++;
 for(let i=n-2;i>=0&&d[i]===last;i--)repeatStreak++;
 const grams={}; for(let k=2;k<=3;k++)for(let i=0;i+k<=n;i++){const g=d.slice(i,i+k).join("");grams[g]=(grams[g]||0)+1;}
 const repeating=Object.entries(grams).filter(([g,c])=>c>=(g.length===2?4:3)).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([g,c])=>g+"x"+c);
 const after=Array(10).fill(0);for(let i=0;i<n-1;i++)if(d[i]===last)after[d[i+1]]++;
 const out={window:n,last20:d.slice(-20).join(""),freq,even,odd:n-even,lastDigit:last,parityStreak,repeatStreak,repeatingSequences:repeating,nextDigitAfterLastDigitBefore:after};
 if(barrier!==null){out.barrier=barrier;out.over=d.filter(x=>x>barrier).length;out.under=d.filter(x=>x<barrier).length;out.equal=d.filter(x=>x===barrier).length;}
 if(p.length>1){let up=0,down=0;for(let i=1;i<p.length;i++){if(p[i]>p[i-1])up++;else if(p[i]<p[i-1])down++;}let run=1,dir=Math.sign(p[p.length-1]-p[p.length-2]);for(let i=p.length-2;i>0&&Math.sign(p[i]-p[i-1])===dir;i--)run++;out.priceMoves={up,down,currentRun:run,runDirection:dir>0?"up":dir<0?"down":"flat"};}
 return out;
}
async function groqSignal(request,env,headers) {
 const requestStartedAt=Date.now();
 if(!requireAllowedOrigin(request,env))return json({error:"origin_not_allowed"},403,headers);
 const auth=await getValidSession(request,env);
 if(!auth)return json({error:"session_expired",connected:false},401,headers);
 if(!env.GROQ_API_KEY)return json({error:"groq_not_configured"},503,headers);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))return json({error:"content_type_must_be_json"},415,headers);
 let body;try{body=await request.json();}catch{return json({error:"invalid_json"},400,headers);}
 const symbol=typeof body?.symbol==="string"?body.symbol:"";
 const selectedContract=typeof body?.selectedContract==="string"?body.selectedContract:"";
 const allowed=GROQ_CONTRACTS[selectedContract],digits=body?.digits,prices=body?.prices;
 if(!/^(1HZ10V|1HZ25V|1HZ50V|1HZ75V|1HZ100V|R_10|R_25|R_50|R_75|R_100)$/.test(symbol)||!allowed||!Array.isArray(digits)||digits.length!==100||!digits.every(d=>Number.isInteger(d)&&d>=0&&d<=9)||!Array.isArray(prices)||prices.length!==digits.length||!prices.every(p=>Number.isFinite(p)&&p>0))return json({error:"invalid_analysis_payload"},400,headers);
 const barrier=body.barrier===null?null:Number(body.barrier),duration=Number(body.duration),durationUnit=body.durationUnit;
 if(!["ticks","minutes"].includes(durationUnit)||(barrier!==null&&(!Number.isInteger(barrier)||barrier<0||barrier>9))||!Number.isInteger(duration)||duration<1||duration>60)return json({error:"invalid_contract_settings"},400,headers);
 const stats=groqDigitStats(digits,prices,barrier);
 stats.recent50=groqDigitStats(digits.slice(-50),prices.slice(-50),barrier);
 const system="Analyse the supplied 100 Deriv synthetic-index digits and computed evidence. Use the full 100-digit window for context, while giving extra recency weight to the latest 50 digits. Look for frequency skew, streaks, repeating sequences and observed transitions. These digits are generated randomly; past patterns do not guarantee future outcomes. Choose TRADE only if the evidence supports one permitted signal; otherwise WAIT. Return JSON only with action (TRADE or WAIT), signal (permitted outcome or WAIT), confidence_percent (0-100), pattern_summary (max 160 chars), caution (max 120 chars), evidence (up to 3 short strings citing observed numbers). Never invent evidence or overstate confidence.";
 const user=JSON.stringify({market:{symbol,name:String(body.marketName||symbol)},selectedContract,permittedOutcomes:allowed,userSettings:{barrier,duration,durationUnit},tickCount:digits.length,digitsOldestToNewest:digits,pricesOldestToNewest:prices,computedEvidence:stats});
 let response;
 try{response=await fetch(GROQ_URL,{method:"POST",headers:{"Authorization":"Bearer "+env.GROQ_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:GROQ_MODEL,messages:[{role:"system",content:system},{role:"user",content:user}],max_completion_tokens:600,reasoning_effort:"low",response_format:{type:"json_object"}}),signal:AbortSignal.timeout(15000)});}
 catch(e){return json({error:"groq_failed",details:String(e&&e.message||e)},502,headers);}
 if(!response.ok){const data=await response.json().catch(()=>null);return json({error:"groq_failed",upstreamStatus:response.status,details:data?.error?.message||"Groq request failed",retryAfterSeconds:Number(response.headers.get("retry-after"))||null},response.status===429?429:502,headers);}
 const data=await response.json();let decision;try{decision=JSON.parse(data.choices[0].message.content);}catch{return json({error:"groq_invalid_response"},502,headers);}
 if(!["TRADE","WAIT"].includes(decision.action)||!Number.isInteger(decision.confidence_percent)||decision.confidence_percent<0||decision.confidence_percent>100||!Array.isArray(decision.evidence)||(decision.action==="TRADE"&&!allowed.includes(decision.signal))||(decision.action==="WAIT"&&decision.signal!=="WAIT"))return json({error:"groq_invalid_signal"},502,headers);
 return json({action:decision.action,signal:decision.signal,confidence_percent:decision.confidence_percent,pattern_summary:String(decision.pattern_summary||"").slice(0,1200),evidence:decision.evidence.slice(0,3).map(x=>String(x).slice(0,160)),caution:String(decision.caution||"").slice(0,160),model:GROQ_MODEL,analyzedTicks:digits.length,groqLatencyMs:Date.now()-requestStartedAt,workerLatencyMs:Date.now()-requestStartedAt},200,headers);
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
      return json({ ok: true, service: "zyntrix-oauth", stage: "2.2" }, 200, headers);
    }
    if ((url.pathname === "/gemini/signal" || url.pathname === "/groq/signal") && request.method === "POST") {
      return groqSignal(request, env, headers);
    }
    if (url.pathname === "/oauth/start" && request.method === "GET") return startOAuth(request, env);
    if (url.pathname === "/oauth/callback" && request.method === "GET") return oauthCallback(request, env);
    if (url.pathname === "/oauth/session/exchange" && request.method === "POST") {
      return exchangeHandoff(request, env, headers);
    }
    if (url.pathname === "/oauth/accounts" && request.method === "GET") {
      return listAccounts(request, env, headers);
    }
    const resetDemoMatch = url.pathname.match(/^\/oauth\/accounts\/([^/]+)\/reset-demo-balance$/);
    if (resetDemoMatch && request.method === "POST") {
      return resetDemoBalance(request, env, headers, decodeURIComponent(resetDemoMatch[1]));
    }
    const tradingOtpMatch = url.pathname.match(/^\/oauth\/accounts\/([^/]+)\/trading-otp$/);
    if (tradingOtpMatch && request.method === "POST") {
      return tradingAccountOtp(request, env, headers, decodeURIComponent(tradingOtpMatch[1]));
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
