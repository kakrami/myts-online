import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSummary} from '../web/app/source-progress.js';

const group=(state,coverage='none',count=1,extra={})=>({stage:'source',state,coverage,count,...extra});
const provider=(groups=[],extra={})=>({provider:'trace',total:groups.reduce((total,row)=>total+(row.count??0),0),groups,...extra});
const root=(extra={})=>({provider:'trace',active:true,authorization_state:'connected',...extra});

for(const [name,groups,expected] of [
 ['queued',[group('queued')],'Update queued'],
 ['running',[group('running','partial')],'Updating in background'],
 ['retrying',[group('retrying','partial')],'Retry scheduled'],
 ['failed',[group('failed','none')],'Some data needs attention'],
 ['blocked',[group('blocked','restricted')],'Some data needs attention'],
 ['complete',[group('ready','complete',4),group('ready','complete',2,{stage:'analysis'})],'Source update complete'],
 ['partial saved',[group('ready','partial')],'Saved data available'],
 ['unpublished',[group('ready','unpublished')],'Some data is not published'],
 ['partly unpublished',[group('ready','complete'),group('ready','unpublished')],'Saved data available · Some data is not published'],
 ['restricted',[group('ready','restricted')],'Some data is unavailable'],
 ['unsupported',[group('ready','unsupported')],'Some data is unavailable'],
 ['partly unavailable',[group('ready','complete'),group('ready','restricted')],'Saved data available · Some data is unavailable'],
 ['running with blocked content',[group('running','partial'),group('blocked')],'Updating in background · Some data needs attention'],
 ['retry with failed content',[group('retrying','partial'),group('failed')],'Retry scheduled · Some data needs attention'],
 ['running with unavailable content',[group('running','partial'),group('ready','restricted')],'Updating in background · Some data is unavailable'],
 ['all disabled without saved evidence',[group('disabled')],'Update status unavailable'],
])test(`provider headline: ${name}`,()=>assert.equal(sourceSummary(provider(groups)),expected));

test('live-shaped Trace groups remain a concise partial queue, never a completed-game fraction',()=>{
 const groups=[group('blocked','none',9),group('queued','none',501),group('queued','partial',160),group('ready','complete',3)];
 const row=provider(groups),before=structuredClone(row);
 assert.equal(sourceSummary(row),'Update queued · Some data needs attention');
 assert.deepEqual(row,before);
 assert.doesNotMatch(sourceSummary(row),/9|501|160|673|%|\/|complete|failed|synced/i);
});

test('completion requires all reported work and complete coverage, never total alone',()=>{
 for(const row of [{total:1000},{total:0,groups:[]},{total:2,groups:[group('ready','complete')]},{groups:[group('ready','complete')]},{total:1,groups:[group('ready','complete',0)]},{total:1,groups:[{state:'ready',coverage:'complete'}]},{total:1,groups:[group('ready','none')]}])assert.doesNotMatch(sourceSummary(row),/complete|up to date|synced/i,JSON.stringify(row));
 assert.equal(sourceSummary(provider([group('ready','complete'),group('queued','partial')])),'Update queued');
 assert.equal(sourceSummary(provider([group('ready','complete'),group('running','partial',1,{stage:'analysis'})])),'Updating in background');
});

test('missing or empty status is honest and does not crash',()=>{
 for(const row of [undefined,null,{}, {total:0}, {groups:null}, {groups:[null]}, {groups:'unavailable'}])assert.equal(sourceSummary(row),'No background work recorded');
 assert.equal(sourceSummary({total:9,groups:[]}), 'Update status unavailable');
});

test('typed zero-job connection context distinguishes waiting, reconnect and saved-only history',()=>{
 assert.equal(sourceSummary(provider(),{connections:[root()]}),'Connected · Waiting for background work');
 assert.equal(sourceSummary(provider(),{connections:[root({provider:'gotsport'})]}),'No background work recorded');
 assert.equal(sourceSummary(provider(),{connections:[root({authorization_state:'public'})]}),'Connected · Waiting for background work');
 for(const authorization_state of ['expired','reconnect_required'])assert.equal(sourceSummary(provider(),{connections:[root({authorization_state})]}),'Reconnect required');
 assert.equal(sourceSummary(provider(),{connections:[root({authorization_state:'disconnected'})]}),'Not connected');
 assert.equal(sourceSummary(provider(),{connections:[root({active:false,imported_roster_total:12})]}),'Disconnected · Saved data available');
 assert.equal(sourceSummary(provider(),{connections:[root({authorization_state:'disconnected',pending_roster:{total:2}})]}),'Disconnected · Saved data available');
 assert.equal(sourceSummary(provider([group('ready','complete')]),{connections:[root({authorization_state:'expired'})]}),'Reconnect required · Saved data available');
 assert.equal(sourceSummary(provider([group('queued')]),{connections:[root({active:false})]}),'Not connected');
});

test('failure text never infers an authorization problem or discards another working account',()=>{
 const failed=provider([group('failed','none')],{error_message:'The provider requires sign-in.'});
 assert.equal(sourceSummary(failed),'Some data needs attention');
 assert.equal(sourceSummary(provider([group('running','partial'),group('blocked')]),{connections:[root(),root({authorization_state:'expired'})]}),'Updating in background · Some data needs attention');
});

test('trusted provider headlines survive but old concatenated technical labels are summarized',()=>{
 assert.equal(sourceSummary({status_label:'Saved history · Waiting for season evidence',total:0}),'Saved history · Waiting for season evidence');
 const row=provider([group('queued','none',501),group('queued','partial',160)],{status_label:'501 queued · none · 160 queued · partial'});
 assert.equal(sourceSummary(row),'Update queued');
});


test('a partial connection page cannot declare every account disconnected or expired',()=>{
 const row=provider([group('queued')]);
 for(const state of [{active:false},{authorization_state:'expired'},{authorization_state:'disconnected'}])assert.equal(sourceSummary(row,{connections:[root(state)],connectionsComplete:false}),'Update queued');
});
