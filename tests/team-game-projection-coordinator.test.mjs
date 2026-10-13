import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fixture as sourceFixture} from './team-game-candidates.test.mjs';
import {FreshInstallation} from '../src/application/fresh-install.js';
import {SCHEMA,SEED} from '../src/application/installation-schema.js';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {SyncRuntime} from '../worker.js';
import {ApplicationSyncService} from '../src/application/sync-service.js';
const NOW=Date.parse('2026-10-13T00:00:00Z'),PASSWORD='team-game-coordinator-fixture-password';
export async function fullFixture({pairs=24,legacy=false}={}){
 const sources=await sourceFixture({legacy});
 for(let i=0;i<pairs;i++){const day=String(i%28+1).padStart(2,'0'),month=String(9+Math.floor(i/28)).padStart(2,'0'),start=`2026-${month}-${day}T18:00:00.000Z`;for(const [prefix,provider]of [['a-public-','gotsport'],['z-private-','teamsnap']]){const id=sources.event(prefix+String(i).padStart(3,'0'),{provider,start});sources.insert('team_event_season_resolutions',{app_team_id:'team',event_id:id,team_season_id:'season',state:'resolved',effective_day:start.slice(0,10),starts_at:start,local_day:start.slice(0,10),basis:'native',evidence:'{}'});}}
 await sources.complete();
 // Production root recovery includes name/timezone in the profile request.
 // A changed serialized request legitimately invalidates a completed receipt.
 sources.sqlite.prepare("UPDATE sync_jobs SET args=? WHERE provider='gotsport' AND component='profile'").run(JSON.stringify({team_id:'201',team_name:'Team',timezone:'America/Los_Angeles'}));
 const queries=[];const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 const prepare=(sql,params=[])=>({bind(...p){return prepare(sql,p);},async all(){queries.push({sql,params});const before=sqlite.prepare('SELECT total_changes() n').get().n;const results=sqlite.prepare(sql).all(...params).map(row=>({...row}));return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n,rows_written:sqlite.prepare('SELECT total_changes() n').get().n-before}};},async first(){return(await this.all()).results[0]??null;},async run(){return this.all();}});
 const raw={prepare,async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.all());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const fresh=new FreshInstallation(raw,{schema:SCHEMA,seed:SEED,bootstrapPassword:PASSWORD,now:()=>NOW});while((await fresh.inspect()).state!=='ready')await fresh.advance(PASSWORD);
 const db=wrapDatabase(raw),seed=[];
 for(const table of ['provider_accounts','app_teams','team_seasons','team_read_state','team_projection_state','source_teams','team_source_attachments','team_source_connections','team_connection_seasons','source_events','source_event_teams','events','event_source_links','team_event_season_resolutions','sync_jobs','sync_job_subscribers','source_component_coverage'])for(const row of sources.sqlite.prepare(`SELECT * FROM ${table}`).all()){
   const sql=`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`,params=Object.values(row);await db.prepare(sql).bind(...params).run();seed.push({sql,params});
 }
 await db.prepare('UPDATE team_source_connections SET reconciled_revision=input_revision').run();seed.push({sql:'UPDATE team_source_connections SET reconciled_revision=input_revision',params:[]});sources.close();
 const values=new Map();let alarm=NOW;
 const storage={async get(key){return values.get(key);},async put(key,value){values.set(key,structuredClone(value));},async getAlarm(){return alarm;},async setAlarm(at){alarm=at;},async deleteAlarm(){alarm=null;}};
 const runtime=new SyncRuntime({storage},{DB:raw,ADMIN_KEY:PASSWORD});
 const coordinator=new JobCoordinator(db,{clock:()=>NOW});
 for(const root of sqlite.prepare('SELECT * FROM team_source_connections').all()){const id=await coordinator.enqueue({provider:'domain',component:'connection',stage:'projection',scope:'team',resourceKey:root.id,args:{connectionId:root.id,teamId:'team',generation:root.generation,inputRevision:root.input_revision},priority:90,recurring:false},[{kind:'team',key:'connection:'+root.id,teamId:'team',generation:root.generation}]);await db.prepare("UPDATE sync_jobs SET state='ready',coverage='complete',checkpoint='{\"finished\":true}',last_complete_at=? WHERE id=?").bind(NOW,id).run();}
 const jobId=await coordinator.enqueue({provider:'domain',component:'projection',stage:'projection',scope:'team',resourceKey:'season',args:{teamId:'team',seasonId:'season'},priority:100,recurring:false},[{kind:'team',key:'projection:team:season',teamId:'team'}]);
 queries.length=0;return {sqlite,db,raw,seed,queries,runtime,values,jobId,get alarm(){return alarm;},close(){sqlite.close();}};
}
for(const pairs of [24,48])test(`full exact fresh installation and production coordinator publish${pairs} pairs within unchanged50SQL`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:NOW});const f=await fullFixture({pairs});t.after(()=>f.close());const pages=[];
 for(let i=0;i<80;i++){assert.notEqual(f.alarm,null);t.mock.timers.setTime(Math.max(Date.now(),f.alarm));await f.runtime.alarm();const run=f.values.get('last_run');assert.ok(run,JSON.stringify([...f.values]));assert.ok(run.statements<=50,JSON.stringify(run));assert.ok(!['error','retrying','failed','blocked'].includes(run.state),JSON.stringify(run));pages.push(run);if(f.sqlite.prepare('SELECT state FROM sync_jobs WHERE id=?').get(f.jobId).state==='ready')break;assert.ok(i<79);}

 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_events').get().n,pairs);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_game_source_rows').get().n,pairs*2);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_game_publications WHERE disposition='accepted'").get().n,pairs);assert.equal(f.sqlite.prepare('SELECT writer_mode FROM installation_team_games_upgrade').get().writer_mode,null);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);t.diagnostic(JSON.stringify({maxStatements:Math.max(...pages.map(p=>p.statements)),pages:pages.length,projectionPages:pages.filter(p=>p.jobId===f.jobId).map(p=>({state:p.state,statements:p.statements}))}));
});

export async function forceEquivalentProjection(f){
 await f.db.prepare("UPDATE team_projection_state SET input_revision=input_revision+1,pending=1 WHERE team_season_id='season'").run();
 await new ApplicationSyncService(f.db,{}).enqueueProjection('team','season',{wake:false});await f.runtime.wake();
}
export async function finishProjection(f,t){
 const pages=[];for(let i=0;i<100;i++){t.mock.timers.setTime(Math.max(Date.now(),f.alarm));await f.runtime.alarm();const run=f.values.get('last_run');pages.push(run);assert.ok(run.statements<=50,JSON.stringify(run));assert.ok(!['error','retrying','failed','blocked'].includes(run.state),JSON.stringify(run));if(f.sqlite.prepare('SELECT state FROM sync_jobs WHERE id=?').get(f.jobId).state==='ready')return pages;}throw new Error('Projection did not finish');
}
test('actual coordinator replaces equivalent published proof pointers without content churn',async t=>{
 t.mock.timers.enable({apis:['Date'],now:NOW});const f=await fullFixture({pairs:24});t.after(()=>f.close());await finishProjection(f,t);const before=f.sqlite.prepare("SELECT p.published_run_id,p.projection_hash,r.content_revision FROM team_projection_state p JOIN team_read_state r USING(app_team_id)").get();
 await forceEquivalentProjection(f);const pages=await finishProjection(f,t);const after=f.sqlite.prepare("SELECT p.published_run_id,p.projection_hash,r.content_revision FROM team_projection_state p JOIN team_read_state r USING(app_team_id)").get();assert.notEqual(after.published_run_id,before.published_run_id);assert.equal(after.projection_hash,before.projection_hash);assert.equal(after.content_revision,before.content_revision);assert.ok(f.queries.some(q=>q.sql.includes(' EXCEPT ')));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_game_decision_revisions').get().n,24);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);t.diagnostic(JSON.stringify({replacementMaxSQL:Math.max(...pages.map(p=>p.statements)),pages:pages.length}));
});
