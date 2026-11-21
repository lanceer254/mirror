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

function evaluateOver1TimeWindows(samples,feedConnected){
  var thresholds=[95,85,75,65],barriers=[0,1,2,3],requiredSamples=10,windows={},collected=0,allPassed=true;
  [10,30,60].forEach(function(seconds){
    var sample=Array.isArray(samples&&samples[seconds])?samples[seconds].filter(function(d){return Number.isInteger(d)&&d>=0&&d<=9;}):[];
    var rules=barriers.map(function(barrier,index){
      var count=sample.filter(function(d){return d>barrier;}).length,actual=sample.length?count/sample.length*100:0;
      return{barrier:barrier,count:count,actualPercent:Math.round(actual*100)/100,thresholdPercent:thresholds[index],passed:sample.length>=requiredSamples&&actual+1e-9>=thresholds[index]};
    });
    if(sample.length>=requiredSamples)collected++;
    if(!rules.every(function(rule){return rule.passed;}))allPassed=false;
    windows[seconds]={sampleSize:sample.length,barriers:rules,ready:rules.every(function(rule){return rule.passed;})};
  });
  var state=!feedConnected?"FEED_OFFLINE":collected<3?"COLLECTING":allPassed?"READY":"WAIT";
  return{state:state,ready:state==="READY",collected:collected,requiredSamples:requiredSamples,windows:windows};
}

function evaluateOver1Entry(samples,feedConnected){
  var thresholds={10:90,30:85,60:80},requiredSamples=10,windows={},collected=0,allPassed=true,invalid=false;
  [10,30,60].forEach(function(seconds){
    var source=Array.isArray(samples&&samples[seconds])?samples[seconds]:[];
    var valid=source.every(function(d){return Number.isInteger(d)&&d>=0&&d<=9;});
    if(!valid)invalid=true;
    var sample=valid?source:[];
    var count=sample.filter(function(d){return d>1;}).length;
    var actual=sample.length?count/sample.length*100:0;
    var passed=valid&&sample.length>=requiredSamples&&actual+1e-9>=thresholds[seconds];
    var rule={barrier:1,count:count,actualPercent:Math.round(actual*100)/100,thresholdPercent:thresholds[seconds],passed:passed};
    if(sample.length>=requiredSamples&&valid)collected++;
    if(!passed)allPassed=false;
    windows[seconds]={sampleSize:sample.length,barriers:[rule],ready:passed};
  });
  var state=!feedConnected?"FEED_OFFLINE":invalid?"INVALID_DATA":collected<3?"COLLECTING":allPassed?"READY":"WAIT";
  return{state:state,ready:state==="READY",collected:collected,requiredSamples:requiredSamples,windows:windows,barriers:windows[10].barriers,sampleSize:windows[10].sampleSize};
}

function median(values){
  if(!Array.isArray(values)||!values.length)return null;
  var sorted=values.slice().sort(function(a,b){return a-b;}),mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}
function medianAbsoluteDeviation(values,center){
  var valid=Array.isArray(values)?values.filter(function(v){return Number.isFinite(v);}):[];
  if(!valid.length)return 0;
  var m=Number.isFinite(center)?center:median(valid);
  return median(valid.map(function(v){return Math.abs(v-m);}))||0;
}
function exponentialMovingAverage(values,alpha,initialValue){
  if(!Array.isArray(values))throw new TypeError("values must be an array");
  alpha=alpha===undefined?0.2:alpha;
  if(!(alpha>0&&alpha<=1))throw new RangeError("alpha must be > 0 and <= 1");
  var ema=Number.isFinite(initialValue)?initialValue:null;
  return values.map(function(value){
    if(!Number.isFinite(value))return ema;
    ema=ema===null?value:alpha*value+(1-alpha)*ema;
    return ema;
  });
}
function hampelFilter(values,options){
  options=options||{};
  var windowSize=options.windowSize===undefined?7:options.windowSize;
  var nSigma=options.nSigma===undefined?3:options.nSigma;
  if(!Array.isArray(values))throw new TypeError("values must be an array");
  if(!Number.isInteger(windowSize)||windowSize<3)throw new RangeError("windowSize must be an integer >= 3");
  if(!(nSigma>0))throw new RangeError("nSigma must be > 0");
  var filtered=values.slice(),outliers=[],details=[],half=Math.floor(windowSize/2);
  values.forEach(function(value,index){
    if(!Number.isFinite(value)){outliers.push(false);details.push(null);return;}
    var start=Math.max(0,index-half),end=Math.min(values.length,index+half+1);
    var sample=values.slice(start,end).filter(function(v){return Number.isFinite(v);});
    if(sample.length<3){outliers.push(false);details.push({median:null,mad:0,threshold:null});return;}
    var center=median(sample),mad=medianAbsoluteDeviation(sample,center),scale=1.4826*mad;
    var threshold=nSigma*scale;
    var isOutlier=Math.abs(value-center)>threshold&&(mad===0?value!==center:true);
    outliers.push(isOutlier);
    details.push({median:center,mad:mad,threshold:threshold});
    if(isOutlier&&options.replace!==false)filtered[index]=center;
  });
  return{rawValues:values.slice(),filteredValues:filtered,outliers:outliers,details:details};
}
function createADWINState(options){
  options=options||{};
  return{values:[],delta:options.delta===undefined?0.002:options.delta,minWindow:options.minWindow===undefined?10:options.minWindow,maxWindow:options.maxWindow===undefined?512:options.maxWindow,totalSeen:0,driftDetected:false,estimation:null,lastChangeIndex:null};
}
function updateADWIN(state,value){
  if(!state||!Array.isArray(state.values))throw new TypeError("A state from createADWINState is required");
  if(!Number.isFinite(value))throw new TypeError("ADWIN value must be finite");
  if(!(state.delta>0&&state.delta<1))throw new RangeError("delta must be between 0 and 1");
  state.values.push(value);state.totalSeen+=1;state.driftDetected=false;
  if(state.values.length>state.maxWindow)state.values.shift();
  var changed=true,cutAt=-1;
  while(changed&&state.values.length>=state.minWindow*2){
    changed=false;
    var n=state.values.length,sum=state.values.reduce(function(a,b){return a+b;},0);
    for(var cut=state.minWindow;cut<=n-state.minWindow;cut++){
      var leftSum=0;
      for(var i=0;i<cut;i++)leftSum+=state.values[i];
      var rightSum=sum-leftSum,n0=cut,n1=n-cut;
      var difference=Math.abs(leftSum/n0-rightSum/n1);
      var bound=Math.sqrt(0.5*Math.log(4/state.delta)*(1/n0+1/n1));
      if(difference>bound){
        cutAt=cut;state.values=state.values.slice(cut);state.driftDetected=true;state.lastChangeIndex=state.totalSeen;changed=true;break;
      }
    }
  }
  state.estimation=state.values.length?state.values.reduce(function(a,b){return a+b;},0)/state.values.length:null;
  return{driftDetected:state.driftDetected,estimation:state.estimation,windowSize:state.values.length,totalSeen:state.totalSeen,changeIndex:state.lastChangeIndex,cutAt:cutAt};
}
function analyzeSeries(values,options){
  options=options||{};
  var raw=Array.isArray(values)?values.slice():[];
  var hampel=hampelFilter(raw,{windowSize:options.windowSize===undefined?7:options.windowSize,nSigma:options.nSigma===undefined?3:options.nSigma,replace:options.replaceOutliers!==false});
  var smoothed=exponentialMovingAverage(hampel.filteredValues,options.alpha===undefined?0.2:options.alpha);
  var adwin=options.adwinState||createADWINState(options);
  var drift=[];
  smoothed.forEach(function(value){if(Number.isFinite(value))drift.push(updateADWIN(adwin,value));});
  return{rawData:raw,outlierFilteredData:hampel.filteredValues,smoothedData:smoothed,outlierFlags:hampel.outliers,outlierDetails:hampel.details,drift:drift,adwinState:adwin};
}
return{evaluateOver1Gate:evaluateOver1Gate,evaluateOver1TimeWindows:evaluateOver1TimeWindows,evaluateOver1Entry:evaluateOver1Entry,median:median,medianAbsoluteDeviation:medianAbsoluteDeviation,exponentialMovingAverage:exponentialMovingAverage,hampelFilter:hampelFilter,createADWINState:createADWINState,updateADWIN:updateADWIN,analyzeSeries:analyzeSeries};
});
