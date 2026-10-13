import test from 'node:test';
import assert from 'node:assert/strict';
import {committedProgress,completeScaleProviderGraph} from './fixtures/lifecycle-progress.mjs';
const root=(pages,pass=10,phase='periods',after='a',generation=1)=>({id:'root',provider:'domain',component:'connection',pages_saved:pages,generation,checkpoint:JSON.stringify({passRevision:pass,phase,after})});
function graph(){const jobs=['profile','catalog','history'].map(component=>({id:component,provider:'gotsport',component,scope:'720001',state:'ready',coverage:'complete',pages_saved:component==='history'?3:1}));for(let i=0;i<101;i++)for(const [component,scope]of [['event',`${30000+i}:${50000+i}`],['division',`gotsport:${40000+i}`],['bridge',`720001:${30000+i}`],['standings',`gotsport:${40000+i}`]])jobs.push({id:component+scope,provider:'gotsport',component,scope,state:'ready',coverage:'complete',pages_saved:1});return jobs;}
test('collection barrier requires every exact one of407 completed native jobs and exactly3 history pages',()=>{
  const jobs=graph();assert.equal(jobs.length,407);assert.equal(completeScaleProviderGraph(jobs,{team:720001}),true);
  for(const change of [rows=>rows.pop(),rows=>rows[6].scope='foreign',rows=>rows[6].state='queued',rows=>rows[6].coverage='partial',rows=>rows[6].pages_saved=0,rows=>rows[2].pages_saved=4,rows=>rows[6]={...rows[7]}]){const copy=structuredClone(jobs);change(copy);assert.equal(completeScaleProviderGraph(copy,{team:720001}),false);}
  assert.equal(completeScaleProviderGraph([],{team:720001}),false);
});
test('committed progress rejects page loss and same-pass cursor or phase regression',()=>{
  for(const next of [root(1),root(3,10,'periods','a'),root(3,10,'identity','z'),root(3,9,'periods','z')]){const watch=committedProgress({now:()=>0});watch.observe([root(2,10,'periods','b')]);assert.throws(()=>watch.observe([next]),/regressed/);}
});
test('new catch-up pass or generation legitimately restarts phase and cursor',()=>{
  const watch=committedProgress({now:()=>0});watch.observe([root(2,10,'events','z')]);watch.observe([root(3,11,'boundaries','')]);watch.observe([root(4,11,'periods','b')]);assert.doesNotThrow(()=>watch.observe([root(5,11,'boundaries','',2)]));
});
test('only committed pages reset the60-second stall clock; new queued jobs and checkpoint edits cannot hide a stall',()=>{
  let now=0;const watch=committedProgress({now:()=>now});watch.observe([root(2)]);now=59000;watch.observe([root(2,20,'events','z'),{...root(0),id:'new-job'}]);now=60000;assert.throws(()=>watch.observe([root(2)]),/stalled/);
});
test('saved-page progress is counted monotonically across scheduler polls',()=>{
  let now=0;const watch=committedProgress({now:()=>now});watch.observe([root(2)]);now=59000;assert.equal(watch.observe([root(3)]).committed_pages,3);now=118000;assert.equal(watch.observe([root(4)]).observed_advances,4);now=178000;assert.throws(()=>watch.observe([root(4)]),/stalled/);
});

test('a terminal or retrying job fails before a completion predicate can hide it',()=>{
  for(const state of ['failed','blocked','retrying']){const watch=committedProgress({now:()=>0});assert.throws(()=>watch.observe([{...root(1),state,last_error_code:'synthetic_failure'}]),/Native job failed/);}
});
