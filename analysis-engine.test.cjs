"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const Engine=require("./analysis-engine.js");
function digitsWithCounts(evenCount,oddCount){const values=[],total=evenCount+oddCount;let e=0,o=0;for(let i=0;i<total;i++){const shouldEven=Math.floor((i+1)*evenCount/total)>Math.floor(i*evenCount/total);if(shouldEven&&e<evenCount){values.push([0,2,4,6,8][e++%5]);}else if(o<oddCount){values.push([1,3,5,7,9][o++%5]);}else{values.push([0,2,4,6,8][e++%5]);}}return values;}
test("balanced parity is not labelled as a clear edge",()=>{const r=Engine.analyzeMarket({digits:digitsWithCounts(500,500),contract:"EVEN"});assert.equal(r.targetFrequencyPercent,50);assert.equal(r.status,"NO CLEAR EDGE");assert.ok(r.evidenceScore>=0&&r.evidenceScore<=100);});
test("large even imbalance is identified after multiple-market correction",()=>{const r=Engine.analyzeMarket({digits:digitsWithCounts(600,400),contract:"EVEN",marketsTested:10});assert.equal(r.targetFrequencyPercent,60);assert.equal(r.status,"STRONG HISTORICAL DEVIATION");assert.ok(r.adjustedPValue<.05);});
test("opposite contract does not inherit even evidence",()=>{const r=Engine.analyzeMarket({digits:digitsWithCounts(600,400),contract:"ODD",marketsTested:10});assert.equal(r.targetFrequencyPercent,40);assert.equal(r.status,"NO CLEAR EDGE");assert.equal(r.evidenceScore,0);});
test("digit distribution exposes counts and normalized entropy",()=>{const r=Engine.analyzeMarket({digits:Array.from({length:100},(_,i)=>i%10),contract:"EVEN"});assert.deepEqual(r.distribution.counts,Array(10).fill(10));assert.equal(r.distribution.normalizedEntropy,1);assert.equal(r.distribution.chiSquareUniform,0);});
test("rolling windows only appear when enough observations exist",()=>{const r=Engine.analyzeMarket({digits:digitsWithCounts(250,250),contract:"EVEN"});assert.deepEqual(r.windowStats.map(x=>x.size),[50,100,250,500]);});
test("invalid digits and unsupported contract are rejected",()=>{assert.throws(()=>Engine.analyzeMarket({digits:[0,1,2],contract:"EVEN"}),/50 valid/);assert.throws(()=>Engine.analyzeMarket({digits:Array(50).fill(10),contract:"EVEN"}),/50 valid/);assert.throws(()=>Engine.analyzeMarket({digits:Array(50).fill(1),contract:"HIGHER"}),/Contract/);});
test("ranking excludes insufficient samples and sorts strongest evidence first",()=>{const r=Engine.rankMarkets([{symbol:"A",marketName:"A",digits:digitsWithCounts(600,400)},{symbol:"B",marketName:"B",digits:digitsWithCounts(500,500)},{symbol:"C",marketName:"C",digits:Array(20).fill(2)}],"EVEN",3);assert.equal(r.ranking.length,2);assert.equal(r.best.symbol,"A");assert.equal(r.skippedMarkets,1);assert.equal(r.hasClearSignal,true);});
test("signal ledger resolves next tick and five/ten tick observations",()=>{const ledger=[{marketSymbol:"R_50",contract:"EVEN",afterEpoch:100,outcomes:{nextTickHit:null,nextTickDigit:null,after5Rate:null,after10Rate:null}}];const r=Engine.resolveSignalLedger(ledger,[{symbol:"R_50",epochs:[100,101,102,103,104,105,106,107,108,109,110],digits:[2,4,1,6,8,3,0,2,5,4,8]}]);assert.equal(r[0].outcomes.nextTickHit,true);assert.equal(r[0].outcomes.nextTickDigit,4);assert.equal(r[0].outcomes.after5Rate,60);assert.equal(r[0].outcomes.after10Rate,70);assert.equal(Engine.summarizeSignalLedger(r).nextTickHitRate,100);});
test("ledger leaves records pending when future timestamps are unavailable",()=>{const r=Engine.resolveSignalLedger([{marketSymbol:"R_25",contract:"ODD",afterEpoch:200}],[{symbol:"R_25",epochs:[null,200],digits:[3,5]}]);assert.equal(r[0].outcomes.nextTickHit,null);});
test("stable market sorts the ten displayed circle percentages and measures all nine gaps",()=>{
 const r=Engine.analyzeStableMarket({symbol:"A",circlePercentages:["10.0%","20.0%","5.0%","15.0%","8.0%","7.0%","6.0%","4.0%","3.0%","22.0%"]});
 assert.deepEqual(r.sortedPercentages.map(x=>x.digit),[9,1,3,0,4,5,6,2,7,8]);
 assert.deepEqual(r.gaps,[2,2,5,5,1,1,1,1,1]);
 assert.equal(r.separationScore,2.1111);
});
test("stable market ranking uses only circle percentage separation",()=>{
 const r=Engine.rankStableMarkets([
  {symbol:"A",marketName:"Market A",circlePercentages:["20%","10%","10%","10%","10%","10%","10%","10%","5%","5%"]},
  {symbol:"B",marketName:"Market B",circlePercentages:["15%","12%","11%","10%","10%","10%","9%","8%","8%","7%"]}
 ]);
 assert.equal(r.best.symbol,"A");
 assert.ok(r.ranking[0].separationScore>r.ranking[1].separationScore);
 assert.equal(r.ranking[0].gaps.length,9);
});
test("stable market rejects anything other than ten valid displayed percentages",()=>{
 assert.throws(()=>Engine.analyzeStableMarket({circlePercentages:["10%"]}),/Exactly ten/);
 assert.throws(()=>Engine.analyzeStableMarket({circlePercentages:["x%",...Array(9).fill("10%")]}),/displayed percentage/);
});
