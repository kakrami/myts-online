import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {COACH_SCHEMA} from '../src/coaching/schema.js';
import {CoachingService,applyCoachCommand,presentCoachSession,suggestCoachLineup,suggestCoachSubstitutions,validateProfile} from '../src/coaching/service.js';
import {COACH_SLOTS} from '../web/app/coach-tactics.js';
import {coachLiveSession} from '../web/app/coach-presentation.js';
import {createOriginalCoachOracle,coachState} from './parity/original-coach-fixtures.mjs';
const AT=Date.parse('2026-10-12T12:00:00Z'),scope={team_id:'team',team_season_id:'season',event_id:'event'};
const slot=id=>COACH_SLOTS[Number(id)].id;
function rebuilt(s){return {format:s.format,half_minutes:s.half_minutes,phase:s.phase==='planning'?'setup':s.phase,period:s.period,elapsed_ms:s.elapsed_ms,period_start_ms:s.elapsed_ms-s.period_elapsed_ms,running_since:s.running_since,clock_review:false,players:s.roster.map(p=>({player_id:p.id,name:p.name,jersey:p.jersey,available:s.active.includes(p.id),minutes_override_ms:s.minutes_ms[p.id]??null})),field:Object.fromEntries(Object.entries(s.field).map(([key,p])=>[slot(key),p])),history:[],stints:[]};}
const originalField=field=>Object.fromEntries(Object.entries(field).map(([key,value])=>[COACH_SLOTS.find(s=>s.id===key)?.index,value]));
function fixture(options={}){const f=analysisFixture({players:11,...options});for(const sql of [...COACH_SCHEMA,...TEAM_FEATURE_SCHEMA])f.sqlite.exec(sql);let now=AT;const service=new CoachingService(f.db,{owner:true},{now:()=>now});return {...f,service,setNow:at=>now=at};}
for(const format of [7,9])test(`original ${format}v${format} starters retain exact geometry, scoring and stable roster tie order`,()=>{
 const s=coachState({count:12,format});s.roster[0].id='z-first';s.roster[1].id='a-second';s.active=s.roster.map(p=>p.id);s.active.splice(5,1);
 const profiles={'a-second':{positions:{GK:3}},p2:{positions:{LCB:4,CB:5}},p3:{positions:{RCM:5},target_minutes:0},p4:{positions:{ST:3},endurance:5}},hints={'z-first':{assigned_position:'GK'},p6:{assigned_position:'RW'}};
 const oracle=createOriginalCoachOracle({players:Object.fromEntries(Object.entries(hints).map(([id,p])=>[id,{id,...p}]))});
 assert.deepEqual(originalField(suggestCoachLineup(rebuilt(s),profiles,hints,AT).field),oracle.coachSuggestedField(s,profiles));
 const tied=coachState({count:10,format});tied.roster[0].id='z-first';tied.roster[1].id='a-second';tied.active=tied.roster.map(p=>p.id);assert.equal(suggestCoachLineup(rebuilt(tied)).field.GK,'z-first');
});
test('all original positions and three striker slots survive alongside legacy LF/RF',()=>{
 const oracle=createOriginalCoachOracle();for(const {position}of oracle.lineupDropTargets()){const v={positions:{[position]:5},endurance:null,target_minutes:0};assert.deepEqual(validateProfile(v),oracle.coachAttributes(v));}
 assert.equal(COACH_SLOTS.length,23);const s=rebuilt(coachState({count:9})),field={GK:'p0','ST:L':'p1',ST:'p2','ST:R':'p3',LF:'p4',RF:'p5'};assert.deepEqual(applyCoachCommand(s,{type:'lineup',field},AT).field,field);
 assert.throws(()=>validateProfile({target_minutes:.5}));assert.equal(validateProfile({target_minutes:0}).target_minutes,0);assert.equal(validateProfile({target_minutes:null}).target_minutes,null);
});
test('original live top-three scores, reasons, full-roster targets and explicit zero match exactly',()=>{
 const s=coachState({count:5,phase:'paused',field:{0:'p0'},minutes_ms:{p0:600000,p1:120000,p2:300000,p3:0,p4:900000}}),profiles={p0:{target_minutes:5},p1:{positions:{GK:5},endurance:4,target_minutes:20},p2:{positions:{GK:4},endurance:5,target_minutes:20},p3:{positions:{GK:3},endurance:3,target_minutes:20},p4:{positions:{GK:5},endurance:5,target_minutes:20}},hints={p1:{resolved_position:'GK',recent_trace_minutes:[6,8,10]}},oracle=createOriginalCoachOracle({players:{p1:{id:'p1',resolved_position:'GK'}},history:{p1:[6,8,10].map(minutes=>({game_id:'x',minutes}))}});
 const n=rebuilt(s);n.elapsed_ms=900000;n.period_start_ms=0;
 const actual=suggestCoachSubstitutions(n,profiles,hints,AT),expected=oracle.coachRecommendations(s,profiles);assert.deepEqual(actual.map(r=>({in:r.in.id,out:r.out.id,score:r.score,reason:r.reason,slot:COACH_SLOTS.find(s=>s.id===r.slot).index})),expected.map(r=>({in:r.in.id,out:r.out.id,score:r.score,reason:r.reason,slot:r.slot})));
 const zero=coachState({count:10,phase:'paused',field:{0:'p0'},active:['p0','p1'],half_minutes:5}),p={p0:{target_minutes:0},p1:{positions:{GK:5},target_minutes:0,endurance:3}};
 assert.equal(suggestCoachSubstitutions(rebuilt(zero),p,{},AT)[0].score,createOriginalCoachOracle().coachRecommendations(zero,p)[0].score);
 assert.equal(suggestCoachSubstitutions(rebuilt(zero),{p1:{positions:{GK:1}}},{},AT)[0].score,createOriginalCoachOracle().coachRecommendations(zero,{p1:{positions:{GK:1}}})[0].score);
 for(const phase of ['setup','halftime','finished'])assert.deepEqual(suggestCoachSubstitutions({...n,phase},profiles,hints,AT),[]);
});
test('actual persisted service configures 90-minute halves without losing lineage and rejects stale/reducing writes',async()=>{
 const f=fixture();try{let r=await f.service.command(scope,{type:'create',format:9,half_minutes:25},0),s=r.session;const p=s.roster.map(p=>p.id),field=Object.fromEntries(COACH_SLOTS.slice(0,9).map((slot,i)=>[slot.id,p[i]]));s=(await f.service.command(scope,{type:'lineup',field},s.revision)).session;const before=f.all('SELECT * FROM coach_lineup');
 s=(await f.service.command(scope,{type:'configure',format:9,half_minutes:90},s.revision)).session;assert.equal(s.half_minutes,90);assert.deepEqual(f.all('SELECT * FROM coach_lineup'),before);assert.equal((await f.service.read(scope)).session.half_minutes,90);assert.deepEqual(s.history.map(h=>h.kind),['lineup','configure']);
 await assert.rejects(f.service.command(scope,{type:'configure',format:7,half_minutes:25},s.revision),/Remove starters/);await assert.rejects(f.service.command(scope,{type:'configure',format:9,half_minutes:25},s.revision-1),e=>e.code==='revision_conflict');assert.equal((await f.service.read(scope)).session.revision,s.revision);
 const viewer=new CoachingService(f.db,{role:'viewer'});await assert.rejects(viewer.read(scope),e=>e.status===403);await assert.rejects(viewer.command(scope,{type:'pause'},s.revision),e=>e.status===403);
 }finally{f.close();}
});
for(const format of [7,9])test(`persisted ${format}v${format} original start/pause/resume/halftime/next-half/finish accounting`,async()=>{
 const f=fixture();try{let s=(await f.service.command(scope,{type:'create',format,half_minutes:25},0)).session;const ids=s.roster.map(p=>p.id),old=coachState({count:11,format,roster:s.roster.map(p=>({id:p.id,name:p.name,jersey:p.jersey})),active:ids}),oracle=createOriginalCoachOracle();const field=oracle.coachSuggestedField(old,{});old.field=field;
 s=(await f.service.command(scope,{type:'lineup',field:Object.fromEntries(Object.entries(field).map(([i,p])=>[slot(i),p]))},s.revision)).session;
 const command=async(action,at)=>{f.setNow(at);oracle.coachApply(old,action,at);s=(await f.service.command(scope,action,s.revision)).session;assert.equal(s.phase,old.phase==='planning'?'setup':old.phase);assert.equal(s.period,old.period);assert.equal(s.period_elapsed_ms,old.period_elapsed_ms);assert.equal(s.live_elapsed_ms,old.elapsed_ms);for(const id of ids)assert.equal(s.minutes_ms[id],old.minutes_ms[id]??0,id);assert.deepEqual(originalField(s.field),old.field);};
 await command({type:'start'},AT);await command({type:'pause'},AT+600000);await command({type:'resume'},AT+900000);await command({type:'sub',out:ids[0],in:ids[format]},AT+1200000);await command({type:'halftime'},AT+1800000);await command({type:'next_half'},AT+2100000);await command({type:'finish'},AT+3600000);assert.equal(s.minutes_total_ms,format*50*60000);assert.equal(s.minutes_capacity_ms,s.minutes_total_ms);
 const reloaded=(await f.service.read(scope)).session;assert.deepEqual(reloaded.minutes_ms,s.minutes_ms);assert.deepEqual(reloaded.field,s.field);assert.equal(reloaded.period_elapsed_ms,25*60000);
 }finally{f.close();}
});
for(const phase of ['paused','halftime','finished'])test(`persisted missed substitution is reachable at ${phase} and changes minutes plus current field`,async()=>{
 const f=fixture();try{let s=(await f.service.command(scope,{type:'create',format:7},0)).session,ids=s.roster.map(p=>p.id),field=Object.fromEntries(COACH_SLOTS.slice(0,7).map((v,i)=>[v.id,ids[i]]));for(const action of [{type:'lineup',field},{type:'start'}])s=(await f.service.command(scope,action,s.revision)).session;f.setNow(AT+600000);s=(await f.service.command(scope,{type:phase==='paused'?'pause':phase==='halftime'?'halftime':'finish'},s.revision)).session;
 s=(await f.service.command(scope,{type:'correct_sub',out:ids[0],in:ids[7],delta:120000},s.revision)).session;assert.equal(s.field.GK,ids[7]);assert.equal(s.minutes_ms[ids[0]],480000);assert.equal(s.minutes_ms[ids[7]],120000);assert.equal(s.minutes_total_ms,7*600000);assert.equal(s.minutes_recorded_total_ms,s.minutes_total_ms);assert.deepEqual((await f.service.read(scope)).session.field,s.field);
 }finally{f.close();}
});
test('clock sampling never double-counts resumed live minutes or writes while reading',async()=>{
 const f=fixture();try{let s=(await f.service.command(scope,{type:'create',format:7},0)).session,ids=s.roster.map(p=>p.id),field=Object.fromEntries(COACH_SLOTS.slice(0,7).map((v,i)=>[v.id,ids[i]]));for(const action of [{type:'lineup',field},{type:'start'}])s=(await f.service.command(scope,action,s.revision)).session;f.setNow(AT+60000);const before=f.all('SELECT * FROM coach_sessions');s=(await f.service.read(scope)).session;assert.equal(s.minutes_ms[ids[0]],60000);assert.equal(coachLiveSession(s,AT+90000).minutes_ms[ids[0]],90000);assert.deepEqual(f.all('SELECT * FROM coach_sessions'),before);
 f.setNow(AT+13*3600000);s=(await f.service.read(scope)).session;assert.equal(s.clock_review,true);assert.equal(s.minutes_total_ms,0);assert.equal(coachLiveSession(s,AT+14*3600000).minutes_ms[ids[0]],0);s=(await f.service.command(scope,{type:'pause'},s.revision)).session;await assert.rejects(f.service.command(scope,{type:'resume'},s.revision),e=>e.code==='clock_review');
 }finally{f.close();}
});
test('source-resolved role and recent Trace explanation retain null versus zero with bounded corrections',async()=>{
 const f=fixture({players:7});try{const page=await f.page();f.commit(page);const hints=await f.service.roleHints(scope);assert.ok(Object.values(hints).every(h=>h.recent_trace_minutes.length<=5));assert.equal(hints['player-000'].recent_trace_minutes[0],50);
 f.sqlite.exec("UPDATE player_match_analysis SET minutes=NULL,position=NULL WHERE player_id='player-000'");const unknown=await f.service.roleHints(scope);assert.deepEqual(unknown['player-000'].recent_trace_minutes,[]);assert.equal(unknown['player-000'].resolved_position,null);
 const p={...scope,player_id:'player-000'};await f.service.setProfile(p,{positions:{LCB:5},target_minutes:0,endurance:null},0);assert.equal((await f.service.profiles(scope))[p.player_id].value.target_minutes,0);await f.service.setProfile(p,{positions:{},target_minutes:null,endurance:null},1);assert.equal((await f.service.profiles(scope))[p.player_id].value.target_minutes,null);
 let s=rebuilt(coachState({count:8,phase:'paused',elapsed_ms:600000,period_elapsed_ms:600000,field:{0:'p0'}}));s.stints=[{id:'x',player_id:'p0',position:'GK',period:1,start_ms:0,end_ms:600000}];assert.throws(()=>applyCoachCommand(s,{type:'correct',minutes:{p1:11}},AT),/exceed/);assert.equal(presentCoachSession(applyCoachCommand(s,{type:'correct',minutes:{p0:0}},AT),AT).minutes_ms.p0,0);
 }finally{f.close();}
});

test('server-reviewed interrupted clock retains previously recorded minutes, and local threshold uses its sampled basis once',()=>{
 const s=rebuilt(coachState({count:7,phase:'running',elapsed_ms:600000,period_elapsed_ms:600000,running_since:new Date(AT).toISOString(),field:{0:'p0'}}));s.stints=[{id:'closed',player_id:'p0',position:'GK',period:1,start_ms:0,end_ms:600000},{id:'open',player_id:'p0',position:'GK',period:1,start_ms:600000,end_ms:null}];
 const server=presentCoachSession(s,AT+13*3600000);assert.equal(server.clock_review,true);assert.equal(server.minutes_ms.p0,600000);assert.equal(coachLiveSession(server,AT+13*3600000).minutes_ms.p0,600000);
 const before=presentCoachSession(s,AT+3600000);assert.equal(before.minutes_ms.p0,4200000);const after=coachLiveSession(before,AT+13*3600000);assert.equal(after.clock_review,true);assert.equal(after.minutes_ms.p0,600000);
});
test('original full-field start permits any declared slot geometry without forcing a goalkeeper',()=>{
 const original=coachState({count:7,field:{1:'p0',2:'p1',3:'p2',4:'p3',5:'p4',6:'p5',7:'p6'}}),oracle=createOriginalCoachOracle();oracle.coachApply(structuredClone(original),{type:'start'},AT);assert.equal(applyCoachCommand(rebuilt(original),{type:'start'},AT).phase,'running');
});
test('missed substitution after an explicit minute correction retains interval and override provenance',()=>{
 let s=rebuilt(coachState({count:8,phase:'paused',elapsed_ms:600000,period_elapsed_ms:600000,field:{0:'p0'}}));s.stints=[{id:'x',player_id:'p0',position:'GK',period:1,start_ms:0,end_ms:600000}];s=applyCoachCommand(s,{type:'correct',minutes:{p0:8,p7:0}},AT);s=applyCoachCommand(s,{type:'correct_sub',out:'p0',in:'p7',delta:120000},AT);const view=presentCoachSession(s,AT);assert.equal(view.field.GK,'p7');assert.equal(view.minutes_ms.p0,360000);assert.equal(view.minutes_ms.p7,120000);assert.equal(view.recorded_minutes_ms.p0,480000);assert.equal(view.recorded_minutes_ms.p7,120000);assert.equal(view.minutes_total_ms,480000);assert.equal(view.minutes_recorded_total_ms,600000);
});
