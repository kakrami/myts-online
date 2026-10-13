import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,access} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const module=process.env.MYTS_PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
await access(module);const {chromium}=await import(pathToFileURL(module));
const executablePath=process.env.MYTS_TEST_CHROMIUM||'/usr/bin/chromium';
const webRoot=fileURLToPath(new URL('../web/',import.meta.url));
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui-original/original.css"></head><body><script type="module">
import {createApp} from '/app/main.js';
const rows=(n,label)=>Array.from({length:n},(_,i)=>'<p style="height:36px;margin:0">'+label+' '+i+'</p>').join('');
const fetcher=async input=>{const url=new URL(input,location.origin);let data;
if(url.pathname==='/api/bootstrap')data={version:'scroll-fixture',setup:{state:'ready',owner_ready:true},session:{role:'owner'},teams:[{id:'t',name:'Synthetic team',timezone:'UTC',seasons:[{id:'s',year:2026,label:'2026',start_day:'2026-06-01',end_day:'2027-06-01'}]}]};
else if(url.pathname==='/api/revisions')data={revision:1};else data={data:{items:[{id:'a'}],total:1}};
return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});};
window.scrollApp=createApp({fetcher,routes:{team:'/api/team'},handlers:{present:{overview:()=>rows(60,'Overview'),schedule:()=>rows(150,'Schedule')+'<button data-action="more" data-cursor="next">More</button><button data-action="match" data-id="one">Open detail</button>',team:()=>rows(70,'Team')},openDetail:async(detail,api)=>api.setDetail({title:detail.id,bodyHTML:rows(100,'Detail'),can_back:api.state.details.length>1})}});await window.scrollApp.start();window.scrollReady=true;
</script></body></html>`;
async function fixture(){
 const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/admin'){res.writeHead(200,{'content-type':'text/html'});return res.end(html);}if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}const file=path.resolve(webRoot,'.'+url.pathname);if(!file.startsWith(webRoot)){res.writeHead(403);return res.end();}const content=await readFile(file);res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':'text/css'});res.end(content);}catch(error){res.writeHead(500);res.end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{url:'http://127.0.0.1:'+server.address().port+'/admin',async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
for(const viewport of [{width:1280,height:900},{width:390,height:844}])test(`actual Chromium page/detail/back scroll at ${viewport.width}px`,{timeout:30000},async()=>{
 const server=await fixture();let browser;try{browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});}catch(error){await server.close();throw error;}const context=await browser.newContext({viewport,isMobile:viewport.width<700,hasTouch:viewport.width<700}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const y=()=>page.evaluate(()=>window.scrollY);const scroll=async top=>{await page.evaluate(top=>window.scrollTo({top,behavior:'instant'}),top);await page.waitForTimeout(160);};
 try{await page.goto(server.url);await page.waitForFunction(()=>window.scrollReady);
 await page.locator('[data-action="nav"][data-view="schedule"]').first().click();await page.waitForFunction(()=>window.scrollApp.state.view==='schedule'&&!document.querySelector('#root').hasAttribute('aria-busy'));await scroll(1800);
 await page.evaluate(()=>window.scrollApp.action('more',{cursor:'next'}));assert.equal(await y(),1800);
 await page.locator('[data-action="nav"][data-view="team"]').first().click();await page.waitForFunction(()=>window.scrollApp.state.view==='team'&&!document.querySelector('#root').hasAttribute('aria-busy'));assert.equal(await y(),0);await scroll(600);
 await page.locator('[data-action="nav"][data-view="schedule"]').first().click();await page.waitForFunction(()=>window.scrollApp.state.view==='schedule'&&!document.querySelector('#root').hasAttribute('aria-busy'));assert.equal(await y(),1800);
 await page.goBack();await page.waitForFunction(()=>window.scrollApp.state.view==='team'&&!document.querySelector('#root').hasAttribute('aria-busy'));assert.equal(await y(),600);
 await page.goForward();await page.waitForFunction(()=>window.scrollApp.state.view==='schedule'&&!document.querySelector('#root').hasAttribute('aria-busy'));assert.equal(await y(),1800); await page.evaluate(()=>window.scrollApp.action('match',{id:'one'}));await page.locator('#entity').waitFor({state:'visible'});await page.locator('#entityBody').evaluate(body=>{body.scrollTop=700;body.dispatchEvent(new Event('scroll'));});assert.equal(await y(),1800);assert.equal(await page.locator('#entityBody').evaluate(body=>body.scrollTop),700);
 await page.locator('#entityClose').click();await page.locator('#entity').waitFor({state:'hidden'});assert.equal(await y(),1800);
 assert.deepEqual(errors,[]);
 }finally{await page.evaluate(()=>window.scrollApp?.stop()).catch(()=>{});await browser.close();await server.close();}
});
