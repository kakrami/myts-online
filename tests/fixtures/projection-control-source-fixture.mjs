import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../../src/domain/schema.js';
import {SYNC_SCHEMA} from '../../src/sync/schema.js';
import {beginTeamSnapRefresh,finishTeamSnapRefresh} from '../../src/sources/teamsnap-refresh.js';
import {loadTeamGameCandidates,teamGameInstant} from '../../src/domain/team-game-candidates.js';
const NOW=Date.parse('2026-10-13T00:00:00Z'),AT=new Date(NOW).toISOString(),KICK='2026-10-12T18:00:00.000Z';
const TS='teamsnap/account/101',GS='gotsport/public/201',LV='live/public/301';
export async function fixture({legacy=false,publicProvider='gotsport'}={}) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const sql of [...DOMAIN_SCHEMA,...SYNC_SCHEMA])sqlite.exec(sql);
  const reads=[],prepare=(sql,params=[])=>({bind(...p){return prepare(sql,p);},async all(){const results=sqlite.prepare(sql).all(...params).map(r=>({...r}));reads.push({sql,params,rows:results.length,bytes:Buffer.byteLength(JSON.stringify(results))});return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n}};},async first(){return (await this.all()).results[0]??null;},async run(){return sqlite.prepare(sql).run(...params);}}),db={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const insert=(table,row)=>sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
  insert('domain_installation',{id:1,schema_version:1,created_at:AT});
  insert('provider_accounts',{id:'account',provider:'teamsnap',native_id:'11',name:'Owner'});
  insert('app_teams',{id:'team',name:'Us',timezone:'America/Los_Angeles',season_year:2026,created_at:AT});
  insert('team_seasons',{id:'season',app_team_id:'team',year:2026,start_day:'2026-06-01',end_day:'2027-06-01',start_at:'2026-06-01T07:00:00Z',end_at:'2027-06-01T07:00:00Z'});
  insert('team_projection_state',{team_season_id:'season',app_team_id:'team'});insert('team_read_state',{app_team_id:'team'});
  function source(id,provider,account=null){insert('source_teams',{id,provider,scope:account??'public',account_id:account,native_id:id.split('/').at(-1),name:'Team',name_authority:1,archived:0,evidence:'{}',provenance:'provider',content_hash:id,observed_at:AT});}
  source(TS,'teamsnap','account');source(GS,'gotsport');source(LV,'live');source('gotsport/public/202','gotsport');source('live/public/302','live');
  function connect(id,sourceId,account=null,{typed=!legacy}={}){insert('team_source_attachments',{id:'attachment-'+id,app_team_id:'team',team_season_id:'season',source_team_id:sourceId,account_id:account});if(typed){insert('team_source_connections',{id,app_team_id:'team',source_team_id:sourceId,account_id:account,scope_mode:'fixed_seasons',created_at:AT});insert('team_connection_seasons',{connection_id:id,team_season_id:'season',attachment_id:'attachment-'+id,basis:'fixed'});}}
  connect('ts',TS,'account');connect('pub',publicProvider==='live'?LV:GS);
  function event(id,{provider='teamsnap',start=KICK,own=provider==='teamsnap'?TS:provider==='gotsport'?GS:LV,account=provider==='teamsnap'?'account':null,canonical='canonical-'+id,opponent='Fresno Heat FC U11 Central',venue='Kellogg Zaher Sports Complex',evidence={},extra={}}={}) {
    const home=own,away=provider==='gotsport'?'gotsport/public/202':provider==='live'?'live/public/302':null;
    insert('source_events',{id,provider,scope:account??'public',account_id:account,native_id:id,starts_at:start,time_precision:start?'instant':'pending',type:'game',status:'SCHEDULED',conditional:0,home_source_team_id:home,away_source_team_id:away,home_label:'Us',away_label:opponent,title:'Game',venue,evidence:JSON.stringify({orientation_verified:true,opponent_id:'41',home_real:true,away_real:true,...evidence}),provenance:'provider',content_hash:'hash-'+id,observed_at:AT,...extra});
    insert('source_event_teams',{source_team_id:home,source_event_id:id,side:'home'});if(away)insert('source_event_teams',{source_team_id:away,source_event_id:id,side:'away'});
    if(canonical){if(!sqlite.prepare('SELECT 1 FROM events WHERE id=?').get(canonical))insert('events',{id:canonical,created_at:AT});insert('event_source_links',{source_event_id:id,event_id:canonical,reason:'source_identity',evidence:'{}'});}return canonical;
  }
  async function complete({recent=false}={}) {
    sqlite.exec('DELETE FROM sync_job_subscribers;DELETE FROM sync_jobs;DELETE FROM source_component_coverage');
    const n=sqlite.prepare("SELECT count(*) n FROM source_events WHERE provider='teamsnap' AND account_id='account'").get().n;
    for(const [root,provider,own] of [['ts','teamsnap',TS],['pub',publicProvider,publicProvider==='live'?LV:GS]]){
      const native=own.split('/').at(-1),account=provider==='teamsnap'?'account':null,args={team_id:native},components=provider==='teamsnap'?['events']:provider==='gotsport'?['profile','catalog','history']:['upcoming','membership'];
      for(const component of components){const id=provider+'-'+component,scope=provider==='teamsnap'?'teamsnap:'+native:native;let checkpoint={finished:true};
        if(provider==='teamsnap'){let refresh=(await beginTeamSnapRefresh({kind:'events',teamId:native,accountId:'account',authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/events/search',args,now:NOW-3600000})).refresh;checkpoint=finishTeamSnapRefresh(refresh,{count:n,pages:1,digest:'a'.repeat(64),total:n,now:NOW-3500000});if(recent){refresh=(await beginTeamSnapRefresh({kind:'events',teamId:native,accountId:'account',authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/events/search',args,cursor:checkpoint,now:NOW-1000})).refresh;checkpoint=finishTeamSnapRefresh(refresh,{count:n,pages:1,digest:'b'.repeat(64),total:n,now:NOW});}}
        insert('sync_jobs',{id,provider,account_scope:account??'public',account_id:account,authorization_generation:account?1:0,component,scope,resource_key:scope,args:JSON.stringify(args),checkpoint:JSON.stringify(checkpoint),scan_id:'scan-'+id,state:'ready',coverage:provider==='teamsnap'&&recent?'partial':'complete',ready_since:NOW,next_at:NOW+3600000,interval_ms:3600000,last_complete_at:NOW});
        insert('sync_job_subscribers',{job_id:id,kind:'team',demand_key:legacy?'attachment-'+root:'connection:'+root,app_team_id:'team',generation:1});
        insert('source_component_coverage',{id:'coverage-'+id,provider,scope,account_id:account,kind:component,complete:1,record_count:provider==='teamsnap'?n:0,scan_id:'older-semantic-equivalent-scan',observed_at:AT});
      }
    }
  }
  function bridge(){const endpoint=p=>'https://gotsportlive-api.azurewebsites.net/api/clubapi/'+p;const evidence={team_id:'201',live_team_id:'301',external_key:'201',external_source_name:'GotSport',external_source_id:6,default_season:true,item_id:'301',club:'51',season:'61',season_name:'2026',verified_at:AT,expires_at:new Date(NOW+3600000).toISOString(),observations:[{endpoint:endpoint('initclubteams'),params:{ClubID:'51'},status:200,hash:'a'.repeat(64),at:AT},{endpoint:endpoint('getteams'),params:{ClubID:'51',SeasonID:'61'},status:200,hash:'b'.repeat(64),at:AT}]};insert('source_team_links',{a:GS,b:LV,kind:'provider_external_key',evidence:JSON.stringify(evidence)});}
  const load=(options={})=>loadTeamGameCandidates(db,{teamId:'team',seasonId:'season',canonicalEventIds:['canonical-ts'],now:NOW,...options});
  return {sqlite,db,reads,insert,source,connect,event,complete,bridge,load,close:()=>sqlite.close()};
}

