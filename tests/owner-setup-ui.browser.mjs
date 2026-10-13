import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ownerUIFixture} from './fixtures/owner-ui-server.mjs';

// Run separately with npm run test:browser. Install Playwright and Chromium,
// or provide MYTS_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs and
// MYTS_TEST_CHROMIUM=/path/to/chromium. Native npm test needs neither.
const exists=async file=>{if(!file)return false;try{await access(file);return true;}catch{return false;}};
const require=createRequire(import.meta.url);
let installedPlaywright;try{installedPlaywright=require.resolve('playwright');}catch{}
const candidates=[process.env.MYTS_PLAYWRIGHT_MODULE,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'),installedPlaywright,'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'];
let playwrightModule;
for(const file of candidates)if(await exists(file)){playwrightModule=file;break;}
if(!playwrightModule)throw new Error('Browser tests require Playwright. Install it or set MYTS_PLAYWRIGHT_MODULE to its module entry point.');
const {chromium}=await import(pathToFileURL(playwrightModule));
const qaDirectory=path.resolve(fileURLToPath(new URL('../../qa-browser/',import.meta.url)));
const bundledChromium=chromium.executablePath(),hostChromium=path.join(qaDirectory,'chromium');
const executablePath=process.env.MYTS_TEST_CHROMIUM??(await exists(bundledChromium)?bundledChromium:await exists(hostChromium)?hostChromium:null);
if(!executablePath)throw new Error('Browser tests require Chromium. Install it with Playwright or set MYTS_TEST_CHROMIUM to its executable.');
const hostFixture=path.resolve(executablePath)===hostChromium;
const launch=()=>chromium.launch({headless:true,executablePath,args:hostFixture?['--no-sandbox','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--no-sandbox'],env:hostFixture?{...process.env,FONTCONFIG_PATH:path.join(qaDirectory,'fonts'),LD_LIBRARY_PATH:qaDirectory}:process.env});

async function withOwnerPage(scenario,run) {
  const fixture=await ownerUIFixture(scenario),browser=await launch(),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(fixture.base+'/admin');
    await page.waitForFunction(()=>window.ownerAppStarted===true);
    await run(page,fixture);
    assert.deepEqual(errors,[]);
  } finally {await page.evaluate(()=>window.ownerApp?.stop()).catch(()=>{});await Promise.allSettled([browser.close(),fixture.dispose()]);}
}
async function submitPassword(page) {
  await page.locator('#adminKey').fill('synthetic-owner-password-123');
  await page.locator('#loginButton').click();
}
const paths=fixture=>fixture.calls.map(call=>call.path);

test('ready schema with no owner routes the real login form to owner initialization', {timeout:30000},async()=>{
  await withOwnerPage('ready-no-owner',async(page,fixture)=>{
    assert.equal(await page.locator('#loginButton').textContent(),'Initialize & sign in');
    assert.match(await page.locator('#loginText').textContent(),/Finish owner access/);
    await submitPassword(page);
    await page.locator('#app').waitFor({state:'visible'});
    assert.deepEqual(paths(fixture),['/api/bootstrap','/api/owner/initialize','/api/bootstrap']);
    assert.equal(await page.locator('#adminKey').inputValue(),'');
    assert.equal(await page.evaluate(()=>window.ownerApp.state.bootstrap.session.role),'owner');
  });
});

test('failed initialization refreshes persisted setup and removes stale 88 percent text', {timeout:30000},async()=>{
  await withOwnerPage('interrupted',async(page,fixture)=>{
    await submitPassword(page);
    await page.waitForFunction(()=>document.querySelector('#loginText').textContent.includes('88%'));
    assert.equal(await page.locator('#loginButton').isDisabled(),true);
    fixture.releaseFailure();
    await page.locator('#loginError').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('#loginButton').disabled);
    assert.deepEqual(paths(fixture),['/api/bootstrap','/api/owner/initialize','/api/owner/initialize','/api/bootstrap']);
    assert.equal(await page.evaluate(()=>window.ownerApp.state.bootstrap.setup.state),'ready');
    assert.equal(await page.evaluate(()=>window.ownerApp.state.bootstrap.setup.owner_ready),false);
    assert.match(await page.locator('#loginText').textContent(),/Finish owner access/);
    assert.doesNotMatch(await page.locator('#loginText').textContent(),/88%/);
    assert.equal(await page.locator('#loginButton').textContent(),'Initialize & sign in');
    assert.equal(await page.locator('#loginError').textContent(),'Owner setup interrupted.');
    assert.equal(await page.locator('#adminKey').inputValue(),'');
  });
});

test('lost committed initialization response refreshes owner readiness and next submit signs in', {timeout:30000},async()=>{
  await withOwnerPage('lost-response',async(page,fixture)=>{
    await submitPassword(page);
    await page.locator('#loginError').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('#loginButton').disabled);
    assert.deepEqual(paths(fixture),['/api/bootstrap','/api/owner/initialize','/api/bootstrap']);
    assert.equal(await page.evaluate(()=>window.ownerApp.state.bootstrap.setup.owner_ready),true);
    assert.equal(await page.evaluate(()=>window.ownerApp.state.bootstrap.session.role),'anonymous');
    assert.equal(await page.locator('#loginButton').textContent(),'Sign in');
    await submitPassword(page);
    await page.locator('#app').waitFor({state:'visible'});
    assert.deepEqual(paths(fixture),['/api/bootstrap','/api/owner/initialize','/api/bootstrap','/api/owner/login','/api/bootstrap']);
    assert.equal(await page.evaluate(()=>window.ownerApp.state.bootstrap.session.role),'owner');
    assert.equal(await page.locator('#adminKey').inputValue(),'');
  });
});
