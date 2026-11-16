const GROQ_URL="https://api.groq.com/openai/v1/chat/completions";const GROQ_MODEL="openai/gpt-oss-20b";
function responseHeaders(origin,env){const h=new Headers({"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Vary":"Origin"});if(origin&&origin===env.APP_ORIGIN){h.set("Access-Control-Allow-Origin",env.APP_ORIGIN);h.set("Access-Control-Allow-Methods","POST, OPTIONS, GET");h.set("Access-Control-Allow-Headers","Content-Type")}return h}
function json(data,status,headers){return new Response(JSON.stringify(data),{status,headers})}
function requireAllowedOrigin(request,env){return request.headers.get("Origin")===env.APP_ORIGIN}
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

async function analysisScan(request,env,headers){
 const started=Date.now();if(!requireAllowedOrigin(request,env))return json({error:"origin_not_allowed"},403,headers);
 if(!env.GROQ_API_KEY)return json({error:"groq_not_configured"},503,headers);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))return json({error:"content_type_must_be_json"},415,headers);
 let body;try{body=await request.json()}catch{return json({error:"invalid_json"},400,headers)}
 const symbol=typeof body?.symbol==="string"?body.symbol:"",digits=body?.digits,prices=body?.prices;
 if(!/^(1HZ10V|1HZ25V|1HZ50V|1HZ75V|1HZ100V|R_10|R_25|R_50|R_75|R_100)$/.test(symbol)||!Array.isArray(digits)||digits.length!==100||!digits.every(d=>Number.isInteger(d)&&d>=0&&d<=9)||!Array.isArray(prices)||prices.length!==100||!prices.every(p=>Number.isFinite(p)&&p>0))return json({error:"invalid_analysis_payload"},400,headers);
 const stats=groqDigitStats(digits,prices,null);stats.recent50=groqDigitStats(digits.slice(-50),prices.slice(-50),null);
 const system="You are a market-data analyst for an analysis-only application. Never recommend, instruct, or execute a trade. Analyse the supplied 100 chronological Deriv synthetic-index digits and computed evidence. Describe observed parity imbalance, frequency, streaks, repetitions, transitions and price movement. Return JSON only with bias (EVEN, ODD, or NEUTRAL), confidence_percent (0-100, confidence in the descriptive assessment, not prediction accuracy), pattern_summary (max 160 chars), caution (max 120 chars), evidence (up to 3 short strings citing observed numbers). Do not claim future outcomes are more likely based only on past digits. If evidence is weak or balanced, choose NEUTRAL. Never invent evidence or overstate confidence.";
 const user=JSON.stringify({market:{symbol,name:String(body.marketName||symbol)},tickCount:100,digitsOldestToNewest:digits,pricesOldestToNewest:prices,computedEvidence:stats});
 let response;try{response=await fetch(GROQ_URL,{method:"POST",headers:{"Authorization":"Bearer "+env.GROQ_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:GROQ_MODEL,messages:[{role:"system",content:system},{role:"user",content:user}],max_completion_tokens:600,reasoning_effort:"low",response_format:{type:"json_object"}}),signal:AbortSignal.timeout(15000)})}catch(e){return json({error:"groq_failed",details:String(e&&e.message||e)},502,headers)}
 if(!response.ok){const data=await response.json().catch(()=>null);return json({error:"groq_failed",upstreamStatus:response.status,details:data?.error?.message||"Groq request failed",retryAfterSeconds:Number(response.headers.get("retry-after"))||null},response.status===429?429:502,headers)}
 const data=await response.json();let result;try{result=JSON.parse(data.choices[0].message.content)}catch{return json({error:"groq_invalid_response"},502,headers)}
 const bias=String(result.bias||"").toUpperCase();if(!["EVEN","ODD","NEUTRAL"].includes(bias)||!Number.isInteger(result.confidence_percent)||result.confidence_percent<0||result.confidence_percent>100||!Array.isArray(result.evidence))return json({error:"groq_invalid_analysis"},502,headers)
 return json({bias,confidence_percent:result.confidence_percent,pattern_summary:String(result.pattern_summary||"").slice(0,160),caution:String(result.caution||"").slice(0,120),evidence:result.evidence.slice(0,3).map(x=>String(x).slice(0,160)),model:GROQ_MODEL,analyzedTicks:100,groqLatencyMs:Date.now()-started},200,headers)
}
export default {async fetch(request,env){const url=new URL(request.url),origin=request.headers.get("Origin"),headers=responseHeaders(origin,env);if(request.method==="OPTIONS"){if(origin!==env.APP_ORIGIN)return new Response(null,{status:403});return new Response(null,{status:204,headers})}if(url.pathname==="/health"&&request.method==="GET")return json({ok:true,service:"zyntrix-analysis",mode:"analysis-only",model:GROQ_MODEL},200,headers);if(url.pathname==="/analysis/scan"&&request.method==="POST")return analysisScan(request,env,headers);return json({error:"not_found"},404,headers)}};
