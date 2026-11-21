const MARKETS = [
  {name:"Volatility 10 (1s)",symbol:"1HZ10V",class:"1s"},
  {name:"Volatility 25 (1s)",symbol:"1HZ25V",class:"1s"},
  {name:"Volatility 50 (1s)",symbol:"1HZ50V",class:"1s"},
  {name:"Volatility 75 (1s)",symbol:"1HZ75V",class:"1s"},
  {name:"Volatility 100 (1s)",symbol:"1HZ100V",class:"1s"},
  {name:"Volatility 10",symbol:"R_10",class:"standard"},
  {name:"Volatility 25",symbol:"R_25",class:"standard"},
  {name:"Volatility 50",symbol:"R_50",class:"standard"},
  {name:"Volatility 75",symbol:"R_75",class:"standard"},
  {name:"Volatility 100",symbol:"R_100",class:"standard"}
];
const CONTRACTS = ["DIGITOVER","DIGITUNDER","DIGITMATCH","DIGITDIFF","DIGITEVEN","DIGITODD","CALL","PUT","HIGHER","LOWER"];
const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Cache-Control":"no-store"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json; charset=utf-8"}});}
function validMarket(s){return MARKETS.some(m=>m.symbol===s);}
function digitFromQuote(q){const s=String(q);const p=s.indexOf(".");const digits=s.replace(/\D/g,"");return digits?Number(digits[digits.length-1]):-1;}
function wilson(w,n,z=1.959963984540054){if(!n)return{low:null,high:null};const p=w/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,m=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;return{low:Math.max(0,c-m),high:Math.min(1,c+m)};}
export default {
 async fetch(request,env){
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
  const url=new URL(request.url),path=url.pathname;
  try{
   if(path==="/health")return json({ok:true,service:"zyntrix-intelligence-api",database:"connected",markets:MARKETS.length,contracts:CONTRACTS.length,now:Date.now()});
   if(path==="/api/markets")return json({markets:MARKETS,contracts:CONTRACTS,storage:"D1"});
   if(path==="/api/ingest"&&request.method==="POST"){
    const body=await request.json(),ticks=Array.isArray(body.ticks)?body.ticks:[];
    if(!ticks.length||ticks.length>250)return json({error:"ticks must contain 1..250 rows"},400);
    const now=Math.floor(Date.now()/1000),clientId=String(body.clientId||"web-client").slice(0,80);
    const clean=[];
    for(const t of ticks){
      const market=String(t.market||""),epoch=Math.floor(Number(t.epoch)),quote=String(t.quote);
      if(!validMarket(market)||!Number.isFinite(epoch)||epoch<1000000000||epoch>now+60||quote.length>32||!Number.isFinite(Number(quote)))continue;
      const digit=Number.isInteger(t.digit)?t.digit:digitFromQuote(quote);
      if(digit<0||digit>9)continue;
      clean.push({market,epoch,quote,digit});
    }
    if(!clean.length)return json({error:"No valid tick rows"},400);
    const statements=clean.map(t=>env.DB.prepare("INSERT OR IGNORE INTO ticks(market,epoch,quote,digit,received_at,source) VALUES(?,?,?,?,?,'deriv-live')").bind(t.market,t.epoch,t.quote,t.digit,now));
    const result=await env.DB.batch(statements);
    const inserted=result.reduce((n,r)=>n+(r.meta?.changes||0),0);
    return json({accepted:clean.length,inserted,duplicates:clean.length-inserted,receivedAt:now});
   }
   if(path==="/api/summary"){
    const [totals,markets,latest,sessions]=await Promise.all([
      env.DB.prepare("SELECT COUNT(*) ticks, COUNT(DISTINCT market) markets, MIN(epoch) first_epoch, MAX(epoch) last_epoch FROM ticks").first(),
      env.DB.prepare("SELECT market,COUNT(*) ticks,MIN(epoch) first_epoch,MAX(epoch) last_epoch,MAX(received_at) last_received FROM ticks GROUP BY market ORDER BY market").all(),
      env.DB.prepare("SELECT market,epoch,quote,digit FROM ticks ORDER BY epoch DESC,id DESC LIMIT 1").first(),
      env.DB.prepare("SELECT COUNT(*) active_sessions,COALESCE(SUM(ticks_received),0) ticks_received,COALESCE(SUM(ticks_inserted),0) ticks_inserted FROM collection_sessions WHERE last_seen_at>?").bind(Math.floor(Date.now()/1000)-180).first()
    ]);
    return json({totals,markets:markets.results,latest,collector:sessions});
   }
   if(path==="/api/ticks"){
    const market=url.searchParams.get("market")||"";
    if(!validMarket(market))return json({error:"Unknown market"},400);
    const limit=Math.min(5000,Math.max(1,Number(url.searchParams.get("limit")||1000)));
    const since=Math.max(0,Number(url.searchParams.get("since")||0));
    const rows=await env.DB.prepare("SELECT market,epoch,quote,digit,received_at FROM ticks WHERE market=? AND epoch>=? ORDER BY epoch DESC,id DESC LIMIT ?").bind(market,since,limit).all();
    return json({market,count:rows.results.length,ticks:rows.results.reverse()});
   }
   if(path==="/api/contracts"&&request.method==="GET"){
    const market=url.searchParams.get("market");
    if(market&&!validMarket(market))return json({error:"Unknown market"},400);
    const sql=market?"SELECT * FROM contract_catalog WHERE market=? ORDER BY observed_at DESC LIMIT 500":"SELECT * FROM contract_catalog ORDER BY observed_at DESC LIMIT 1000";
    const result=market?await env.DB.prepare(sql).bind(market).all():await env.DB.prepare(sql).all();
    return json({contracts:result.results,contractTypes:CONTRACTS});
   }
   if(path==="/api/contracts/snapshot"&&request.method==="POST"){
    const body=await request.json(),market=String(body.market||""),items=Array.isArray(body.contracts)?body.contracts:[];
    if(!validMarket(market)||items.length>300)return json({error:"Invalid market or contract list"},400);
    const now=Math.floor(Date.now()/1000);
    const statements=items.map(c=>env.DB.prepare("INSERT INTO contract_catalog(market,contract_type,barrier,duration,duration_unit,payout_currency,payout,ask_price,raw_json,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(market,String(c.contract_type||"").slice(0,32),c.barrier==null?null:String(c.barrier),Number.isFinite(Number(c.duration))?Number(c.duration):null,c.duration_unit||null,c.currency||null,Number.isFinite(Number(c.payout))?Number(c.payout):null,Number.isFinite(Number(c.ask_price))?Number(c.ask_price):null,JSON.stringify(c).slice(0,5000),now));
    if(statements.length)await env.DB.batch(statements);
    return json({stored:statements.length,market,observedAt:now});
   }
   if(path==="/api/observations"&&request.method==="POST"){
    const b=await request.json();
    if(!validMarket(String(b.market||""))||!b.id||!b.contract_type||!Number.isInteger(Number(b.horizon_ticks)))return json({error:"Invalid observation"},400);
    await env.DB.prepare("INSERT OR IGNORE INTO signal_observations(id,market,contract_type,barrier,direction,horizon_ticks,signal_at,feature_json,model_version,status) VALUES(?,?,?,?,?,?,?,?,?,'PENDING')").bind(String(b.id).slice(0,100),b.market,b.contract_type,b.barrier==null?null:String(b.barrier),b.direction||null,Number(b.horizon_ticks),Math.floor(Number(b.signal_at)||Date.now()/1000),JSON.stringify(b.features||{}).slice(0,10000),String(b.model_version||"baseline-0.1")).run();
    return json({stored:true,id:b.id});
   }
   if(path==="/api/observations/resolve"&&request.method==="POST"){
    const b=await request.json();
    if(!b.id||![0,1].includes(Number(b.outcome)))return json({error:"id and binary outcome required"},400);
    const r=await env.DB.prepare("UPDATE signal_observations SET status='RESOLVED',resolved_at=?,outcome=?,settlement_quote=? WHERE id=? AND status='PENDING'").bind(Math.floor(Date.now()/1000),Number(b.outcome),b.settlement_quote==null?null:String(b.settlement_quote),String(b.id)).run();
    return json({resolved:(r.meta?.changes||0)===1,id:b.id});
   }
   if(path==="/api/validation"&&request.method==="POST"){
    const b=await request.json(),r=b.result||{},h=r.holdout||{},tr=r.training||{};
    if(!validMarket(String(b.market||""))||!r.contract||!Number.isInteger(Number(r.horizonTicks)))return json({error:"Invalid validation record"},400);
    const id=crypto.randomUUID(),now=Math.floor(Date.now()/1000),split=Number(r.splitEpoch)||null;
    await env.DB.prepare("INSERT INTO validation_runs(id,created_at,model_version,market,contract_type,barrier,horizon_ticks,train_start,train_end,test_start,test_end,sample_size,wins,losses,hit_rate,baseline_rate,lower_95,upper_95,expected_value,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,now,String(r.version||"walk-forward-1.0"),b.market,r.contract,String(r.barrier??""),Number(r.horizonTicks),null,split,split,null,Number(h.signals||0),Number(h.wins||0),Number(h.losses||0),h.hitRate??null,h.baseline??null,h.wilson95?.lower??null,h.wilson95?.upper??null,h.expectedValuePerContract??null,JSON.stringify(r).slice(0,20000)).run();
    return json({stored:true,id});
   }
   if(path==="/api/validation"){
    const market=url.searchParams.get("market");
    if(market&&!validMarket(market))return json({error:"Unknown market"},400);
    const sql=market?"SELECT * FROM validation_runs WHERE market=? ORDER BY created_at DESC LIMIT 200":"SELECT * FROM validation_runs ORDER BY created_at DESC LIMIT 500";
    const r=market?await env.DB.prepare(sql).bind(market).all():await env.DB.prepare(sql).all();
    return json({runs:r.results});
   }
   if(path==="/api/collector/session"&&request.method==="POST"){
    const b=await request.json(),id=String(b.id||"").slice(0,100),markets=(b.markets||[]).filter(validMarket);
    if(!id)return json({error:"session id required"},400);
    const now=Math.floor(Date.now()/1000);
    await env.DB.prepare("INSERT INTO collection_sessions(id,started_at,last_seen_at,client_id,markets_json,ticks_received,ticks_inserted,status) VALUES(?,?,?,?,?,?,?,'ACTIVE') ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,markets_json=excluded.markets_json,ticks_received=ticks_received+excluded.ticks_received,ticks_inserted=ticks_inserted+excluded.ticks_inserted,status='ACTIVE'").bind(id,now,now,String(b.clientId||"browser").slice(0,80),JSON.stringify(markets),Number(b.received||0),Number(b.inserted||0)).run();
    return json({ok:true,id});
   }
   return json({error:"Not found"},404);
  }catch(error){return json({error:"Internal API error",detail:String(error?.message||error).slice(0,300)},500);}
 }
};