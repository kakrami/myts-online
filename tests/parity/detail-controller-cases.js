// Portable controller cases: no Node imports, network calls, browser or timers.
// The real controller uses a private Coach fixture and a minimal entityBody host.
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const parse=path=>{const [pathname,query='']=path.split('?');const params=Object.fromEntries(query.split('&').filter(Boolean).map(part=>{const [key,...value]=part.split('=');return [decodeURIComponent(key),decodeURIComponent(value.join('='))];}));return {pathname,params};};
const envelope=(id,extra={})=>({data:{event:{id,title:'Match '+id,starts_at:'2026-10-12T12:00:00Z',status:'FINAL',home:{id:'home',name:'Home'},away:{id:'away',name:'Away'}},capabilities:{can_coach:true},...extra}});
function fixture(createDetailFeatures,{role='owner',read,hydrate,panel}={}){
 const calls={reads:[],renders:[],panels:[],binds:0,hydrates:0};
 const body={classList:{toggle(){}},querySelector(){return null;}};
 const api={
  state:{active:true,routeEpoch:1,team:'team-a',season:'season-a',editorDirty:false,details:[],bootstrap:{teams:[],session:{role}}},
  host:{querySelector(selector){if(selector==='#entityBody')return body;return null;}},
  requireOwner(){if(api.state.bootstrap.session.role!=='owner'){const error=new Error('Owner required');error.code='owner_required';throw error;}},
  pathFor(path,extra={}){const query=Object.entries({team_id:api.state.team,team_season_id:api.state.season,...extra}).filter(([,value])=>value!=null).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(String(value))).join('&');return path+(path.includes('?')?'&':'?')+query;},
  transport:{async read(key,path){calls.reads.push({key,path});if(read)return read(key,path,api);return {discarded:false,data:envelope(decodeURIComponent(parse(path).pathname.split('/').at(-1)))};}},
  async hydrateModel(model){calls.hydrates++;return hydrate?hydrate(model,api):model;},
  setDetail(model){calls.renders.push(model);},
  notice(){},
 };
 const coach={
  cleanup(){},
  async panel(event,context){context.requireOwner();calls.panels.push(event);return panel?panel(event,context):'<p data-private-coach>Private Coach fixture</p>';},
  async profile(){return '';},
  bind(){calls.binds++;},
 };
 const features=createDetailFeatures({coach,lineup:{cleanup(){}}});
 api.action=(name,data)=>features.actions[name]?.(data,api);
 const open=async(id,options={})=>{const detail={kind:'match',id,...options};api.state.details=[detail];await features.openDetail(detail,api);return detail;};
 return {api,calls,features,open};
}
export async function runDetailCases({createDetailFeatures,assert,onCase}){
 const cases=[
  ['Coach uses the overview match envelope and then paints the private panel',async()=>{
   const f=fixture(createDetailFeatures);await f.open('match-a');
   await f.features.actions['detail-tab']({tab:'coach'},f.api);
   const urls=f.calls.reads.map(v=>parse(v.path));
   assert.equal(urls.length,2);assert.equal(urls[1].pathname,'/api/matches/match-a');
   assert.equal(urls[1].params.tab,'overview');
   assert.equal(urls[1].params.team_id,'team-a');assert.equal(urls[1].params.team_season_id,'season-a');
   assert.equal(f.calls.panels.join(','),'match-a');assert.equal(f.calls.binds,1);
   assert.ok(f.calls.renders.at(-1).bodyHTML.includes('data-private-coach'));
  }],
  ['Coach normalization overrides an inherited tab filter while other filters survive',async()=>{
   const f=fixture(createDetailFeatures);await f.open('match-a',{filters:{tab:'coach',view:'own'}});
   await f.features.actions['detail-tab']({tab:'coach'},f.api);
   const url=parse(f.calls.reads.at(-1).path);
   assert.equal(url.params.tab,'overview');assert.equal(url.params.view,'own');
   await f.features.actions['detail-tab']({tab:'h2h'},f.api);
   assert.equal(parse(f.calls.reads.at(-1).path).params.tab,'h2h');
  }],
  ['A viewer cannot invoke Coach through the detail-tab action',async()=>{
   const f=fixture(createDetailFeatures,{role:'viewer'});await f.open('match-a');
   const reads=f.calls.reads.length,renders=f.calls.renders.length;
   let error;try{await f.features.actions['detail-tab']({tab:'coach'},f.api);}catch(caught){error=caught;}
   assert.equal(error?.code,'owner_required');assert.equal(f.calls.reads.length,reads);
   assert.equal(f.calls.renders.length,renders);assert.equal(f.calls.panels.length,0);assert.equal(f.calls.binds,0);
   assert.equal(f.api.state.details.at(-1).tab,undefined);
  }],
  ['Late hydration cannot overwrite a newer match model',async()=>{
   const entered=deferred(),release=deferred();
   const f=fixture(createDetailFeatures,{hydrate:async model=>{if(model.data.event.id==='match-a'){entered.resolve();await release.promise;}return model;}});
   const detailA={kind:'match',id:'match-a'},detailB={kind:'match',id:'match-b'};f.api.state.details=[detailA];
   const old=f.features.openDetail(detailA,f.api);await entered.promise;
   f.api.state.details=[detailB];await f.features.openDetail(detailB,f.api);release.resolve();await old;
   await f.features.paint(detailB,f.api);
   assert.equal(f.calls.renders.at(-1).title,'Match match-b');assert.equal(f.api.state.detailModel.event.id,'match-b');
   assert.ok(f.calls.renders.every(v=>v.title!=='Match match-a'));
  }],
  ['A newer request using the same detail object fences its older hydration',async()=>{
   const entered=deferred(),release=deferred();let count=0;
   const f=fixture(createDetailFeatures,{hydrate:async model=>{const ordinal=++count;if(ordinal===1){entered.resolve();await release.promise;}return {...model,data:{...model.data,event:{...model.data.event,title:ordinal===1?'Older revision':'Newer revision'}}};}});
   const detail={kind:'match',id:'match-a'};f.api.state.details=[detail];
   const old=f.features.openDetail(detail,f.api);await entered.promise;await f.features.openDetail(detail,f.api);release.resolve();await old;
   await f.features.paint(detail,f.api);
   assert.equal(f.calls.renders.at(-1).title,'Newer revision');assert.equal(f.api.state.detailModel.event.title,'Newer revision');
   assert.ok(f.calls.renders.every(v=>v.title!=='Older revision'));
  }],
  ['Changing the team while a Coach panel loads prevents its late paint and binding',async()=>{
   const entered=deferred(),release=deferred();
   const f=fixture(createDetailFeatures,{panel:async()=>{entered.resolve();await release.promise;return '<p data-private-coach>Stale</p>';}});
   await f.open('match-a');const renders=f.calls.renders.length;
   const pending=f.features.actions['detail-tab']({tab:'coach'},f.api);await entered.promise;
   f.api.state.team='team-b';release.resolve();await pending;
   assert.equal(f.calls.renders.length,renders);assert.equal(f.calls.binds,0);
  }],
  ['Closing details while a Coach panel loads prevents its late paint and binding',async()=>{
   const entered=deferred(),release=deferred();
   const f=fixture(createDetailFeatures,{panel:async()=>{entered.resolve();await release.promise;return '<p data-private-coach>Closed</p>';}});
   await f.open('match-a');const renders=f.calls.renders.length;
   const pending=f.features.actions['detail-tab']({tab:'coach'},f.api);await entered.promise;
   f.features.cleanup(f.api);release.resolve();await pending;
   assert.equal(f.calls.renders.length,renders);assert.equal(f.calls.binds,0);
  }],
  ['Losing the owner session while a Coach panel loads prevents private content painting',async()=>{
   const entered=deferred(),release=deferred();
   const f=fixture(createDetailFeatures,{panel:async()=>{entered.resolve();await release.promise;return '<p data-private-coach>Former owner</p>';}});
   await f.open('match-a');const renders=f.calls.renders.length;
   const pending=f.features.actions['detail-tab']({tab:'coach'},f.api);await entered.promise;
   f.api.state.bootstrap.session.role='viewer';release.resolve();await pending;
   assert.equal(f.calls.renders.length,renders);assert.equal(f.calls.binds,0);
  }],
  ['The route epoch also fences work after asynchronous model hydration',async()=>{
   const entered=deferred(),release=deferred();
   const f=fixture(createDetailFeatures,{hydrate:async model=>{entered.resolve();await release.promise;return model;}});
   const pending=f.open('match-a');await entered.promise;f.api.state.routeEpoch++;release.resolve();await pending;
   assert.equal(f.calls.renders.length,0);assert.equal(f.api.state.detailModel,undefined);
  }],
 ];
 const completed=[];
 for(const [name,run] of cases){if(onCase)await onCase(name,run);else await run();completed.push(name);}
 return completed;
}
