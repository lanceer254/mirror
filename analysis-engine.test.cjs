"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Engine=require("./analysis-engine.js");
test("OVER 1 gate passes only when all four thresholds pass on the same 60 ticks",()=>{
 const sample=[...Array(3).fill(0),...Array(6).fill(1),...Array(6).fill(2),...Array(6).fill(3),...Array(39).fill(4)];
 const r=Engine.evaluateOver1Gate(sample,60,true);
 assert.equal(r.ready,true);assert.deepEqual(r.barriers.map(x=>x.actualPercent),[95,85,75,65]);assert.ok(r.barriers.every(x=>x.passed));
});
test("OVER 1 gate waits until 60 valid ticks are available",()=>{
 const r=Engine.evaluateOver1Gate(Array(59).fill(9),60,true);
 assert.equal(r.state,"COLLECTING");assert.equal(r.ready,false);assert.equal(r.sampleSize,59);
});
test("OVER 1 gate returns WAIT when any threshold fails",()=>{
 const sample=[...Array(4).fill(0),...Array(5).fill(1),...Array(6).fill(2),...Array(6).fill(3),...Array(39).fill(4)];
 const r=Engine.evaluateOver1Gate(sample,60,true);
 assert.equal(r.ready,false);assert.equal(r.state,"WAIT");assert.equal(r.barriers[0].passed,false);
});
test("OVER 1 gate requires selected 60 window and a live feed",()=>{
 const sample=Array(60).fill(9);
 assert.equal(Engine.evaluateOver1Gate(sample,1000,true).state,"SELECT_60");assert.equal(Engine.evaluateOver1Gate(sample,60,false).state,"FEED_OFFLINE");
});
test("OVER 1 gate rejects invalid digits",()=>{
 const r=Engine.evaluateOver1Gate([...Array(59).fill(9),10],60,true);
 assert.equal(r.state,"INVALID_DATA");assert.equal(r.ready,false);
});


test("OVER 1 entry requires all three time windows to meet their individual thresholds",()=>{
 const result=Engine.evaluateOver1Entry({10:Array(10).fill(9),30:Array(10).fill(9),60:Array(10).fill(9)},true);
 assert.equal(result.ready,true);
 assert.deepEqual([10,30,60].map(s=>result.windows[s].barriers[0].thresholdPercent),[90,85,80]);
});
test("OVER 1 entry applies 90/85/80 percent thresholds independently",()=>{
 const result=Engine.evaluateOver1Entry({
  10:[...Array(9).fill(9),1],
  30:[...Array(8).fill(9),...Array(2).fill(1)],
  60:[...Array(8).fill(9),...Array(2).fill(1)]
 },true);
 assert.equal(result.windows[10].barriers[0].passed,true);
 assert.equal(result.windows[30].barriers[0].passed,false);
 assert.equal(result.windows[60].barriers[0].passed,true);
 assert.equal(result.ready,false);
});
test("OVER 1 entry waits for at least 10 valid ticks in every time window",()=>{
 const result=Engine.evaluateOver1Entry({10:Array(9).fill(9),30:Array(10).fill(9),60:Array(10).fill(9)},true);
 assert.equal(result.state,"COLLECTING");
 assert.equal(result.ready,false);
});
test("OVER 1 entry rejects invalid digit samples",()=>{
 const result=Engine.evaluateOver1Entry({10:[...Array(9).fill(9),10],30:Array(10).fill(9),60:Array(10).fill(9)},true);
 assert.equal(result.state,"INVALID_DATA");
 assert.equal(result.ready,false);
});
test("OVER 1 entry requires a live feed",()=>{
 const result=Engine.evaluateOver1Entry({10:Array(10).fill(9),30:Array(10).fill(9),60:Array(10).fill(9)},false);
 assert.equal(result.state,"FEED_OFFLINE");
 assert.equal(result.ready,false);
});

test("EMA smooths a series without changing the raw input",()=>{
 const raw=[10,20,30],copy=raw.slice();
 assert.deepEqual(Engine.exponentialMovingAverage(raw,0.5),[10,15,22.5]);
 assert.deepEqual(raw,copy);
});
test("MAD uses the median absolute deviation",()=>{
 assert.equal(Engine.medianAbsoluteDeviation([1,2,3,4,100]),1);
});
test("Hampel filter flags and replaces an isolated spike while preserving raw values",()=>{
 const raw=[10,10,10,10,100,10,10,10,10];
 const result=Engine.hampelFilter(raw,{windowSize:5,nSigma:3});
 assert.equal(result.outliers[4],true);
 assert.equal(result.filteredValues[4],10);
 assert.equal(raw[4],100);
 assert.equal(result.rawValues[4],100);
});
test("ADWIN detects a sustained mean shift",()=>{
 const state=Engine.createADWINState({delta:0.01,minWindow:5,maxWindow:100});
 for(let i=0;i<40;i++)Engine.updateADWIN(state,0);
 let detected=false;
 for(let i=0;i<40;i++)if(Engine.updateADWIN(state,10).driftDetected)detected=true;
 assert.equal(detected,true);
});
test("combined analysis keeps raw, filtered and smoothed series separate",()=>{
 const raw=[10,10,10,10,100,10,10,10,10];
 const result=Engine.analyzeSeries(raw,{windowSize:5,alpha:0.5,minWindow:3,delta:0.01});
 assert.deepEqual(result.rawData,raw);
 assert.notEqual(result.outlierFilteredData[4],raw[4]);
 assert.equal(result.smoothedData.length,raw.length);
 assert.equal(result.outlierFlags[4],true);
});
