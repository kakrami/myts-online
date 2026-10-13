import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../../src/domain/schema.js';
import {SECURITY_SCHEMA} from '../../src/security/schema.js';
import {ANALYSIS_SCHEMA} from '../../src/analysis/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../../src/application/team-features.js';
import {AWARDS_SCHEMA} from '../../src/read-model/feature-schema.js';
import {FeatureReads} from '../../src/read-model/feature-reads.js';
import {CursorCodec} from '../../src/read-model/cursor.js';
export const AT='2026-10-12T12:00:00.000Z',INPUT={team_id:'team',team_season_id:'season'},HOME='gotsport/public/1',AWAY='gotsport/public/2';
export function fixture({zone='UTC',at=AT,june=0}={}) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');
  for(const sql of [...DOMAIN_SCHEMA,...SECURITY_SCHEMA,...ANALYSIS_SCHEMA,...TEAM_FEATURE_SCHEMA,...AWARDS_SCHEMA])sqlite.exec(sql);
  const insert=(table,row)=>sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  let now=Date.parse(at),queryCount=0;
  const statement=(sql,params=[])=>({sql,params,bind(...values){return statement(sql,values);},async first(){queryCount++;const row=sqlite.prepare(sql).get(...params);return row?{...row}:null;},async all(){queryCount++;return {results:sqlite.prepare(sql).all(...params).map(row=>({...row}))};}});
  const db={prepare:statement,async batch(statements){sqlite.exec('BEGIN');try{const results=await Promise.all(statements.map(s=>s.all()));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  insert('domain_installation',{id:1,schema_version:1,created_at:AT});
  insert('app_teams',{id:'team',name:'Us',timezone:zone,season_year:2026,created_at:AT});insert('team_read_state',{app_team_id:'team',content_revision:1,status_revision:1});
  for(const [id,year] of [['season',2026],['history',2025]]) {
    insert('team_seasons',{id,app_team_id:'team',year,start_day:`${year}-06-01`,end_day:`${year+1}-06-01`,start_at:`${year}-06-01T00:00:00Z`,end_at:`${year+1}-06-01T00:00:00Z`,include_june:june});
    insert('team_projection_runs',{id:'run-'+id,app_team_id:'team',team_season_id:id,input_revision:1,state:'published',created_at:AT});
    insert('team_projection_state',{team_season_id:id,app_team_id:'team',published_run_id:'run-'+id,pending:0});
  }
  insert('app_clubs',{id:'club',name:'Club'});insert('team_profiles',{app_team_id:'team',club_id:'club',kind:'own'});
  function team(id){const [provider,,native_id]=id.split('/');insert('source_teams',{id,provider,scope:'public',native_id,name:id===HOME?'Us':id===AWAY?'Them':id,name_authority:1,archived:0,evidence:'{}',content_hash:'team',observed_at:AT});}
  for(const id of [HOME,AWAY,'gotsport/public/3','live/public/1','live/public/2'])team(id);
  insert('team_source_attachments',{id:'attached',app_team_id:'team',team_season_id:'season',source_team_id:HOME});
  function event(id,{day='2026-09-01',starts=null,status='FINAL',conditional=0,type='game',home=HOME,away=AWAY,hs=2,as=1,alias=null,project=false,season='season',effective={}}={}) {
    const canonical=alias||id,source=`${home.split('/')[0]}/public/event-${id}`;
    if(!alias)insert('events',{id:canonical,created_at:AT});
    insert('source_events',{id:source,provider:home.split('/')[0],scope:'public',native_id:id,starts_at:starts,local_day:day,time_precision:starts?'instant':day?'day':'pending',type,status,conditional,home_source_team_id:home,away_source_team_id:away,home_label:'Home',away_label:'Away',home_score:hs,away_score:as,title:id,venue:'Field',evidence:'{}',content_hash:'event',observed_at:AT});
    insert('event_source_links',{source_event_id:source,event_id:canonical,reason:'native',evidence:'{}',revision:1});insert('source_event_state',{source_event_id:source,input_revision:1});
    if(project)insert('team_event_rows',{run_id:'run-'+season,app_team_id:'team',team_season_id:season,event_id:canonical,starts_at:starts,local_day:day,type,status,conditional,own_side:home===HOME?'home':'away',home_name:'Home',away_name:'Away',home_score:hs,away_score:as,title:id,venue:'Field',source_ids:JSON.stringify([source]),schedule_source_id:source,result_source_id:source,...effective});
    return {id:canonical,source};
  }
  const cursor=new CursorCodec(new Uint8Array(32).fill(6),{now:()=>now}),options={cursor,now:()=>now},reads=new FeatureReads(db,{owner:true},options),current={id:'current',home_id:HOME,away_id:AWAY,own_side:'home'};
  return {sqlite,db,insert,event,reads,current,options,setNow:value=>{now=Date.parse(value);},async h2h(options={}){return reads.headToHead(await reads.featureContext(INPUT),current,options);},queries:()=>queryCount,close:()=>sqlite.close()};
}

