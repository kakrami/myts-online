import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../../src/domain/schema.js';
import {DomainRepository} from '../../src/domain/repository.js';
import {SourceTransport} from '../../src/sources/http.js';
import {collectTrace} from '../../src/sources/trace.js';

// Synthetic provider responses using the original queried native fields.
// These exercise production collectors and persistence; they are not live receipts.
export function traceNativeGame({format=7,anonymousKeeper=false}={}) {
  const team_members=['home','away'].flatMap((side,s)=>Array.from({length:format},(_,i)=>({
    gid:side+'-'+(i===0?'goalkeeper':String(i+1)),side,team_id:s?401:400,is_player:true,
    user_id:1000+s*100+i,jersey_number:String(i+1),position:i===0?'GK':'MID',
    user:{user_id:1000+s*100+i,first_name:'Player',last_name:String(s*100+i),is_dummy:anonymousKeeper&&i===0},
  })));
  return {game_id:4001,full_date:'2026-09-01T17:00:00Z',home_team:{team_id:400,title:'Us'},away_team:{team_id:401,title:'Them'},team_members,
    moments:[1,2].map(half=>({game_id:4001,type:'FullGameVideo',half,game_clip_id:40010+half,start_time:1_700_000_000_000+half*2_000_000,duration:120,dynamic_jfile:`https://go.traceup.com/test-assets/radar${half}.json`,camera:{name:'tracecam',type:'Trace'}}))};
}
export function traceRadar(game,{trim=false,numeric=false}={}) {
  const ids=game.team_members.map(m=>m.gid);
  return {setup:{field:{coordinates:{}}},frm:Array.from({length:121},(_,i)=>({t:i*100,a:Object.fromEntries(ids.slice(0,trim&&(i<20||i>100)?2:ids.length).map((gid,n)=>[numeric?String(n):gid,{}]))}))};
}
export function traceProvider(game,radar=traceRadar(game)) {
  const calls=[];
  const transport=new SourceTransport({}, {maxCalls:10000,deadlineMs:60000,fetch:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/users/self/token'))return Response.json({data:{user_id:1,token:'synthetic-token',timestamp:1}});
    if(url.includes('/test-assets/radar'))return Response.json(radar);
    const request=JSON.parse(options.body);
    if(request.operationName==='game')return Response.json({data:{game}});
    if(request.operationName==='getHaloData'){
      const s=request.variables.segments[0];return Response.json({data:{halo:{ring:[[s.local_start,'L'],[s.local_start+s.duration,'L']]}}});
    }
    throw Error('Unexpected synthetic provider operation '+request.operationName);
  }});
  const account={provider:'trace',id:'account',native_id:'1'},credential='PHPSESSID=synthetic';
  const collect=(kind,args,cursor={})=>collectTrace({j:{kind,scan_id:'scan'},args,cursor,transport,account,credential});
  return {collect,calls,transport,account};
}
export async function gamePages(provider,{teamId='400'}={}) {
  const pages=[];let cursor={};
  for(let i=0;i<50;i++){
    const page=await provider.collect('game',{team_id:teamId,game_id:'4001',profile_hash:'synthetic-profile'},cursor);pages.push(page);
    if(page.complete)return pages;cursor=page.checkpoint;
  }
  throw Error('Game collection never completed');
}
export function traceStorage() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');for(const sql of DOMAIN_SCHEMA)sqlite.exec(sql);
  sqlite.exec("INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,1,'test');INSERT INTO provider_accounts(id,provider,native_id,name) VALUES('account','trace','1','Test');");
  const statement=(sql,params=[])=>({sql,params,bind(...values){return statement(sql,values);},async first(){return sqlite.prepare(sql).get(...params)||null;},async all(){return {results:sqlite.prepare(sql).all(...params).map(v=>({...v}))};},async run(){const result=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(result.changes)}};}});
  const db={prepare:sql=>statement(sql),async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const repo=new DomainRepository(db),save=page=>repo.ingestSourcePage({accountId:'account',generation:1,provenance:'provider',records:page.records,fixtures:page.fixtures,sourceCoverage:page.coverage,replacements:page.replacements,scanId:'scan'});
  const all=sql=>sqlite.prepare(sql).all().map(v=>({...v}));return {sqlite,db,repo,save,all,close:()=>sqlite.close()};
}
