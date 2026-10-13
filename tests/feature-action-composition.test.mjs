import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFeatureBridge} from '../web/app/features.js';
import {createCompetitionFeatures} from '../web/app/competition-features.js';
import {createSecurityFeatures} from '../web/app/security-features.js';
import {createDetailFeatures} from '../web/app/detail-features.js';
import {createCoachFeatures} from '../web/app/coach-features.js';
import {createLineupFeatures} from '../web/app/lineup-features.js';
import {createReportsController} from '../web/app/reports.js';
import {createDataFileController} from '../web/app/data-files.js';
import {createTrackingCaptureController} from '../web/app/tracking-capture.js';
import {createIdentityFeatures} from '../web/app/identity-features.js';
import {createTrackFeatures} from '../web/app/track-features.js';

test('feature action composition inventories duplicate names and reserves shared More dispatch',async t=>{
 const coach=createCoachFeatures(),lineup=createLineupFeatures(),reports=createReportsController(),dataFiles=createDataFileController(),trackingCapture=createTrackingCaptureController();
 const source=await readFile(new URL('../web/app/features.js',import.meta.url),'utf8');
 const base=[...source.matchAll(/actions(?:\.([a-zA-Z0-9_]+)|\[['"]([^'"]+)['"]\])\s*=/g)].map(m=>m[1]||m[2]);base.push('more');
 const modules={base:Object.fromEntries(base.map(name=>[name,true])),competition:createCompetitionFeatures().actions,security:createSecurityFeatures().actions,detail:createDetailFeatures({coach,lineup}).actions,coach:coach.actions,lineup:lineup.actions,reports:reports.handlers.actions,dataFiles:dataFiles.actions,trackingCapture:trackingCapture.actions,identity:createIdentityFeatures().actions,tracks:createTrackFeatures().actions};
 const names={};for(const [module,actions]of Object.entries(modules))for(const name of Object.keys(actions??{}))(names[name]??=[]).push(module);
 const collisions=Object.fromEntries(Object.entries(names).filter(([,owners])=>owners.length>1));t.diagnostic(JSON.stringify(collisions));
 assert.deepEqual(collisions,{more:['base','reports']});
 const bridge=createFeatureBridge({reports,dataFiles,trackingCapture});
 assert.notEqual(bridge.handlers.actions.more,reports.handlers.actions.more,'Reports must not replace the view-aware dispatcher');
});

test('shared More dispatch preserves non-report paging and dirty-editor guard with Reports installed',async()=>{
 const reports=createReportsController(),bridge=createFeatureBridge({reports});const calls=[],api={state:{view:'schedule',details:[],editorDirty:false},renderView:async args=>calls.push(args),notice:message=>calls.push(message)};
 await bridge.handlers.actions.more({cursor:'schedule-page'},api);assert.deepEqual(calls,[{append:true,cursor:'schedule-page'}]);
 api.state.view='team';await bridge.handlers.actions.more({cursor:'roster-page'},api);assert.deepEqual(calls.at(-1),{append:true,cursor:'roster-page'});
 api.state.editorDirty=true;await bridge.handlers.actions.more({cursor:'blocked-page'},api);assert.match(calls.at(-1),/Save or cancel/);assert.equal(calls.length,3);
});
