const test=require('node:test');const assert=require('node:assert/strict');const E=require('./entry-engine.js');
function ticks(n,fn){return Array.from({length:n},(_,i)=>({epoch:i+1,quote:100+i*.01,digit:fn(i)}));}
test('five-tick model predicts the observed conditional transition',()=>{const ts=ticks(1000,i=>i%2===0?8:1);const model=E.fitFiveTickModel(ts);const p=E.probabilities(model,8);assert.ok(p[1]>.8);});
test('candidate scanner enforces five-tick expiry and chronological split',()=>{const ts=ticks(1500,i=>i%7===0?0:8);const r=E.scanMarket(ts,{market:'TEST',minTicks:300,minTrainSignals:5,minHoldoutSignals:5});assert.equal(r.horizonTicks,5);assert.ok(r.trainTicks<r.ticks);assert.ok(r.holdoutTicks>0);});
test('scanner refuses insufficient history',()=>{const r=E.scanMarket(ticks(100,i=>i%10),{minTicks:300});assert.equal(r.ready,false);assert.equal(r.reason,'INSUFFICIENT_HISTORY');});
test('five-tick scoring never overlaps entry outcomes',()=>{const ts=ticks(100,i=>i%10);const m=E.fitFiveTickModel(ts);const c={contract:'DIGITOVER',barrier:1,baseline:.8};const r=E.scoreRange(ts,m,c,0);assert.equal(r.signals,19);});
test('Wilson interval is bounded',()=>{const r=E.wilson(5,5);assert.ok(r.lower>=0&&r.upper<=1&&r.upper===1);});
