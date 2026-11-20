(function(root,factory){var api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root)root.ZyntrixEngine=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
function evaluateOver1Gate(digits,selectedWindow,feedConnected){
  var thresholds=[95,85,75,65],barriers=[0,1,2,3],sample=Array.isArray(digits)?digits.slice(-60):[];
  var valid=sample.every(function(d){return Number.isInteger(d)&&d>=0&&d<=9;});
  var rules=barriers.map(function(barrier,index){
    var count=valid?sample.filter(function(d){return d>barrier;}).length:0;
    var actual=sample.length?count/sample.length*100:0;
    return{barrier:barrier,count:count,actualPercent:Math.round(actual*100)/100,thresholdPercent:thresholds[index],passed:sample.length===60&&valid&&actual+1e-9>=thresholds[index]};
  });
  var state=selectedWindow!==60?"SELECT_60":!feedConnected?"FEED_OFFLINE":sample.length<60?"COLLECTING":!valid?"INVALID_DATA":rules.every(function(rule){return rule.passed;})?"READY":"WAIT";
  return{state:state,ready:state==="READY",windowSize:60,sampleSize:sample.length,barriers:rules};
}
return{evaluateOver1Gate:evaluateOver1Gate};
});
