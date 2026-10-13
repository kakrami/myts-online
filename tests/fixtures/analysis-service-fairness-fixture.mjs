import assert from 'node:assert/strict';
import {derivedPublicationFixture} from './derived-publication-fixture.mjs';
import {traceNativeGame,traceProvider} from './trace-analysis-native.mjs';
import {REPORT_SCHEMA} from '../../src/reporting/schema.js';
import {COACH_SCHEMA} from '../../src/coaching/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../../src/application/team-features.js';
import {DATA_FILE_SCHEMA} from '../../src/reporting/data-schema.js';
import {SECURITY_SCHEMA} from '../../src/security/schema.js';
import {JobCoordinator} from '../../src/sync/coordinator.js';
import {collectApplicationJob} from '../../src/application/sync-service.js';
import {buildConnectionPage} from '../../src/domain/connection-materializer.js';

// Production collectors/materializers create every source, accepted membership,
// and obsolete projection row. Native tests import this saved synthetic state.
export async function analysisServiceFairnessFixture(){
 const f=await derivedPublicationFixture({historyCount:49});
 for(const sql of [...REPORT_SCHEMA,...COACH_SCHEMA,...TEAM_FEATURE_SCHEMA,...DATA_FILE_SCHEMA,...SECURITY_SCHEMA])f.sqlite.exec(sql);
 const old=traceNativeGame();old.game_id=4002;old.full_date='2026-07-02T17:00:00Z';for(const m of old.moments){m.game_id=4002;m.game_clip_id+=100;}
 const provider=traceProvider(old),oldChildren=[];let checkpoint={};
 for(let turn=0;turn<20;turn++){const p=await provider.collect('game',{team_id:'400',game_id:'4002',profile_hash:'synthetic-profile'},checkpoint);await f.save(p);oldChildren.push(...p.children);checkpoint=p.checkpoint;if(p.complete)break;assert.ok(turn<19);}
 const commit=async page=>f.db.batch(page.statements.map(s=>f.db.prepare(s.sql.replaceAll('$FENCE','1')).bind(...s.params)));
 const reconcile=async()=>{let cp={};for(let n=0;n<100;n++){const page=await buildConnectionPage(f.db,{connectionId:'root',teamId:'team',generation:1,checkpoint:cp});await commit(page);cp=page.checkpoint;if(page.complete)return;assert.ok(n<99);}};
 await reconcile();
 const published=[];
 for(let pass=0;pass<4;pass++){
  if(pass)f.sqlite.exec("UPDATE team_projection_state SET input_revision=input_revision+1,pending=1");
  let cp={};for(let n=0;n<100;n++){const page=await f.repo.buildProjectionPage('team','season',cp);await commit(page);cp=page.checkpoint;if(page.published){published.push(cp.runId);break;}assert.ok(n<99);}
 }
 // Historical schedule-only games already received a real terminal analysis
 // attempt. Their exact source clocks prevent unrelated recovery from turning
 // this focused scheduler proof into a second whole-season analysis import.
 const prepare=(sql,params=[])=>({sql,params,bind(...values){return prepare(sql,values);},async all(){return {results:f.sqlite.prepare(sql).all(...params).map(row=>({...row})),meta:{changes:f.sqlite.prepare('SELECT changes() n').get().n}};},async first(column){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;},async run(){return this.all();}});f.db.prepare=prepare;
 const jobs=new JobCoordinator(f.db,{pageDelayMs:0});
 for(const event of f.rows("SELECT event_id FROM event_source_links WHERE source_event_id LIKE 'trace/account/50%'")){
  await jobs.enqueue({provider:'analysis',component:'match',stage:'analysis',scope:'team',resourceKey:'season:'+event.event_id,args:{teamId:'team',seasonId:'season',eventId:event.event_id,automatic:true},priority:70,recurring:false},[{kind:'team',teamId:'team',key:'analysis:team:season:'+event.event_id}]);
  const lease=await jobs.claim(),page=await collectApplicationJob({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});assert.equal(page.rowsSaved,0);assert.equal((await jobs.commit(lease,page)).committed,true);
 }
 assert.equal(f.rows("SELECT COUNT(*) n FROM team_projection_runs WHERE state='obsolete'")[0].n,3);
 assert.equal(f.rows('SELECT COUNT(*) n FROM team_events')[0].n,51);
 await f.repo.createTeam({teamId:'other-team',seasonId:'other-season',name:'Other synthetic team',timezone:'UTC',seasonYear:2026});
 await f.repo.attachTeam({teamId:'other-team',seasonId:'other-season',accountId:'account',sourceTeamId:'trace/account/400'});
 const tables=f.rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r=>r.name).filter(name=>name!=='domain_installation'&&f.rows('SELECT COUNT(*) n FROM '+name)[0].n>0);
 // Tables with installation defaults are absent from this focused fixture.
 const sorted=[],pending=new Set(tables);
 while(pending.size){const ready=[...pending].filter(name=>f.rows('PRAGMA foreign_key_list('+name+')').every(r=>r.table===name||!pending.has(r.table))&&(name!=='team_source_connections'||!['source_event_teams','event_source_links'].some(t=>pending.has(t))));assert.ok(ready.length,'synthetic table dependency cycle: '+[...pending]);for(const name of ready){sorted.push(name);pending.delete(name);}}
 return {...f,seedTables:sorted,initialPointer:published.at(-1),oldChildren:oldChildren.map(c=>({provider:c.provider,component:c.kind,scope:c.scope,resourceKey:c.scope,args:c.args,stage:'analysis',priority:20,accountId:'account',accountGeneration:1,recurring:false})),recentEvent:f.rows("SELECT event_id FROM event_source_links WHERE source_event_id='trace/account/4001'")[0].event_id,oldEvent:f.rows("SELECT event_id FROM event_source_links WHERE source_event_id='trace/account/4002'")[0].event_id};
}
