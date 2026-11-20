(function(root,factory){var api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root)root.ZyntrixEngine=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
var WINDOWS=[30,60,250,500,1000];
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function round(v,p){var f=Math.pow(10,p===undefined?2:p);return Math.round(v*f)/f;}
function mean(a){return a.length?a.reduce(function(x,y){return x+y;},0)/a.length:0;}
function normalSurvival(z){if(!Number.isFinite(z))return z>0?0:1;if(z<=-8)return 1;if(z>=8)return 0;var x=Math.abs(z)/Math.sqrt(2),t=1/(1+.3275911*x);var erf=1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x));var cdf=.5*(1+(z<0?-erf:erf));return clamp(1-cdf,0,1);}
function wilson(rate,n){if(!n)return{lower:0,upper:1};var z=1.959963984540054,z2=z*z,den=1+z2/n;var center=(rate+z2/(2*n))/den;var margin=z*Math.sqrt(rate*(1-rate)/n+z2/(4*n*n))/den;return{lower:clamp(center-margin,0,1),upper:clamp(center+margin,0,1)};}
function runs(values,selector){if(!values.length)return{current:0,longest:0,runs:0};var current=1,longest=1,total=1,previous=selector(values[0]);for(var i=1;i<values.length;i++){var value=selector(values[i]);if(value===previous)current++;else{total++;current=1;previous=value;}if(current>longest)longest=current;}return{current:current,longest:longest,runs:total};}
function distribution(digits){var counts=Array(10).fill(0),n=digits.length,entropy=0,chi=0;digits.forEach(function(d){counts[d]++;});if(n)counts.forEach(function(count){var p=count/n;if(p>0)entropy-=p*Math.log2(p);chi+=Math.pow(count-n/10,2)/(n/10);});return{counts:counts,percentages:counts.map(function(c){return n?round(c/n*100,2):0;}),entropyBits:round(entropy,4),normalizedEntropy:round(entropy/Math.log2(10),4),chiSquareUniform:round(chi,3)};}
function transitions(digits,targetParity){var matrix=[[0,0],[0,0]];for(var i=1;i<digits.length;i++)matrix[digits[i-1]%2][digits[i]%2]++;var previous=digits.length?digits[digits.length-1]%2:-1;var support=previous<0?0:matrix[previous][0]+matrix[previous][1],count=previous<0?0:matrix[previous][targetParity];return{counts:matrix,previousParity:previous<0?"UNKNOWN":previous===0?"EVEN":"ODD",previousParitySupport:support,nextTargetCount:count,nextTargetRate:support?round(count/support*100,2):null,note:support>=30?"Exploratory conditional frequency; not a forecast.":"Insufficient transition support for interpretation."};}
function movement(prices){var returns=[],up=0,down=0,flat=0;for(var i=1;i<prices.length;i++){var a=Number(prices[i-1]),b=Number(prices[i]);if(!(a>0)||!(b>0)||!Number.isFinite(a)||!Number.isFinite(b))continue;var r=Math.log(b/a);returns.push(r);if(r>0)up++;else if(r<0)down++;else flat++;}var avg=mean(returns),variance=mean(returns.map(function(x){return Math.pow(x-avg,2);}));return{observations:returns.length,upTicks:up,downTicks:down,flatTicks:flat,meanLogReturn:round(avg,8),returnStdDev:round(Math.sqrt(variance),8),meanAbsoluteMove:round(mean(returns.map(Math.abs)),8)};}
function changeDetection(digits,targetParity){if(digits.length<30)return{available:false,note:"Requires the complete selected sample (at least 30 ticks)."};var split=Math.floor(digits.length/2),priorDigits=digits.slice(0,split),recentDigits=digits.slice(split);var prior=priorDigits.filter(function(d){return d%2===targetParity;}).length/priorDigits.length;var recent=recentDigits.filter(function(d){return d%2===targetParity;}).length/recentDigits.length;var pooled=(prior*priorDigits.length+recent*recentDigits.length)/digits.length,se=Math.sqrt(Math.max(1e-12,pooled*(1-pooled)*(1/priorDigits.length+1/recentDigits.length))),z=(recent-prior)/se;return{available:true,priorRate:round(prior*100,2),recentRate:round(recent*100,2),zScore:round(z,3),changed:Math.abs(z)>=1.96,direction:recent>prior?"INCREASED":recent<prior?"DECREASED":"UNCHANGED",note:"Compares the two halves of the selected tick sample; descriptive only."};}
function evaluateOver1Gate(digits,selectedWindow,feedConnected){
  var thresholds=[95,85,75,65],barriers=[0,1,2,3],sample=Array.isArray(digits)?digits.slice(-60):[];
  var valid=sample.every(function(d){return Number.isInteger(d)&&d>=0&&d<=9;});
  var rules=barriers.map(function(barrier,index){
    var count=valid?sample.filter(function(d){return d>barrier;}).length:0;
    var actual=sample.length?count/sample.length*100:0;
    return{barrier:barrier,count:count,actualPercent:round(actual,2),thresholdPercent:thresholds[index],passed:sample.length===60&&valid&&actual+1e-9>=thresholds[index]};
  });
  var state=selectedWindow!==60?"SELECT_60":!feedConnected?"FEED_OFFLINE":sample.length<60?"COLLECTING":!valid?"INVALID_DATA":rules.every(function(rule){return rule.passed;})?"READY":"WAIT";
  return{state:state,ready:state==="READY",windowSize:60,sampleSize:sample.length,barriers:rules};
}
function analyzeMarket(input){input=input||{};var digits=input.digits;if(!Array.isArray(digits)||digits.length<30||!digits.every(function(d){return Number.isInteger(d)&&d>=0&&d<=9;}))throw new TypeError("At least 50 valid last digits (0-9) are required.");var contract=String(input.contract||"EVEN").toUpperCase();if(contract!=="EVEN"&&contract!=="ODD")throw new TypeError("Contract must be EVEN or ODD.");var n=digits.length,targetParity=contract==="EVEN"?0:1,targetCount=digits.filter(function(d){return d%2===targetParity;}).length,targetRate=targetCount/n,zScore=(targetRate-.5)/Math.sqrt(.25/n),interval=wilson(targetRate,n);
var windowStats=WINDOWS.filter(function(size){return size<=n;}).map(function(size){var sample=digits.slice(-size),count=sample.filter(function(d){return d%2===targetParity;}).length,rate=count/size;return{size:size,evenPercent:round(sample.filter(function(d){return d%2===0;}).length/size*100,2),oddPercent:round(sample.filter(function(d){return d%2===1;}).length/size*100,2),targetPercent:round(rate*100,2),targetZ:round((rate-.5)/Math.sqrt(.25/size),3)};});
var consistencyWindows=windowStats,agreement=consistencyWindows.length?consistencyWindows.filter(function(w){return w.targetPercent>50;}).length/consistencyWindows.length:0,deviations=consistencyWindows.map(function(w){return Math.abs(w.targetPercent/100-targetRate);}),stability=deviations.length?clamp(100-mean(deviations)*1250,0,100):0,strength=clamp(zScore/4*100,0,100),sampleCoverage=clamp(n/1000*100,0,100),edgeGate=targetRate>.5?1:0;
var evidenceScore=round(strength*.65+agreement*100*.2+stability*.1*edgeGate+sampleCoverage*.05*edgeGate,1),pRaw=normalSurvival(zScore),marketsTested=Math.max(1,Math.min(10,Number(input.marketsTested)||10)),adjustedP=Math.min(1,pRaw*marketsTested),dist=distribution(digits),parityRuns=runs(digits,function(d){return d%2;}),digitRuns=runs(digits,function(d){return d;}),transitionStats=transitions(digits,targetParity),priceStats=movement(Array.isArray(input.prices)?input.prices:[]),change=changeDetection(digits,targetParity),status="NO CLEAR EDGE";
if(adjustedP<.05&&interval.lower>.5&&agreement>=.75&&consistencyWindows.length>=2)status="STRONG HISTORICAL DEVIATION";else if(zScore>=1.645&&agreement>=.5)status="WATCH";
var evidence=[contract+" appeared in "+targetCount+"/"+n+" ticks ("+round(targetRate*100,2)+"%).","One-sided z-score "+round(zScore,3)+"; 95% Wilson interval "+round(interval.lower*100,2)+"%–"+round(interval.upper*100,2)+"%.","Multi-window agreement: "+Math.round(agreement*100)+"%; digit entropy "+dist.normalizedEntropy+" of 1.","Parity runs: current "+parityRuns.current+", longest "+parityRuns.longest+"; transition support "+transitionStats.previousParitySupport+"."];
if(change.available)evidence.push("Recent half of selected sample: "+change.recentRate+"% target frequency vs prior half: "+change.priorRate+"%.");
return{symbol:String(input.symbol||""),marketName:String(input.marketName||input.symbol||"Unknown market"),contract:contract,sampleSize:n,targetCount:targetCount,targetFrequencyPercent:round(targetRate*100,2),opposingFrequencyPercent:round((1-targetRate)*100,2),zScore:round(zScore,3),rawPValue:round(pRaw,6),adjustedPValue:round(adjustedP,6),confidenceInterval95:{lower:round(interval.lower*100,2),upper:round(interval.upper*100,2)},evidenceScore:evidenceScore,status:status,dataQuality:n>=950?"GOOD":"LIMITED",windowStats:windowStats,windowAgreementPercent:round(agreement*100,1),stabilityScore:round(stability,1),distribution:dist,parityRuns:parityRuns,digitRuns:digitRuns,transitions:transitionStats,changeDetection:change,priceMovement:priceStats,evidence:evidence};}
function rankMarkets(markets,contract,attemptedMarkets){if(!Array.isArray(markets))throw new TypeError("Markets must be an array.");contract=String(contract||"EVEN").toUpperCase();var tested=Math.max(1,Math.min(10,Number(attemptedMarkets)||markets.length||1)),ranking=[];markets.forEach(function(m){if(!m||!Array.isArray(m.digits)||m.digits.length<30)return;try{ranking.push(analyzeMarket({symbol:m.symbol,marketName:m.marketName,digits:m.digits,prices:m.prices,contract:contract,marketsTested:tested}));}catch(e){}});ranking.sort(function(a,b){return b.evidenceScore-a.evidenceScore||a.adjustedPValue-b.adjustedPValue||b.sampleSize-a.sampleSize||a.marketName.localeCompare(b.marketName);});var best=ranking.length?ranking[0]:null;return{contract:contract,best:best,ranking:ranking,skippedMarkets:Math.max(0,tested-ranking.length),hasClearSignal:!!best&&best.status==="STRONG HISTORICAL DEVIATION"};}

function analyzeRecurringPattern(digits,targetParity){
  if(!Array.isArray(digits)||digits.length<30)return null;
  targetParity=targetParity===1?1:0;
  var candidates=[],targetName=targetParity===0?"EVEN":"ODD";
  [2,3].forEach(function(length){
    if(digits.length<=length+8)return;
    var patterns=Object.create(null);
    for(var i=0;i<=digits.length-length-1;i++){
      var key=digits.slice(i,i+length).join("");
      var item=patterns[key];
      if(!item)item=patterns[key]={pattern:key,hits:0,target:0,indices:[]};
      item.hits++;
      if(digits[i+length]%2===targetParity)item.target++;
      item.indices.push(i);
    }
    Object.keys(patterns).forEach(function(key){
      var item=patterns[key];
      if(item.hits<8)return;
      var rate=item.target/item.hits,interval=wilson(rate,item.hits),z=(rate-.5)/Math.sqrt(.25/item.hits);
      var clear=rate>=.60&&interval.lower>.5&&z>=1.96;
      var supportScore=Math.min(item.hits,40)*.55;
      var edgeScore=clamp((rate-.5)*100,0,50);
      var confidenceScore=Math.max(0,interval.lower-.5)*100;
      var lengthScore=length===3?1.5:0;
      var score=round(clamp(edgeScore+supportScore+confidenceScore+lengthScore,0,100),1);
      candidates.push({pattern:item.pattern,patternLength:length,occurrences:item.hits,targetCount:item.target,targetParity:targetName,targetRatePercent:round(rate*100,1),wilsonLowerPercent:round(interval.lower*100,1),zScore:round(z,2),score:score,clearSignal:clear,latestOccurrenceIndex:item.indices[item.indices.length-1]});
    });
  });
  candidates.sort(function(a,b){return Number(b.clearSignal)-Number(a.clearSignal)||b.score-a.score||b.occurrences-a.occurrences||b.patternLength-a.patternLength||a.pattern.localeCompare(b.pattern);});
  return candidates.length?candidates[0]:null;
}
function rankPatternMarkets(markets,contract,attemptedMarkets){
  if(!Array.isArray(markets))throw new TypeError("Markets must be an array.");
  contract=String(contract||"EVEN").toUpperCase();
  if(contract!=="EVEN"&&contract!=="ODD")throw new TypeError("Contract must be EVEN or ODD.");
  var target=contract==="EVEN"?0:1,tested=Math.max(1,Math.min(10,Number(attemptedMarkets)||markets.length||1)),ranking=[];
  markets.forEach(function(m){
    if(!m||!Array.isArray(m.digits)||m.digits.length<30)return;
    var pattern=analyzeRecurringPattern(m.digits,target);
    if(!pattern)return;
    ranking.push({symbol:String(m.symbol||""),marketName:String(m.marketName||m.symbol||"Unknown market"),contract:contract,sampleSize:m.digits.length,pattern:pattern,evidenceScore:pattern.score,status:pattern.clearSignal?"PATTERN SIGNAL":"PATTERN WATCH"});
  });
  ranking.sort(function(a,b){return Number(b.pattern.clearSignal)-Number(a.pattern.clearSignal)||b.evidenceScore-a.evidenceScore||b.pattern.occurrences-a.pattern.occurrences||a.marketName.localeCompare(b.marketName);});
  var signals=ranking.filter(function(item){return item.pattern.clearSignal;});
  return{contract:contract,best:signals.length?signals[0]:null,candidate:ranking.length?ranking[0]:null,ranking:ranking,skippedMarkets:Math.max(0,tested-ranking.length),hasClearSignal:signals.length>0};
}
function resolveSignalLedger(ledger,marketResults){return(Array.isArray(ledger)?ledger:[]).map(function(record){var copy=Object.assign({},record);copy.outcomes=Object.assign({nextTickHit:null,nextTickDigit:null,after5Rate:null,after10Rate:null},record.outcomes||{});if(copy.outcomes.nextTickHit!==null&&copy.outcomes.after5Rate!==null&&copy.outcomes.after10Rate!==null)return copy;var market=(Array.isArray(marketResults)?marketResults:[]).find(function(item){return item&&item.symbol===copy.marketSymbol;});if(!market||!Array.isArray(market.epochs)||!Array.isArray(market.digits))return copy;var future=[];for(var i=0;i<market.epochs.length;i++){var epoch=market.epochs[i];if(epoch!==null&&epoch!==undefined&&Number.isFinite(Number(epoch))&&Number(epoch)>Number(copy.afterEpoch)&&Number.isInteger(market.digits[i]))future.push(market.digits[i]);}var parity=copy.contract==="EVEN"?0:1;if(copy.outcomes.nextTickHit===null&&future.length>=1){copy.outcomes.nextTickDigit=future[0];copy.outcomes.nextTickHit=future[0]%2===parity;}if(copy.outcomes.after5Rate===null&&future.length>=5)copy.outcomes.after5Rate=round(future.slice(0,5).filter(function(d){return d%2===parity;}).length/5*100,1);if(copy.outcomes.after10Rate===null&&future.length>=10)copy.outcomes.after10Rate=round(future.slice(0,10).filter(function(d){return d%2===parity;}).length/10*100,1);return copy;});}
function summarizeSignalLedger(ledger){var records=Array.isArray(ledger)?ledger:[],resolved=records.filter(function(r){return r.outcomes&&typeof r.outcomes.nextTickHit==="boolean";}),hits=resolved.filter(function(r){return r.outcomes.nextTickHit;}).length,five=records.filter(function(r){return r.outcomes&&Number.isFinite(r.outcomes.after5Rate);}),ten=records.filter(function(r){return r.outcomes&&Number.isFinite(r.outcomes.after10Rate);});return{recorded:records.length,nextTickResolved:resolved.length,nextTickHits:hits,nextTickHitRate:resolved.length?round(hits/resolved.length*100,1):null,fiveTickResolved:five.length,fiveTickAverage:five.length?round(mean(five.map(function(r){return r.outcomes.after5Rate;})),1):null,tenTickResolved:ten.length,tenTickAverage:ten.length?round(mean(ten.map(function(r){return r.outcomes.after10Rate;})),1):null};}
function rankBothMarkets(markets,attemptedMarkets){return{even:rankMarkets(markets,"EVEN",attemptedMarkets),odd:rankMarkets(markets,"ODD",attemptedMarkets)};}
return{WINDOWS:WINDOWS.slice(),evaluateOver1Gate:evaluateOver1Gate,analyzeMarket:analyzeMarket,rankMarkets:rankMarkets,rankBothMarkets:rankBothMarkets,analyzeRecurringPattern:analyzeRecurringPattern,rankPatternMarkets:rankPatternMarkets,resolveSignalLedger:resolveSignalLedger,summarizeSignalLedger:summarizeSignalLedger};
});