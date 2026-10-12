/** Portable cases; the Node/V8 runner supplies the interval API and strict assertions. */
export function intervalCases(api) {
 const {normalizeSegments,intervalDuration,intersectSegments,subtractSegments,momentClock,validateHalfWindows,MAX_INTERVALS}=api;
 const windows=[{id:1,start:0,end:1500,clockOriginMs:100000,reportedClockOriginSeconds:10},{id:2,start:0,end:1500,clockOriginMs:200000,reportedClockOriginSeconds:20}];
 return [
 {name:'intervals clip actual windows, merge overlap/touch and do not mutate inputs',run(assert){
 const input=Object.freeze([[0,1000],[500,2000],[1620,1800],[300,300]].map(Object.freeze)),window=Object.freeze({id:1,start:120,end:1620});
 const r=normalizeSegments(input,window);assert.deepEqual(r,[[120,1620]]);assert.equal(intervalDuration(input,window),1500);r[0][0]=999;
 assert.deepEqual(input,[[0,1000],[500,2000],[1620,1800],[300,300]]);assert.deepEqual(window,{id:1,start:120,end:1620});
 assert.deepEqual(normalizeSegments([[1,1],[2.01,2.02],[2.02,2.031]]),[[2.01,2.031]]);assert.deepEqual(normalizeSegments([[1500,1600]],windows[0]),[]);
 }},
 {name:'intersection/subtraction preserve exact gaps and clipped accounting',run(assert){
 const a=[[0,10],[20,30]],b=[[5,25]],w={id:1,start:3,end:27};
 assert.deepEqual(intersectSegments(a,b),[[5,10],[20,25]]);assert.deepEqual(subtractSegments(a,b),[[0,5],[25,30]]);
 assert.deepEqual(subtractSegments(a,[]),a);assert.deepEqual(intersectSegments(a,[]),[]);assert.deepEqual(subtractSegments(a,a),[]);
 assert.deepEqual(subtractSegments(a,b,w),[[3,5],[25,27]]);assert.equal(intervalDuration(a,w),14);assert.equal(intervalDuration(intersectSegments(a,b,w)),10);
 assert.equal(intervalDuration(subtractSegments(a,b,w)),4);const huge=intervalDuration([[0,1e308],[1.1e308,1.5e308]]);assert.ok(Number.isFinite(huge));assert.equal(huge,1e308+(1.5e308-1.1e308));
 }},
 {name:'absolute clocks win and legacy clocks require verified origins',run(assert){
 assert.deepEqual(momentClock({half:2,startTimeMs:230000,reportedSeconds:999},windows),{half:2,seconds:30,basis:'absolute_timestamp'});
 assert.deepEqual(momentClock({half:1,reportedSeconds:25},windows),{half:1,seconds:15,basis:'legacy_reported_clock'});
 assert.deepEqual(momentClock({half:1,startTimeMs:100000,reportedSeconds:999},windows),{half:1,seconds:0,basis:'absolute_timestamp'});
 assert.deepEqual(momentClock({half:1,startTimeMs:100000},[]),{half:1,seconds:null,basis:'missing_clock'});
 assert.deepEqual(momentClock({half:1,reportedSeconds:0},[{id:1,start:0,end:1500}]),{half:1,seconds:null,basis:'missing_clock'});
 assert.deepEqual(momentClock({half:1,reportedSeconds:null},windows),{half:1,seconds:null,basis:'missing_clock'});
 assert.deepEqual(momentClock({half:1,startTimeMs:123000,reportedSeconds:17},[{id:1,start:0,end:1500,reportedClockOriginSeconds:10}]),{half:1,seconds:7,basis:'legacy_reported_clock'});
 assert.deepEqual(momentClock({half:1,startTimeMs:100123},windows),{half:1,seconds:.123,basis:'absolute_timestamp'});
 }},
 {name:'malformed/negative data fails without rounding or silent repair',run(assert){
 assert.throws(()=>normalizeSegments([[-1,10]]),RangeError);assert.throws(()=>normalizeSegments([[10,0]]),RangeError);
 assert.throws(()=>normalizeSegments([[0,NaN]]),TypeError);assert.throws(()=>normalizeSegments([[0,Infinity]]),TypeError);
 assert.throws(()=>normalizeSegments([['0',10]]),TypeError);assert.throws(()=>normalizeSegments([[0,10,20]]),TypeError);
 assert.throws(()=>normalizeSegments({}),TypeError);assert.throws(()=>normalizeSegments([[0,10]],{start:10,end:0}),RangeError);
 assert.throws(()=>normalizeSegments([[0,10]],{start:0,end:0}),RangeError);assert.throws(()=>momentClock({half:2,startTimeMs:199999},windows),RangeError);
 assert.throws(()=>momentClock({half:1,reportedSeconds:9},windows),RangeError);assert.throws(()=>momentClock({half:3,reportedSeconds:0},windows),RangeError);
 assert.throws(()=>validateHalfWindows([windows[0],windows[0]]),RangeError);assert.throws(()=>validateHalfWindows([{start:0,end:10}]),RangeError);
 assert.throws(()=>validateHalfWindows({}),TypeError);
 }},
 {name:'input/results are bounded without truncation',run(assert){
 assert.equal(MAX_INTERVALS,4096);assert.throws(()=>normalizeSegments(Array.from({length:4097},()=>[0,1])),RangeError);
 assert.equal(normalizeSegments(Array.from({length:4096},()=>[0,1])).length,1);
 assert.throws(()=>subtractSegments([[0,8192]],Array.from({length:4096},(_,i)=>[2*i+1,2*i+1.5])),RangeError);
 }},
 {name:'1000 seeded partitions conserve duration without overlap',run(assert){
 let seed=1234567;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 const intervals=()=>Array.from({length:Math.floor(random()*20)},()=>{const x=Math.floor(random()*100),y=Math.floor(random()*100);return[Math.min(x,y),Math.max(x,y)];});
 for(let i=0;i<1000;i++){const a=intervals(),b=intervals(),before=JSON.stringify({a,b}),inside=intersectSegments(a,b),outside=subtractSegments(a,b);
 assert.equal(intervalDuration(a),intervalDuration(inside)+intervalDuration(outside));assert.equal(intervalDuration(intersectSegments(outside,b)),0);assert.equal(JSON.stringify({a,b}),before);}
 }}
 ];
}
