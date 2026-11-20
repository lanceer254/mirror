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
