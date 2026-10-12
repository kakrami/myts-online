import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const webRoot=path.resolve(fileURLToPath(new URL('../../web/',import.meta.url)));
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui-original/original.css"></head><body><script type="module">import {createApp} from '/app/main.js'; window.ownerApp=createApp(); await window.ownerApp.start(); window.ownerAppStarted=true;</script></body></html>`;

/** A controlled owner protocol fixture; all browser UI modules are production files. */
export async function ownerUIFixture(scenario) {
  const calls=[];
  let ownerReady=false,role='anonymous',initializations=0;
  let releaseFailure;
  const failureGate=new Promise(resolve=>{releaseFailure=resolve;});
  let setupState=scenario==='interrupted'?'initializing':'ready';
  const bootstrap=()=>({version:'owner-ui-fixture',setup:{state:setupState,progress:setupState==='ready'?100:88,owner_ready:ownerReady},session:{role},teams:[],preferences:{theme:'light'}});
  const reply=(res,status,body,raw=false)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(raw?body:JSON.stringify(body));};
  const server=createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname.startsWith('/api/')) {
        let body='';for await(const chunk of req)body+=chunk;
        calls.push({path:pathname,method:req.method,body:body?JSON.parse(body):null});
        if(pathname==='/api/bootstrap')return reply(res,200,bootstrap());
        if(pathname==='/api/owner/initialize') {
          initializations++;
          if(scenario==='interrupted') {
            if(initializations===1)return reply(res,202,{continue:true,setup:{state:'initializing',progress:88}});
            await failureGate;
            setupState='ready';
            return reply(res,500,{error:{code:'synthetic_failure',message:'Owner setup interrupted.'}});
          }
          ownerReady=true;setupState='ready';
          if(scenario==='lost-response') {
            // Persisted owner creation succeeded, but the client cannot decode
            // the response. No session has reached the client yet.
            return reply(res,200,'response body unavailable',true);
          }
          role='owner';return reply(res,200,{continue:false,setup:{state:'ready',progress:100}});
        }
        if(pathname==='/api/owner/login') {
          if(!ownerReady)return reply(res,409,{error:{code:'owner_uninitialized',message:'Finish owner setup first.'}});
          role='owner';return reply(res,200,{signed_in:true});
        }
        return reply(res,404,{error:{code:'unexpected_fixture_route',message:'Unexpected owner UI request.'}});
      }
      if(pathname==='/admin') {res.writeHead(200,{'Content-Type':'text/html'});return res.end(html);}
      if(pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
      const filename=path.resolve(webRoot,'.'+pathname);
      if(!filename.startsWith(webRoot+path.sep)){res.writeHead(403);return res.end();}
      const data=await readFile(filename);
      res.writeHead(200,{'Content-Type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'application/octet-stream'});res.end(data);
    } catch(error) {reply(res,500,{error:{code:'fixture_failure',message:error.message}});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {base:`http://127.0.0.1:${server.address().port}`,calls,releaseFailure,dispose:async()=>{releaseFailure();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
