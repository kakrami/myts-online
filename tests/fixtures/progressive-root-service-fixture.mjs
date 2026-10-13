import {analysisFixture} from './shared-analysis-fixture.mjs';
import {SYNC_SCHEMA} from '../../src/sync/schema.js';
import {REPORT_SCHEMA} from '../../src/reporting/schema.js';
import {COACH_SCHEMA} from '../../src/coaching/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../../src/application/team-features.js';
import {DATA_FILE_SCHEMA} from '../../src/reporting/data-schema.js';
import {SECURITY_SCHEMA} from '../../src/security/schema.js';
import {JobCoordinator} from '../../src/sync/coordinator.js';

export const AT=Date.parse('2026-10-13T05:20:00Z'),OLD='2026-10-13T05:07:00Z';
export function progressiveFixture(t){
 if(t)t.mock.timers.enable({apis:['Date'],now:AT});
 const f=analysisFixture();if(t)t.after(()=>f.close());
 for(const sql of [...SYNC_SCHEMA,...REPORT_SCHEMA,...COACH_SCHEMA,...TEAM_FEATURE_SCHEMA,...DATA_FILE_SCHEMA,...SECURITY_SCHEMA])f.sqlite.exec(sql);
 const prepare=(sql,params=[])=>({sql,params,bind(...values){return prepare(sql,values);},async all(){const results=f.sqlite.prepare(sql).all(...params).map(row=>({...row}));return {results,meta:{changes:f.sqlite.prepare('SELECT changes() n').get().n}};},async first(column){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;},async run(){return this.all();}});
 f.db.prepare=prepare;
 f.sqlite.exec("INSERT INTO account_source_teams(account_id,source_team_id) VALUES('account','source-team'); UPDATE team_source_connections SET input_revision=401,reconciled_revision=136,last_reconciled_at='2026-10-13T05:07:00Z'; UPDATE source_events SET starts_at='2026-09-01T12:00:00Z'; UPDATE source_teams SET evidence='{\"slug\":\"synthetic-trace-team\"}' WHERE id='source-team';");
 const jobs=new JobCoordinator(f.db,{clock:()=>AT,publicHistory:true,pageDelayMs:0,retryBaseMs:1}),rows=(sql,...args)=>f.sqlite.prepare(sql).all(...args).map(v=>({...v})),one=(sql,...args)=>rows(sql,...args)[0]??null;
 const enqueue=async({provider='trace',component='games',stage='source',scope='trace:10',resourceKey=crypto.randomUUID(),args={},priority=97,key='connection:root',...rest}={})=>jobs.enqueue({provider,component,stage,scope,resourceKey,args,priority,recurring:false,...provider==='trace'?{accountId:'account',accountGeneration:1}:{},...rest},[{kind:'team',teamId:'team',key,generation:1}]);
 const root=async(overrides={})=>enqueue({provider:'domain',component:'connection',stage:'projection',scope:'team',resourceKey:'root',args:{connectionId:'root',teamId:'team',generation:1,inputRevision:401},priority:20,...overrides});
 const values=new Map(),ctx={storage:{async get(k){return values.get(k);},async put(k,v){values.set(k,structuredClone(v));},async getAlarm(){return values.get('alarm')??null;},async setAlarm(at){values.set('alarm',at);},async deleteAlarm(){values.delete('alarm');}}};
 return {...f,jobs,rows,one,enqueue,root,values,ctx};
}
export function addSecondRootAndHistory(f){
 f.insert('source_teams',{id:'gotsport-team',provider:'gotsport',scope:'public',account_id:null,native_id:'710001',name:'Us',name_authority:3,archived:0,evidence:'{}',content_hash:'gotsport',observed_at:OLD});
 f.insert('team_source_connections',{id:'gotsport-root',app_team_id:'team',source_team_id:'gotsport-team',account_id:null,scope_mode:'observed_history',created_at:OLD});
 f.insert('team_source_attachments',{id:'gotsport-attachment',app_team_id:'team',team_season_id:'season',source_team_id:'gotsport-team',account_id:null});
 f.insert('team_connection_seasons',{connection_id:'gotsport-root',team_season_id:'season',attachment_id:'gotsport-attachment',basis:'events'});
 for(const provider of ['trace','gotsport'])for(let i=1;i<=25;i++){
  const id=provider+'-event-'+String(i).padStart(3,'0'),sourceTeam=provider==='trace'?'source-team':'gotsport-team',account=provider==='trace'?'account':null;
  f.insert('source_events',{id,provider,scope:account||'public',account_id:account,native_id:provider+'-'+i,starts_at:'2026-09-02T12:00:00Z',local_day:'2026-09-02',time_precision:'instant',type:'game',status:'FINAL',conditional:0,home_source_team_id:sourceTeam,home_label:'Us',away_label:'Them',home_score:2,away_score:1,title:'Saved game',venue:'Saved field',evidence:'{}',content_hash:id,observed_at:OLD});
  f.insert('source_event_teams',{source_team_id:sourceTeam,source_event_id:id,side:'home'});
  f.insert('events',{id,created_at:OLD});f.insert('event_source_links',{source_event_id:id,event_id:id,reason:'native',evidence:'{}'});
 }
 f.sqlite.exec("UPDATE team_source_connections SET input_revision=CASE id WHEN 'root' THEN 401 ELSE 346 END,reconciled_revision=CASE id WHEN 'root' THEN 136 ELSE 9 END,last_reconciled_at=CASE id WHEN 'root' THEN '2026-10-13T05:07:00Z' ELSE '2026-10-13T04:58:00Z' END; UPDATE team_projection_state SET input_revision=443,published_input_revision=162,pending=1; DELETE FROM source_tracking_segments WHERE gid='g6';");
}

