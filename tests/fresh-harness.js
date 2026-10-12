import {Miniflare} from 'miniflare';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {SCHEMA} from '../src/application/installation-schema.js';
export const TEST_PASSWORD='native-review-owner-password-123';
export async function freshHarness(){
  const qaRoot=path.resolve('.'),root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||qaRoot),files=['worker.js','web/app/coach-tactics.js',...(await readdir(path.join(root,'src'),{recursive:true})).filter(f=>f.endsWith('.js')).map(f=>'src/'+f)],modules={};
  for(const file of files)modules[file]={type:'esm',contents:await readFile(path.join(root,file),'utf8')};
  const mockProvider=await readFile(path.join(qaRoot,'tests/mock-provider.js'),'utf8');
  const previousDispatcher=getGlobalDispatcher(),dispatcher=new Agent({pipelining:0});setGlobalDispatcher(dispatcher);
  let mf;
  const dispose=async()=>{try{if(mf)await mf.dispose();}finally{setGlobalDispatcher(previousDispatcher);await dispatcher.close();}};
  try{
  mf=new Miniflare({cf:false,telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'fresh-review',compatibilityDate:'2026-09-09',manifest:{mainModule:'worker.js',modulesRoot:root,modules},env:{ADMIN_KEY:{type:'text',value:TEST_PASSWORD},DB:{type:'d1',id:'fresh-review'},SYNC:{type:'durable-object',worker:'fresh-review',exportName:'SyncRuntime'},ASSETS:{type:'assets'},PROVIDER_FETCH:{type:'worker',worker:'provider'}},exports:{SyncRuntime:{type:'durable-object',storage:'sqlite'}},assets:{directory:path.join(root,'web'),hasUserWorker:true,runWorkerFirst:true}}},{config:{name:'provider',compatibilityDate:'2026-09-09',manifest:{mainModule:'tests/mock-provider.js',modulesRoot:qaRoot,modules:{'tests/mock-provider.js':{type:'esm',contents:mockProvider}}},env:{COUNTERS:{type:'kv',id:'fresh-provider'}},exports:{}}}]});
  await mf.ready;let cookie='',installed=false;
  async function request(route,{method='GET',body,headers={},signed=true,binary=false}={}){
    const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{...(body?{'Content-Type':'application/json','Origin':'http://localhost'}:{}),...(signed&&cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    let data;if(binary)data=new Uint8Array(await response.arrayBuffer());else{const raw=await response.text();try{data=JSON.parse(raw);}catch{data=raw;}}
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,data,headers:response.headers};
  }
  async function initialize(){let result,steps=0;do{result=await request('/api/owner/initialize',{method:'POST',body:{password:TEST_PASSWORD}});if(![200,202].includes(result.status))throw new Error(JSON.stringify(result.data));if(++steps>Math.ceil(SCHEMA.length/30)+2)throw new Error('Fresh initialization did not finish.');}while(result.data.continue);installed=true;return result;}
  async function waitFor(check,{timeout=45000}={}){const deadline=Date.now()+timeout;while(Date.now()<deadline){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Fresh background workflow did not finish.');}
  const rawDb=await mf.getD1Database('DB','fresh-review'),applicationDb=wrapDatabase(rawDb);
  return {mf,rawDb,get db(){return installed?applicationDb:rawDb;},request,initialize,waitFor,dispose};
  }catch(error){await dispose();throw error;}
}
