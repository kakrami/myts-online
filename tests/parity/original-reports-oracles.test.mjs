import test from 'node:test';
import assert from 'node:assert/strict';
import { originalReportsProvenance, originalReportsSource, createOriginalReportsOracle, createReportDom, reportFixtureInput } from './original-reports-fixtures.mjs';

const make=(change={})=>createOriginalReportsOracle({...reportFixtureInput(),...change});
const expectedHeaders={
 season:['Metric','Value'],
 matches:['Date','Type','Status','Opponent','Location','Source','Competition','Score','Result','Attendance'],
 players:['Player','Jersey','Position','Apps','Starts','Minutes','Goals','Assists','G+A','G+A/60','Attendance'],
 availability:['Player','Yes','No','Maybe','No Response','Total','Yes %']
};

test('original Reports source is pinned to 6.20.133 and immutable source snippets',()=>{
 assert.equal(originalReportsProvenance.commit,'50e1be224806ff7e7c439d26e15fd0421e3f6f01');
 assert.equal(originalReportsProvenance.workerBlob,'bd2d055483abae37ddae2680ec62f6282da6680c');
 assert.equal(originalReportsProvenance.version,'6.20.133');
 assert.ok(Object.isFrozen(originalReportsSource));
 for(const [name,source] of Object.entries(originalReportsSource)){
  const ref=originalReportsProvenance.functions[name];
  assert.ok(ref.offset>=0&&ref.line>0);
  assert.equal(ref.length,source.length);
 }
});

test('four report names and exact ordered column contracts',()=>{
 const o=make();
 for(const [type,headers]of Object.entries(expectedHeaders))assert.deepEqual(Object.keys(o.reportRows(type)[0]),headers);
 assert.deepEqual(['season','matches','players','availability'].map(t=>o.reportName(t)),['Season Summary','Schedule','Players','Attendance']);
 assert.equal(o.reportName('other'),'Report');
});

test('Season Summary aggregates eligible past scores and separate GA/minutes leaders',()=>{
 assert.deepEqual(make().reportRows('season'),[
  {Metric:'Record',Value:'1-0-0'},{Metric:'Goals',Value:'3-1'},
  {Metric:'Matches analyzed',Value:2},{Metric:'Trace players',Value:2},
  {Metric:'Minutes leader',Value:'Mia Minutes'},{Metric:'G+A leader',Value:'Gia Goals'}
 ]);
});

test('Players preserve roster order, correction jersey zero, precision and blank rate',()=>{
 assert.deepEqual(make().reportRows('players'),[
  {Player:'Mia Minutes',Jersey:'0',Position:'CM',Apps:2,Starts:1,Minutes:'45.0',Goals:0,Assists:1,'G+A':1,'G+A/60':'1.33',Attendance:'50%'},
  {Player:'Gia Goals',Jersey:'10',Position:'ST',Apps:0,Starts:1,Minutes:'0.0',Goals:3,Assists:0,'G+A':3,'G+A/60':'',Attendance:'50%'},
  {Player:'Unknown Player',Jersey:'',Position:'GK',Apps:0,Starts:0,Minutes:'0.0',Goals:0,Assists:0,'G+A':0,'G+A/60':'',Attendance:'0%'}
 ]);
});

test('Attendance counts completed tracked events, includes Maybe/missing, excludes future/cancelled/excluded',()=>{
 assert.deepEqual(make().reportRows('availability'),[
  {Player:'Mia Minutes',Yes:1,No:0,Maybe:0,'No Response':1,Total:2,'Yes %':'50%'},
  {Player:'Gia Goals',Yes:1,No:1,Maybe:0,'No Response':0,Total:2,'Yes %':'50%'},
  {Player:'Unknown Player',Yes:0,No:0,Maybe:1,'No Response':1,Total:2,'Yes %':'0%'}
 ]);
 const o=make();
 assert.equal(o.statusCode({status_code:true}),'none');
 assert.equal(o.statusCode({status_code:' '}),'none');
 assert.equal(o.statusCode({status_code:'2'}),'maybe');
 assert.equal(o.eventAvailability({id:'untracked'}),null);
 assert.equal(o.reportRows('players')[0].Attendance,'50%');
});

test('Schedule preserves reconciled input order, source priority, duplicate/live/cancelled values',()=>{
 const rows=make().reportRows('matches');
 assert.deepEqual(rows.map(r=>r.Date),['2027-01-01','2026-07-01','2026-08-01','2026-08-03','2026-08-04','2026-10-12']);
 assert.deepEqual(rows[1],{Date:'2026-07-01',Type:'Game',Status:'Completed',Opponent:'Verified FC',Location:'Verified Park',Source:'TeamSnap',Competition:'League',Score:'3–1',Result:'W',Attendance:'33%'});
 assert.equal(rows[2].Type,'Practice');assert.equal(rows[2].Opponent,'');assert.equal(rows[2].Score,'');
 assert.equal(rows[3].Status,'Cancelled');for(const k of ['Score','Result','Attendance'])assert.equal(rows[3][k],'');
 assert.equal(rows[4].Status,'Possible duplicate');
 assert.equal(rows[5].Status,'Live');assert.equal(rows[5].Score,'1–0');assert.equal(rows[5].Result,'');
});

test('Included games changes summary while Schedule retains all scheduled items',()=>{
 const o=make({excludedItemIds:['g1']});
 assert.deepEqual(o.reportRows('season').slice(0,2),[{Metric:'Record',Value:'—'},{Metric:'Goals',Value:'—'}]);
 assert.equal(o.reportRows('matches').length,6);
});

test('empty scope preserves six summary metrics and blank denominator attendance',()=>{
 const o=createOriginalReportsOracle({players:[],items:[],traceGames:[],traceRows:[]});
 assert.deepEqual(o.reportRows('season'),[{Metric:'Record',Value:'—'},{Metric:'Goals',Value:'—'},{Metric:'Matches analyzed',Value:0},{Metric:'Trace players',Value:0},{Metric:'Minutes leader',Value:'—'},{Metric:'G+A leader',Value:'—'}]);
 for(const t of ['matches','players','availability'])assert.deepEqual(o.reportRows(t),[]);
 const p=createOriginalReportsOracle({players:[{id:'u',name:'U'}]});
 assert.equal(p.reportRows('players')[0].Attendance,'');
 assert.equal(p.reportRows('availability')[0]['Yes %'],'');
});

test('original date formatting uses verified team timezone and preserves date-only days',()=>{
 const o=make({timeZone:'America/Los_Angeles'});
 assert.equal(o.localEventDay('2026-07-02T01:00:00Z'),'2026-07-01');
 assert.equal(o.localEventDay('2026-07-02'),'2026-07-02');
});

test('original sortValue distinguishes empty, percentage, numeric units, date and natural text',()=>{
 const o=make();
 for(const v of ['',null,'—'])assert.deepEqual(o.sortValue(v),{kind:'empty',value:null});
 for(const [v,n]of [['33%',33],['1,200',1200],['12.5 min',12.5],['-2 m',-2],['3 km',3]])assert.deepEqual(o.sortValue(v),{kind:'number',value:n});
 assert.deepEqual(o.sortValue('2026-07-01'),{kind:'date',value:Date.parse('2026-07-01')});
 assert.deepEqual(o.sortValue('Unknown Label'),{kind:'text',value:'unknown label'});
});

test('original table sort keeps empties last in both directions and stable ties',()=>{
 const rows=[{N:'10',P:'Player 10'},{N:'',P:'Player 2'},{N:'2',P:'Player 1'},{N:'2',P:'Player 3'},{N:'—',P:'Player 4'}];
 const dom=createReportDom(rows),o=createOriginalReportsOracle({},dom);
 o.enableSortableTables(dom.host);
 dom.headers[0].querySelector('button').onclick();assert.deepEqual(dom.orderedIndices(),[2,3,0,1,4]);
 dom.headers[0].querySelector('button').onclick();assert.deepEqual(dom.orderedIndices(),[0,2,3,1,4]);
 dom.headers[1].querySelector('button').onclick();assert.deepEqual(dom.orderedIndices(),[2,1,3,4,0]);
});

test('sortCellText prefers explicit sort value and removes avatar/sort decoration',()=>{
 const o=make();assert.equal(o.sortCellText({dataset:{sortValue:'007'}}),'007');
 const removed=[];const clone={querySelectorAll:selector=>{assert.equal(selector,'.mini-avatar,.sort-mark');return[{remove:()=>removed.push('avatar')},{remove:()=>removed.push('icon')}]},get innerText(){return removed.length===2?'12':''}};
 assert.equal(o.sortCellText({dataset:{},cloneNode:deep=>{assert.equal(deep,true);return clone}}),'12');
});

test('saved and mobile table sort use the original apply callback',()=>{
 const rows=[{Player:'B',Goals:1},{Player:'A',Goals:3}],dom=createReportDom(rows);
 const o=createOriginalReportsOracle({savedSort:{'oracle-report':{index:1,direction:'descending'}}},dom);
 o.enableSortableTables(dom.host);assert.deepEqual(dom.orderedIndices(),[1,0]);
 const select=dom.controls[0].querySelector('select'),reverse=dom.controls[0].querySelector('button');
 select.value='0';select.onchange();assert.deepEqual(dom.orderedIndices(),[1,0]);
 reverse.onclick();assert.deepEqual(dom.orderedIndices(),[0,1]);
 assert.deepEqual(o.state.sort['oracle-report'],{index:0,direction:'descending'});
 const summary=createReportDom([{Metric:'A',Value:1}],{summary:true});
 createOriginalReportsOracle({},summary).enableSortableTables(summary.host);assert.equal(summary.controls.length,0);
});

test('renderReportDetail exports current DOM order in both Excel and PDF',()=>{
 const input={...reportFixtureInput(),reportType:'players'},rows=createOriginalReportsOracle(input).reportRows('players'),dom=createReportDom(rows);
 const o=createOriginalReportsOracle(input,dom);o.renderReportDetail();
 dom.headers[6].querySelector('button').onclick();dom.headers[6].querySelector('button').onclick();
 assert.deepEqual(dom.orderedIndices(),[1,0,2]);
 dom.buttons['#excelBtn'].onclick();dom.buttons['#pdfBtn'].onclick();
 const sorted=[rows[1],rows[0],rows[2]];
 assert.deepEqual(o.receipts.excel,[{name:'players_2026-27.xlsx',sheetName:'Report',rows:sorted}]);
 assert.deepEqual(o.receipts.pdf[0],{options:{orientation:'landscape'},fontSize:16,title:['Players · 2026/27',14,16],table:{startY:22,head:[expectedHeaders.players],body:sorted.map(Object.values),styles:{fontSize:7}},name:'players_2026-27.pdf'});
});

test('PDF orientation threshold, column insertion order and empty exports are exact',()=>{
 const o=make(),six={a:1,b:2,c:3,d:4,e:5,f:6},seven={...six,g:7};
 o.exportPdf([six],'Six Columns');o.exportPdf([seven],'Seven Columns');o.exportPdf([],'Season Summary');o.exportExcel([],'Season Summary');
 assert.equal(o.receipts.pdf[0].options.orientation,'portrait');assert.equal(o.receipts.pdf[1].options.orientation,'landscape');
 assert.deepEqual(o.receipts.pdf[0].table.head,[Object.keys(six)]);assert.deepEqual(o.receipts.pdf[0].table.body,[Object.values(six)]);
 assert.equal(o.receipts.pdf[2].table,undefined);assert.equal(o.receipts.pdf[2].name,'season_summary_2026-27.pdf');
 assert.deepEqual(o.receipts.excel[0].rows,[]);
});

test('missing export libraries emit original actionable errors without output',()=>{
 const o=make({libraries:'missing'});o.exportExcel([],'Players');o.exportPdf([],'Players');
 assert.deepEqual(o.receipts.toasts,[['Excel export unavailable','Reload and try again.','error'],['PDF export unavailable','Reload and try again.','error']]);
 assert.deepEqual(o.receipts.excel,[]);assert.deepEqual(o.receipts.pdf,[]);
});

test('137-row original Schedule sort and both export bindings preserve every row',()=>{
 const items=Array.from({length:137},(_,i)=>({id:String(i),kind:'event',date:'2026-07-01T12:00:00Z',event:{id:String(i),_type:'Practice',_location:'Field Q'+(136-i)+'Z'}}));
 const input={items,reportType:'matches',seasonYear:2026},rows=createOriginalReportsOracle(input).reportRows('matches'),dom=createReportDom(rows);
 const o=createOriginalReportsOracle(input,dom);o.renderReportDetail();dom.headers[4].querySelector('button').onclick();
 const expected=Array.from({length:137},(_,i)=>136-i);
 assert.deepEqual(dom.orderedIndices(),expected);
 dom.buttons['#excelBtn'].onclick();dom.buttons['#pdfBtn'].onclick();
 assert.equal(o.receipts.excel[0].rows.length,137);assert.equal(o.receipts.pdf[0].table.body.length,137);
 assert.deepEqual(o.receipts.excel[0].rows,expected.map(i=>rows[i]));
 assert.deepEqual(o.receipts.pdf[0].table.body,expected.map(i=>Object.values(rows[i])));
});

test('GA and minutes leader ties retain derived roster order',()=>{
 const input={players:[{id:'b',name:'B'},{id:'a',name:'A'}],rowsByMember:{b:[{minutes:10,goals:1}],a:[{minutes:10,goals:1}]}};
 assert.deepEqual(createOriginalReportsOracle(input).reportRows('season').slice(4),[{Metric:'Minutes leader',Value:'B'},{Metric:'G+A leader',Value:'B'}]);
});
