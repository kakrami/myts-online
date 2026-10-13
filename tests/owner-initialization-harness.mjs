import {Miniflare} from 'miniflare';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {wrapDatabase} from '../src/application/installation-epoch.js';

export const ROOT=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||path.dirname(fileURLToPath(import.meta.url))+'/..');
export const PASSWORD='native-initialization-owner-password-123';
export const ROTATED_PASSWORD='different-current-owner-password-456';

export function ownerRecord(password=PASSWORD,{revision=1}={}){
  const salt=randomBytes(16).toString('base64url'),now=Date.now();
  return {salt,hash:pbkdf2Sync(password,Buffer.from(salt,'base64url'),600000,32,'sha256').toString('base64url'),iterations:600000,revision,change:randomUUID(),created:now,updated:now};
}


export async function ownerHarness(){
  const modules={},files=['worker.js','web/app/coach-tactics.js','web/app/schedule-query.js',...(await readdir(path.join(ROOT,'src'),{recursive:true})).filter(f=>f.endsWith('.js')).map(f=>'src/'+f)];
  for(const file of files)modules[file]={type:'esm',contents:await readFile(path.join(ROOT,file),'utf8')};
  const signature='export async function passwordVerifier(password, salt, iterations) {';
  if(!modules['src/security/crypto.js'].contents.includes(signature))throw new Error('Password verifier test instrument could not be installed.');
  modules['src/security/crypto.js'].contents=modules['src/security/crypto.js'].contents.replace(signature,signature+`if(globalThis.__ownerTest?.fault==='prehash')throw new Error('forbidden-private-value:'+password);`);
  // All instrumentation exists only in this generated test Worker. Actual
  // application routes and SecurityStore handle authentication and commits.
  modules['owner-test-worker.js']={type:'esm',contents:`
    import application,{SyncRuntime} from './worker.js';export {SyncRuntime};
    import {wrapDatabase} from './src/application/installation-epoch.js';
    import {FreshInstallation} from './src/application/fresh-install.js';
    import {SCHEMA,SEED} from './src/application/installation-schema.js';
    import {SecurityStore,requestSession} from './src/security/index.js';
    const nativeDerive=crypto.subtle.deriveBits.bind(crypto.subtle);
    let deriveCalls=0,pbkdfCalls=0,logs=[],ownerBatches=[],ownerPermitCounts=[];
    crypto.subtle.deriveBits=async(algorithm,...args)=>{
      deriveCalls++;
      if(algorithm?.name==='PBKDF2')pbkdfCalls++;
      if(algorithm?.name==='PBKDF2'&&algorithm.iterations>100000)throw new DOMException('Pbkdf2 failed: iteration counts above 100000 are not supported','NotSupportedError');
      return nativeDerive(algorithm,...args);
    };
    console.error=(...args)=>{logs.push(args);};
    const wrap=(statement,sql)=>({native:statement,sql,bind(...args){return wrap(statement.bind(...args),sql);},all(...args){return statement.all(...args);},first(...args){return statement.first(...args);},run(...args){return statement.run(...args);}});
    export default {async fetch(request,env,ctx){
      const path=new URL(request.url).pathname;
      if(path==='/__prepare-schema'){
        const phase=await new FreshInstallation(env.DB,{schema:SCHEMA,seed:SEED,bootstrapPassword:env.ADMIN_KEY}).advance(env.ADMIN_KEY);
        return Response.json({...phase,schemaLength:SCHEMA.length,tableCount:new Set(SCHEMA.filter(sql=>/^CREATE TABLE/i.test(sql)).map(sql=>sql.match(/^CREATE TABLE (?:IF NOT EXISTS )?(\\w+)/i)[1])).size+1});
      }
      if(path==='/__diagnostics')return Response.json({deriveCalls,pbkdfCalls,logs,ownerBatches,ownerPermitCounts});
      if(path==='/__cap-probe'){
        const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('synthetic-probe'),'PBKDF2',false,['deriveBits']);
        try{await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array(16),iterations:600000},key,256);return Response.json({rejected:false});}
        catch(error){return Response.json({rejected:true,error_class:error.name});}
      }
      if(path==='/__credential'){
        const security=new SecurityStore(wrapDatabase(env.DB));await security.requireOwnerSession(requestSession(request));
        if(request.method==='POST'){const body=await request.json();await security.storeAccountCredential('credential-account',body.credential,{generation:1});return Response.json({stored:true});}
        return Response.json(await security.loadAccountCredential('credential-account',{generation:1}));
      }
      const fault=request.headers.get('x-test-fault')||'',winner=request.headers.get('x-test-winner');
      globalThis.__ownerTest={fault};
      const raw=env.DB,db={
        prepare(sql){return wrap(raw.prepare(sql),sql);},
        async batch(statements){
          const ownerBatch=statements.some(s=>/INSERT\\s+INTO\\s+security_owner/i.test(s.sql||''));
          if(ownerBatch){const names=statements.map(s=>s.sql.match(/(?:INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|UPDATE)\\s+(\\w+)/i)?.[1]||'other');ownerBatches.push(names.filter(name=>name!=='installation_upgrade'));ownerPermitCounts.push(names.filter(name=>name==='installation_upgrade').length);}
          if(ownerBatch&&winner){
            const row=JSON.parse(winner);
            const winningWriter=wrapDatabase(raw);await winningWriter.batch([
              winningWriter.prepare('INSERT INTO security_installation VALUES(1,?,?,?) ON CONFLICT DO NOTHING').bind(row.vaultId,row.vaultKey,row.created),
              winningWriter.prepare('INSERT INTO security_owner VALUES(1,?,?,?,?,?,?,?)').bind(row.salt,row.hash,row.iterations,row.revision,row.change,row.created,row.updated),
            ]);
          }
          const native=statements.map(s=>s.native||s);
          if(ownerBatch&&/^batch_[012]$/.test(fault))native[statements.findIndex(s=>s.sql.match(/INSERT\\s+INTO\\s+(\\w+)/i)?.[1]===['security_installation','security_owner','security_sessions'][Number(fault.at(-1))])]=raw.prepare("INSERT INTO security_installation VALUES(2,'invalid','invalid',0)");
          const result=await raw.batch(native);
          if(ownerBatch&&fault==='post_commit')throw new Error('forbidden-private-value:response acknowledgement lost');
          return result;
        }
      };
      const response=await application.fetch(request,{...env,DB:db},ctx);
      if(fault==='lost_response'&&response.status===200)return Response.json({error:{code:'simulated_response_loss'}},{status:503});
      return response;
    }};
  `};
  const previousDispatcher=getGlobalDispatcher(),dispatcher=new Agent({pipelining:0});setGlobalDispatcher(dispatcher);
  let mf;
  const dispose=async()=>{try{if(mf)await mf.dispose();}finally{setGlobalDispatcher(previousDispatcher);await dispatcher.close();}};
  try{
  mf=new Miniflare({cf:false,telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'owner-initialization-test',compatibilityDate:'2026-09-09',manifest:{mainModule:'owner-test-worker.js',modulesRoot:ROOT,modules},env:{ADMIN_KEY:{type:'text',value:PASSWORD},DB:{type:'d1',id:'owner-initialization-test'},SYNC:{type:'durable-object',worker:'owner-initialization-test',exportName:'SyncRuntime'},ASSETS:{type:'assets'}},exports:{SyncRuntime:{type:'durable-object',storage:'sqlite'}},assets:{directory:path.join(ROOT,'web'),hasUserWorker:true,runWorkerFirst:true}}}]});
  await mf.ready;const rawDb=await mf.getD1Database('DB','owner-initialization-test'),db=wrapDatabase(rawDb);let cookie='';
  async function request(route,{method='GET',body,headers={},signed=true}={}){
    const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{...(body?{'Content-Type':'application/json',Origin:'http://localhost'}:{}),...(signed&&cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json(),set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,data,cookie:set?.split(';')[0]||null};
  }
  let phase;do{const response=await request('/__prepare-schema',{method:'POST',body:{}});if(response.status!==200)throw new Error(JSON.stringify(response.data));phase=response.data;}while(phase.continue);
  async function counts(){return db.prepare('SELECT (SELECT COUNT(*) FROM security_owner) owner,(SELECT COUNT(*) FROM security_installation) vault,(SELECT COUNT(*) FROM security_sessions) sessions').first();}
  async function snapshot(){return {setup:await db.prepare('SELECT * FROM setup_state WHERE id=1').first(),domain:await db.prepare('SELECT * FROM domain_installation WHERE id=1').first(),objects:(await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()).results};}
  async function credentials(){return {owner:await db.prepare('SELECT * FROM security_owner WHERE id=1').first(),vault:await db.prepare('SELECT * FROM security_installation WHERE id=1').first()};}
  async function seedVault(){const row={vaultId:randomUUID(),vaultKey:randomBytes(32).toString('base64url'),created:Date.now()};await db.prepare('INSERT INTO security_installation VALUES(1,?,?,?)').bind(row.vaultId,row.vaultKey,row.created).run();return row;}
  async function seedOwner(password=PASSWORD,{revision=1}={}){const vault=await seedVault(),row=ownerRecord(password,{revision});await db.prepare('INSERT INTO security_owner VALUES(1,?,?,?,?,?,?,?)').bind(row.salt,row.hash,row.iterations,row.revision,row.change,row.created,row.updated).run();return {...row,...vault};}
  const initialize=(password=PASSWORD,options={})=>request('/api/owner/initialize',{method:'POST',body:{password},...options});
  return {mf,db,schemaLength:phase.schemaLength,tableCount:phase.tableCount,request,initialize,counts,snapshot,credentials,seedVault,seedOwner,diagnostics:()=>request('/__diagnostics'),dispose};
  }catch(error){await dispose();throw error;}
}
