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

async function analysisRank(request,env,headers){
 if(!requireAllowedOrigin(request,env))return json({error:"origin_not_allowed"},403,headers);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))return json({error:"content_type_must_be_json"},415,headers);
 let body;try{body=await request.json()}catch{return json({error:"invalid_json"},400,headers)}
 const contract=String(body?.contract||"").toUpperCase(),markets=body?.markets;
 if(!["EVEN","ODD"].includes(contract)||!Array.isArray(markets)||markets.length<1||markets.length>10)return json({error:"invalid_ranking_payload"},400,headers);
 const allowed=new Map([["1HZ10V","Volatility 10 (1s)"],["1HZ25V","Volatility 25 (1s)"],["1HZ50V","Volatility 50 (1s)"],["1HZ75V","Volatility 75 (1s)"],["1HZ100V","Volatility 100 (1s)"],["R_10","Volatility 10"],["R_25","Volatility 25"],["R_50","Volatility 50"],["R_75","Volatility 75"],["R_100","Volatility 100"]]);
 const ranked=[];
 for(const m of markets){
  const symbol=String(m?.symbol||""),digits=m?.digits,prices=m?.prices;
  if(!allowed.has(symbol)||!Array.isArray(digits)||digits.length<100||digits.length>1000||!digits.every(x=>Number.isInteger(x)&&x>=0&&x<=9)||!Array.isArray(prices)||prices.length!==digits.length||!prices.every(x=>Number.isFinite(x)&&x>0))continue;
  const n=digits.length,recent=digits.slice(-100),target=d=>contract==="EVEN"?d%2===0:d%2===1;
  const fullCount=digits.filter(target).length,recentCount=recent.filter(target).length;
  const fullPct=fullCount/n*100,recentPct=recentCount/recent.length*100;
  const edge=Math.max(0,Math.min(100,(fullPct-50)*5));
  const recentEdge=Math.max(0,Math.min(100,(recentPct-50)*5));
  const aligned=fullPct>50&&recentPct>50?Math.max(0,100-Math.abs(fullPct-recentPct)*5):0;
  const score=Math.round((edge*.5+recentEdge*.3+aligned*.2)*10)/10;
  const evidence=[contract+" frequency "+fullPct.toFixed(1)+"% across "+n+" ticks","Latest "+recent.length+" ticks: "+recentPct.toFixed(1)+"% "+contract,"Full/recent alignment "+(fullPct>50&&recentPct>50?"consistent":"not consistently aligned")];
  ranked.push({symbol,marketName:allowed.get(symbol),score,sampleSize:n,dataQuality:n>=800?"GOOD":"LIMITED",contractFrequencyPercent:Math.round(fullPct*10)/10,recentFrequencyPercent:Math.round(recentPct*10)/10,evidence});
 }
 if(!ranked.length)return json({error:"no_markets_with_sufficient_history"},422,headers);
 ranked.sort((a,b)=>b.score-a.score||b.sampleSize-a.sampleSize||a.marketName.localeCompare(b.marketName));
 const best=ranked[0],skippedMarkets=markets.length-ranked.length;
 let commentary=best.marketName+" has the highest observed "+contract+" alignment score in the available sample.";
 let aiStatus="UNAVAILABLE",groqLatencyMs=0;
 if(env.GROQ_API_KEY){
  const started=Date.now();
  try{
   const upstream=await fetch(GROQ_URL,{method:"POST",headers:{"Authorization":"Bearer "+env.GROQ_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:GROQ_MODEL,messages:[{role:"system",content:"You are an analyst for an analysis-only app. Explain the supplied deterministic ranking of synthetic-index last-digit parity. Do not predict the next digit, claim a probability of winning, recommend a trade, or alter the ranking. Return JSON only: commentary (max 220 chars). Explicitly say scores describe the supplied historical sample, not future odds."},{role:"user",content:JSON.stringify({contract,ranking:ranked.map(({marketName,symbol,score,sampleSize,contractFrequencyPercent,recentFrequencyPercent})=>({marketName,symbol,score,sampleSize,contractFrequencyPercent,recentFrequencyPercent}))})}],max_completion_tokens:250,reasoning_effort:"low",response_format:{type:"json_object"}}),signal:AbortSignal.timeout(12000)});
   if(upstream.ok){const data=await upstream.json(),note=JSON.parse(data.choices[0].message.content);if(typeof note.commentary==="string"){commentary=note.commentary.slice(0,220);aiStatus="COMPLETE";}groqLatencyMs=Date.now()-started;}
  }catch(e){groqLatencyMs=Date.now()-started;}
 }
 return json({contract,best,ranking:ranked,skippedMarkets,commentary,caution:"Historical digit imbalance is descriptive only. It does not establish the probability or outcome of the next contract.",aiStatus,groqLatencyMs,model:GROQ_MODEL},200,headers);
}

export default {async fetch(request,env){const url=new URL(request.url),origin=request.headers.get("Origin"),headers=responseHeaders(origin,env);if(request.method==="OPTIONS"){if(origin!==env.APP_ORIGIN)return new Response(null,{status:403});return new Response(null,{status:204,headers})}if(url.pathname==="/health"&&request.method==="GET")return json({ok:true,service:"zyntrix-analysis",mode:"analysis-only",model:GROQ_MODEL},200,headers);if(url.pathname==="/analysis/scan"&&request.method==="POST")return analysisScan(request,env,headers);if(url.pathname==="/analysis/rank"&&request.method==="POST")return analysisRank(request,env,headers);return json({error:"not_found"},404,headers)}};
