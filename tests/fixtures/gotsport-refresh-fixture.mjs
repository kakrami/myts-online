import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {DOMAIN_SCHEMA} from '../../src/domain/schema.js';
import {DomainRepository} from '../../src/domain/repository.js';
import {collectSource} from '../../src/sources/index.js';
import mockProvider from '../mock-provider.js';

export function refreshDatabase(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const sql of DOMAIN_SCHEMA)sqlite.exec(sql);
 const prepare=(sql,params=[])=>({sql,params,bind(...values){return prepare(sql,values);},async all(){const results=sqlite.prepare(sql).all(...params).map(r=>({...r}));return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n}};},async first(){return (await this.all()).results[0]??null;},async run(){return this.all();}});
 const db={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 sqlite.exec("INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,1,'2026-10-13T00:00:00Z'); INSERT INTO app_teams(id,name,timezone,season_year,created_at) VALUES('team','Team','UTC',2026,'2026-10-13T00:00:00Z'); INSERT INTO team_read_state(app_team_id) VALUES('team');");
 return {sqlite,db,close:()=>sqlite.close()};
}
export function refreshScenario(db,{rootId='gotsport-refresh-root',teamId='team'}={}){
 const values=new Map(),env={COUNTERS:{async get(key,type){const value=values.get(key);return type==='json'&&value?JSON.parse(value):value;},async put(key,value){values.set(key,value);}}};
 const repo=new DomainRepository(db),snapshots=[];let scan=0;
 const one=async(sql,...params)=>db.prepare(sql).bind(...params).first(),rows=async(sql,...params)=>(await db.prepare(sql).bind(...params).all()).results;
 const root=()=>one('SELECT * FROM team_source_connections WHERE id=?',rootId);
 const transportFor=mutate=>({observations:[],async get(url){const response=await mockProvider.fetch(new Request(url),env);let value=await response.json();if(mutate)value=mutate(value,new URL(url));const raw=JSON.stringify(value),observation={endpoint:new URL(url).origin+new URL(url).pathname,params:Object.fromEntries(new URL(url).searchParams),status:response.status,at:new Date().toISOString(),retrieved_at:new Date().toISOString(),hash:createHash('sha256').update(raw).digest('hex'),bytes:Buffer.byteLength(raw)};this.observations.push(observation);return {value,observation};}});
 async function collect({provider='gotsport',component,scope,args={},cursor={},scanId='refresh-'+ ++scan,mutate}={}){
  const page=await collectSource({provider,kind:component,scope,args,cursor,transport:transportFor(mutate),scanId});
  return {...page,provider,component,resourceKey:scope,scanId};
 }
 async function save(page){
  const before=await root(),previous=await rows("SELECT id,division_key,evidence,content_hash FROM source_events WHERE provider='gotsport' ORDER BY id"),built=await repo.ingestSourcePage(page),after=await root();
  const result={component:page.component,complete:page.complete,changed:built.changed,rootDelta:(after?.input_revision||0)-(before?.input_revision||0),observations:page.observations,statements:built.statements.map(s=>s.sql),previous};snapshots.push(result);return {...result,page,built};
 }
 async function run(spec){return save(await collect(spec));}
 const profile=()=>run({component:'profile',scope:'212707',args:{team_id:'212707'}});
 const history=(extra={})=>run({component:'history',scope:'212707',args:{team_id:'212707'},...extra});
 async function initialize(){
  await profile();await db.prepare("INSERT INTO team_source_connections(id,app_team_id,source_team_id,scope_mode,created_at) VALUES(?,?,'gotsport/public/212707','observed_history',?)").bind(rootId,teamId,new Date().toISOString()).run();
  const first=await history(),event=first.page.children.find(c=>c.component==='event'),detail=await run({component:'event',scope:event.scope,args:event.args}),division=detail.page.children.find(c=>c.component==='division'),standings=detail.page.children.find(c=>c.component==='standings');
  return {event,division,standings};
 }
 return {repo,one,rows,root,collect,save,run,profile,history,initialize,snapshots,transportFor};
}
export const jobSpec=(job,extra={})=>({component:job.component,scope:job.scope,args:job.args,...extra});
export function publicRows(count,{ownedCount=1}={}){return (value,url)=>{
 if(url.pathname.endsWith('/flight_matches'))return Array.from({length:count},(_,i)=>({...value[0],id:1001+i,match_number:1001+i,homeTeam:i<ownedCount?value[0].homeTeam:{team_id:500000+i,full_name:'Other Team '+i},awayTeam:i===0?value[0].awayTeam:{team_id:600000+i,full_name:'Opponent '+i}}));
 if(url.pathname.endsWith('/flight_registrations'))return Array.from({length:count},(_,i)=>({...value[0],id:7000+i,team_id:i===0?212707:500000+i,full_name:i===0?value[0].full_name:'Other Team '+i}));
 return value;
};}
