import assert from 'node:assert/strict';
import {fixture} from './projection-control-source-fixture.mjs';
export const JOB_FIELDS=['id','provider','account_scope','account_id','authorization_generation','component','stage','scope','resource_key','args','checkpoint','scan_id','generation','state','coverage','last_complete_at','last_saved_at'];
export const bytes=v=>Buffer.byteLength(typeof v==='string'?v:JSON.stringify(v));
export async function projectionControlScaleFixture(){
 const f=await fixture(),ids=[];
 for(let i=0;i<100;i++){
  const start=new Date(Date.parse('2026-09-01T18:00:00Z')+i*86400000).toISOString();
  for(const [prefix,provider] of i<10?[['a-public-','gotsport'],['z-private-','teamsnap']]:[['z-private-','teamsnap']]){
   const id=f.event(prefix+String(i).padStart(3,'0'),{provider,start,extra:provider==='gotsport'?{status:'FINAL',home_score:2,away_score:1}:{}});ids.push(id);
   f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:id,team_season_id:'season',state:'resolved',effective_day:start.slice(0,10),starts_at:start,local_day:start.slice(0,10),basis:'native',evidence:'{}'});
  }
 }
 await f.complete();f.connect('live-root','live/public/301');
 const template={...f.sqlite.prepare("SELECT * FROM sync_jobs WHERE id='gotsport-history'").get()};
 for(let i=0;i<52;i++){
  const id='gotsport-division-'+String(i).padStart(3,'0');f.insert('sync_jobs',{...template,id,component:'division',scope:'division-'+i,resource_key:'division-'+i,args:JSON.stringify({team_id:'201',division_id:String(i)}),scan_id:'scan-'+id});
  f.insert('sync_job_subscribers',{job_id:id,kind:'team',demand_key:'connection:pub',app_team_id:'team',generation:1});
 }
 for(let i=0;i<44;i++){
  const component=i===0?'upcoming':i===1?'membership':'fixture',id='live-'+component+'-'+i,scope=i<2?'301':'fixture-'+i;
  f.insert('sync_jobs',{...template,id,provider:'live',component,scope,resource_key:scope,args:JSON.stringify({team_id:'301',...(i<2?{}:{fixture_id:String(i)})}),scan_id:'scan-'+id});
  f.insert('sync_job_subscribers',{job_id:id,kind:'team',demand_key:'connection:live-root',app_team_id:'team',generation:1});
  if(i<2)f.insert('source_component_coverage',{id:'coverage-'+id,provider:'live',scope,kind:component,complete:1,record_count:0,scan_id:'complete-'+id,observed_at:'2026-10-13T00:00:00.000Z'});
 }
 const jobs=()=>f.sqlite.prepare(`SELECT ${JOB_FIELDS} FROM sync_jobs ORDER BY id`).all().map(r=>({...r}));
 for(const [field,target]of [['args',22763],['checkpoint',3196]]){
  const rows=jobs(),extra=rows.filter(j=>j.component==='division'),remain=target-rows.reduce((n,j)=>n+bytes(j[field]),0);assert.ok(remain>=0,field+' already exceeds target');
  for(const [i,j]of extra.entries())f.sqlite.prepare(`UPDATE sync_jobs SET ${field}=? WHERE id=?`).run(j[field]+' '.repeat(Math.floor(remain/extra.length)+(i<remain%extra.length?1:0)),j.id);
 }
 const remaining=71789-bytes(jobs()),extra=jobs().filter(j=>j.component==='division');assert.ok(remaining>=0);
 for(const [i,j]of extra.entries())f.sqlite.prepare('UPDATE sync_jobs SET scan_id=? WHERE id=?').run(j.scan_id+'x'.repeat(Math.floor(remaining/extra.length)+(i<remaining%extra.length?1:0)),j.id);
 const volumes={jobs:bytes(jobs()),args:jobs().reduce((n,j)=>n+bytes(j.args),0),checkpoints:jobs().reduce((n,j)=>n+bytes(j.checkpoint),0)};assert.deepEqual(volumes,{jobs:71789,args:22763,checkpoints:3196});
 assert.deepEqual(f.sqlite.prepare('SELECT provider,count(*) n FROM sync_jobs GROUP BY provider ORDER BY provider').all().map(r=>({...r})),[{provider:'gotsport',n:55},{provider:'live',n:44},{provider:'teamsnap',n:1}]);
 f.sqlite.exec('UPDATE team_source_connections SET reconciled_revision=input_revision');
 return {...f,ids,volumes,jobs,seedTables:['provider_accounts','app_teams','team_seasons','team_read_state','team_projection_state','source_teams','team_source_attachments','team_source_connections','team_connection_seasons','source_events','source_event_teams','events','event_source_links','team_event_season_resolutions','sync_jobs','sync_job_subscribers','source_component_coverage']};
}
