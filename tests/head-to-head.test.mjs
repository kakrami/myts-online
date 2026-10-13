import test from 'node:test';
import assert from 'node:assert/strict';
import {FeatureReads} from '../src/read-model/feature-reads.js';
import {HEAD_TO_HEAD_RANGES,headToHeadRange} from '../src/read-model/h2h.js';

import {fixture,AT,INPUT,HOME,AWAY} from './fixtures/head-to-head-harness.mjs';

test('original H2H ranges retain names, include future all-season games, and clamp calendar months',()=>{
  assert.deepEqual(HEAD_TO_HEAD_RANGES.map(o=>[o.value,o.label]),[['all','All seasons'],['season','This season'],['year','Last year'],['6months','Last 6 months']]);
  for(const [range,today,from,to] of [['all','2026-10-12',null,null],['year','2024-02-29','2023-02-28','2024-02-29'],['6months','2026-08-31','2026-02-28','2026-08-31'],['6months','2024-08-31','2024-02-29','2024-08-31'],['6months','2026-03-31','2025-09-30','2026-03-31']])assert.deepEqual(headToHeadRange(range,{today,year:2026}),{from,to});
  assert.deepEqual(headToHeadRange('season',{today:'2026-10-12',year:2026,includeJune:false}),{from:'2026-07-01',to:'2026-10-12'});
  assert.deepEqual(headToHeadRange('season',{today:'2026-10-12',year:2025,includeJune:true}),{from:'2025-06-01',to:'2026-05-31'});
  assert.throws(()=>headToHeadRange('custom',{today:'2026-10-12',year:2026}),/valid head-to-head range/);
});

test('H2H independently pages past and upcoming, aggregates the entire saved range, and excludes slots or undated rows',async()=>{
  const f=fixture();try {
    for(let n=0;n<125;n++)f.event('past-'+String(n).padStart(3,'0'),{day:n%2?'2025-09-01':'2026-09-01'});
    for(let n=0;n<7;n++)f.event('next-'+n,{day:'2026-10-'+String(13+n),status:'SCHEDULED',hs:null,as:null});
    f.event('today-elapsed',{starts:'2026-10-12T01:00:00Z',day:'2026-10-12',status:'SCHEDULED',hs:null,as:null});
    f.event('today-final',{day:'2026-10-12'});f.event('future-final',{day:'2026-10-20'});f.event('slot',{conditional:1});f.event('undated',{day:null});f.event('practice',{type:'practice'});f.event('unrelated',{away:'gotsport/public/3'});
    const first=await f.h2h({limit:20,upcoming_limit:3});
    assert.equal(first.events.total,127);assert.equal(first.upcoming.total,8);assert.equal(first.record.games,127);assert.equal(first.record.wins,127);assert.equal(first.record.goals_for,254);assert.equal(first.record.goals_against,127);
    assert.equal(first.events.items.length,20);assert.equal(first.upcoming.items.length,3);assert.equal(first.upcoming.items[0].id,'today-elapsed');assert.equal(first.history_complete,false);assert.equal(first.coverage,'saved_history');
    const past=[],upcoming=[];let page=first;
    do{past.push(...page.events.items.map(e=>e.id));page=page.events.next_cursor?await f.h2h({limit:20,cursor:page.events.next_cursor,upcoming_limit:3}):null;}while(page);
    page=first;do{upcoming.push(...page.upcoming.items.map(e=>e.id));page=page.upcoming.next_cursor?await f.h2h({limit:20,upcoming_limit:3,upcoming_cursor:page.upcoming.next_cursor}):null;}while(page);
    assert.equal(new Set(past).size,127);assert.equal(new Set(upcoming).size,8);assert.ok(!past.some(id=>['slot','undated','practice','unrelated'].includes(id)));
  }finally{f.close();}
});

test('season range follows June only; saved inclusion-rule exclusions do not alter original H2H results',async()=>{
  const f=fixture();try {
    for(const [id,day] of [['old','2025-09-01'],['june','2026-06-30'],['july','2026-07-01'],['excluded','2026-08-01'],['today','2026-10-12'],['future','2026-10-13']])f.event(id,{day});
    f.insert('season_inclusion_rules',{team_season_id:'season',kind:'event',resource_key:'excluded',included:0});
    assert.equal((await f.h2h()).record.games,6);
    const result=await f.h2h({range:'season'});assert.equal(result.record.games,3);assert.deepEqual(result.events.items.map(e=>e.id),['today','excluded','july']);assert.equal(result.upcoming.total,0);
    f.sqlite.prepare("UPDATE team_seasons SET include_june=1 WHERE id='season'").run();
    assert.equal((await f.h2h({range:'season'})).record.games,4);
    assert.equal((await f.h2h({range:'year'})).record.games,4);
  }finally{f.close();}
});

test('range and day grouping use the team timezone and preserve projected date-only and undated corrections',async()=>{
  const f=fixture({zone:'America/Los_Angeles',at:'2026-10-13T01:00:00Z'});try {
    f.event('today-local',{starts:'2026-10-13T06:59:59Z',day:'2026-10-13',status:'SCHEDULED',hs:null,as:null});
    f.event('tomorrow-local',{starts:'2026-10-13T07:00:00Z',day:'2026-10-13',status:'SCHEDULED',hs:null,as:null});
    f.event('owner-date-only',{starts:'2026-03-01T20:00:00Z',day:'2026-03-01',project:true,effective:{starts_at:null,local_day:'2026-10-01'}});
    f.event('owner-undated',{starts:'2026-09-01T20:00:00Z',day:'2026-09-01',project:true,effective:{starts_at:null,local_day:null}});
    f.event('owner-moved-out',{day:'2026-08-01',project:true,effective:{local_day:'2026-02-01'}});
    const result=await f.h2h({range:'6months'});
    assert.equal(result.range_bounds.to,'2026-10-12');assert.deepEqual(result.events.items.map(e=>e.id),['owner-date-only']);assert.equal(result.events.items[0].starts_at,null);assert.equal(result.events.items[0].local_day,'2026-10-01');assert.deepEqual(result.upcoming.items.map(e=>e.id),['today-local']);
  }finally{f.close();}
});

test('verified team and event aliases deduplicate meetings, reverse scores, and keep conflicts out of record',async()=>{
  const f=fixture();try {
    for(const [a,b] of [[HOME,'live/public/1'],[AWAY,'live/public/2']])f.insert('source_team_links',{a,b,kind:'provider_external_key',evidence:'{}'});
    f.event('same');f.event('same-live',{home:'live/public/2',away:'live/public/1',hs:1,as:2,alias:'same'});
    f.event('reverse',{home:AWAY,away:HOME,hs:3,as:1});
    f.event('conflict');f.event('conflict-live',{home:'live/public/1',away:'live/public/2',hs:7,as:2,alias:'conflict'});
    f.event('identity',{project:true,effective:{identity_conflict:1}});f.event('cancelled',{status:'CANCELLED'});
    const result=await f.h2h();assert.equal(result.events.total,5);assert.deepEqual(result.record,{games:2,wins:1,draws:0,losses:1,goals_for:3,goals_against:4});
    assert.equal(result.events.items.find(e=>e.id==='conflict').result_conflict,true);assert.equal(result.events.items.find(e=>e.id==='identity').identity_conflict,true);
  }finally{f.close();}
});

test('signed H2H cursors bind the range, section, viewer, revision and shared cutoff',async()=>{
  const f=fixture();try {
    for(let n=0;n<3;n++){f.event('past-'+n);f.event('future-'+n,{day:'2026-10-13',status:'SCHEDULED',hs:null,as:null});}
    const first=await f.h2h({limit:1,upcoming_limit:1});
    await assert.rejects(f.h2h({range:'season',limit:1,cursor:first.events.next_cursor}),error=>error.code==='cursor_selection');
    await assert.rejects(f.h2h({upcoming_cursor:first.events.next_cursor}),error=>error.code==='cursor_selection');
    const viewer=new FeatureReads(f.db,{owner:false,teamId:'team',categories:['matches']},f.options),context=await viewer.featureContext(INPUT);
    await assert.rejects(viewer.headToHead(context,f.current,{cursor:first.events.next_cursor}),error=>error.code==='cursor_selection');
    const before=f.queries();await f.h2h({limit:1,upcoming_limit:1,cursor:first.events.next_cursor,upcoming_cursor:first.upcoming.next_cursor});assert.ok(f.queries()-before<20,'reading both pages stays within a fixed query count');
    f.setNow('2026-10-12T12:00:01Z');const later=await f.h2h({limit:1,upcoming_limit:1});
    await assert.rejects(f.h2h({cursor:first.events.next_cursor,upcoming_cursor:later.upcoming.next_cursor}),error=>error.code==='cursor_selection');
    f.sqlite.prepare("UPDATE source_event_state SET input_revision=input_revision+1 WHERE source_event_id LIKE '%past-0'").run();
    await assert.rejects(f.h2h({cursor:first.events.next_cursor}),error=>error.code==='cursor_restart');
    await assert.rejects(f.h2h({range:'invalid'}),/valid head-to-head range/);
    await assert.rejects(f.h2h({upcoming_limit:101}),/page size/);
  }finally{f.close();}
});

test('match DTO forwards H2H range and independent upcoming pagination, with normal viewer scope checks',async()=>{
  const f=fixture();try {
    f.event('current',{project:true});f.event('old',{day:'2025-01-01'});for(let n=0;n<3;n++)f.event('next-'+n,{day:'2026-10-12',status:'SCHEDULED',hs:null,as:null});
    const first=(await f.reads.match(INPUT,'current',{tab:'h2h',h2h_range:'season',h2h_upcoming_limit:1})).data.h2h;
    assert.equal(first.range,'season');assert.equal(first.record.games,1);assert.equal(first.upcoming.items.length,1);assert.ok(first.upcoming.next_cursor);
    const second=(await f.reads.match(INPUT,'current',{tab:'h2h',h2h_range:'season',h2h_upcoming_limit:1,h2h_upcoming_cursor:first.upcoming.next_cursor})).data.h2h;assert.notEqual(second.upcoming.items[0].id,first.upcoming.items[0].id);
    f.event('another-current-season',{day:'2026-08-01'});
    const pastFirst=(await f.reads.match(INPUT,'current',{tab:'h2h',limit:1,h2h_range:'season'})).data.h2h;
    const pastSecond=(await f.reads.match(INPUT,'current',{tab:'h2h',limit:1,h2h_range:'season',h2h_cursor:pastFirst.events.next_cursor})).data.h2h;
    assert.notEqual(pastSecond.events.items[0].id,pastFirst.events.items[0].id,'explicit H2H cursor survives generic match cursor default');
    const viewer=new FeatureReads(f.db,{owner:false,teamId:'other',categories:['matches']},f.options);await assert.rejects(viewer.match(INPUT,'current',{tab:'h2h'}),error=>error.code==='team_forbidden');
    const noMatchScope=new FeatureReads(f.db,{owner:false,teamId:'team',categories:['overview']},f.options);await assert.rejects(noMatchScope.match(INPUT,'current',{tab:'h2h'}),error=>error.code==='scope_forbidden');
  }finally{f.close();}
});

test('H2H continuation freezes the team-local day across midnight',async()=>{
  const f=fixture({at:'2026-10-12T23:59:50Z'});try {
    f.event('past-a');f.event('past-b');f.event('old-today',{day:'2026-10-12',status:'SCHEDULED',hs:null,as:null});f.event('new-today',{day:'2026-10-13',status:'SCHEDULED',hs:null,as:null});
    const first=await f.h2h({limit:1,upcoming_limit:1});assert.equal(first.upcoming.total,2);
    f.setNow('2026-10-13T00:00:10Z');
    const next=await f.h2h({limit:1,cursor:first.events.next_cursor,upcoming_limit:1,upcoming_cursor:first.upcoming.next_cursor});
    assert.equal(next.as_of,first.as_of);assert.equal(next.events.total,2);assert.equal(next.upcoming.total,2);assert.equal(next.upcoming.items[0].id,'new-today');
    const fresh=await f.h2h();assert.equal(fresh.events.total,3);assert.equal(fresh.upcoming.total,1);
  }finally{f.close();}
});

test('general competition reads also honor nullable projected dates',async()=>{
  const f=fixture();try {
    f.insert('competitions',{id:'competition',created_at:AT});f.insert('divisions',{id:'division',created_at:AT});
    f.insert('source_competitions',{id:'source-competition',provider:'gotsport',scope:'public',native_id:'competition',name:'League',kind:'league',season_year:2026,evidence:'{}',content_hash:'competition',observed_at:AT});
    f.insert('source_divisions',{id:'source-division',provider:'gotsport',competition_id:'source-competition',name:'Division',evidence:'{}',content_hash:'division',observed_at:AT});
    f.insert('competition_source_links',{source_competition_id:'source-competition',competition_id:'competition',reason:'native',evidence:'{}'});f.insert('division_source_links',{source_division_id:'source-division',division_id:'division',reason:'native',evidence:'{}'});
    f.insert('source_competition_memberships',{id:'membership',source_team_id:HOME,source_division_id:'source-division',evidence:'{}',content_hash:'membership',observed_at:AT});
    f.event('date-only',{starts:'2026-03-01T12:00:00Z',day:'2026-03-01',project:true,effective:{starts_at:null,local_day:'2026-09-01',competition_id:'competition',division_id:'division'}});
    f.event('undated',{starts:'2026-04-01T12:00:00Z',day:'2026-04-01',project:true,effective:{starts_at:null,local_day:null,competition_id:'competition',division_id:'division'}});
    f.sqlite.prepare("UPDATE source_events SET division_key='source-division',competition_key='source-competition'").run();
    const result=(await f.reads.competition(INPUT,'competition')).data;
    assert.equal(result.events.total,2);
    assert.equal(result.events.items.find(e=>e.id==='date-only').starts_at,null);assert.equal(result.events.items.find(e=>e.id==='date-only').local_day,'2026-09-01');
    assert.equal(result.events.items.find(e=>e.id==='undated').starts_at,null);assert.equal(result.events.items.find(e=>e.id==='undated').local_day,null);
  }finally{f.close();}
});

test('H2H rejects an intervening shared source update instead of mixing aggregate and page snapshots',async()=>{
  const f=fixture();try {
    f.event('past');const batch=f.db.batch;
    f.db.batch=async statements=>{const result=await batch(statements);if(statements.some(s=>s.sql.includes('count(gf) AS games')))f.sqlite.prepare('UPDATE domain_installation SET public_revision=public_revision+1').run();return result;};
    await assert.rejects(f.h2h(),error=>error.code==='cursor_restart');
  }finally{f.close();}
});

test('owned historical H2H rows carry their actual season for a successful detail navigation',async()=>{
  const f=fixture();try {
    f.event('current',{project:true});f.event('historical-own',{day:'2025-10-12',project:true,season:'history'});f.event('historical-public',{day:'2024-10-12'});
    const h2h=(await f.reads.match(INPUT,'current',{tab:'h2h'})).data.h2h,owned=h2h.events.items.find(e=>e.id==='historical-own'),publicOnly=h2h.events.items.find(e=>e.id==='historical-public');
    assert.equal(owned.app_team_id,'team');assert.equal(owned.team_season_id,'history');assert.equal(owned.own_match,true);
    const historical=(await f.reads.match({team_id:owned.app_team_id,team_season_id:owned.team_season_id},owned.id)).data;
    assert.equal(historical.event.id,owned.id);assert.equal(historical.event.local_day,'2025-10-12');
    assert.equal(publicOnly.app_team_id,null);assert.equal(publicOnly.team_season_id,null);assert.equal(publicOnly.own_match,false,'a saved public row must not invent an owned season');
    await assert.rejects(f.reads.match(INPUT,owned.id),error=>error.code==='not_found','the current season is not a valid historical navigation target');
  }finally{f.close();}
});

async function allMeetings(f,section,{limit=1,...options}={}) {
  const ids=[];let cursor=null;
  do{const result=await f.h2h({...options,limit,upcoming_limit:limit,...(section==='events'?{cursor}:{upcoming_cursor:cursor})});ids.push(...result[section].items.map(row=>row.id));cursor=result[section].next_cursor;}while(cursor);
  assert.equal(new Set(ids).size,ids.length,'strict cursors must never repeat a meeting');return ids;
}

test('original local-day/known-before-TBD ordering survives limit-one pages in both directions',async()=>{
  const f=fixture({zone:'America/Los_Angeles'});try {
    for(const [id,starts,day] of [['known-early','2026-10-12T17:00:00Z','2026-10-12'],['known-late-a','2026-10-13T01:00:00Z','2026-10-13'],['known-late-b','2026-10-13T01:00:00Z','2026-10-13'],['today-tbd',null,'2026-10-12'],['tomorrow-known','2026-10-13T18:00:00Z','2026-10-13'],['tomorrow-tbd',null,'2026-10-13']])f.event(id,{starts,day,status:'SCHEDULED',hs:null,as:null});
    assert.deepEqual(await allMeetings(f,'upcoming'),['known-early','known-late-a','known-late-b','today-tbd','tomorrow-known','tomorrow-tbd']);
    f.sqlite.prepare("UPDATE source_events SET status='FINAL',home_score=2,away_score=1").run();f.sqlite.prepare('UPDATE domain_installation SET public_revision=public_revision+1').run();
    assert.deepEqual(await allMeetings(f,'events'),['tomorrow-known','tomorrow-tbd','known-late-b','known-late-a','known-early','today-tbd']);
  }finally{f.close();}
});

test('original H2H ordering handles spring gaps, both fall-fold instants, and date-line skipped days',async()=>{
  const f=fixture({zone:'America/Los_Angeles'});try {
    f.event('spring-before',{starts:'2026-03-08T09:59:00Z'});f.event('spring-after',{starts:'2026-03-08T10:01:00Z'});f.event('spring-tbd',{day:'2026-03-08'});
    f.event('fall-first',{starts:'2026-11-01T08:30:00Z',status:'SCHEDULED',hs:null,as:null});f.event('fall-second',{starts:'2026-11-01T09:30:00Z',status:'SCHEDULED',hs:null,as:null});f.event('fall-tbd',{day:'2026-11-01',status:'SCHEDULED',hs:null,as:null});
    assert.deepEqual(await allMeetings(f,'events'),['spring-after','spring-before','spring-tbd']);assert.deepEqual(await allMeetings(f,'upcoming'),['fall-first','fall-second','fall-tbd']);
  }finally{f.close();}
  const apia=fixture({zone:'Pacific/Apia'});try {
    apia.event('dec29-known',{starts:'2011-12-30T09:30:00Z'});apia.event('dec29-tbd',{day:'2011-12-29'});apia.event('skipped-date-tbd',{day:'2011-12-30'});apia.event('dec31-known',{starts:'2011-12-30T10:30:00Z'});apia.event('dec31-tbd',{day:'2011-12-31'});
    assert.deepEqual(await allMeetings(apia,'events'),['dec31-known','dec31-tbd','skipped-date-tbd','dec29-known','dec29-tbd']);
  }finally{apia.close();}
});

test('midnight rollback orders by local day across limit-one pages and classifies repeated days exactly',async()=>{
 const f=fixture({zone:'America/St_Johns',at:'2008-11-01T12:00:00Z'});try{
  for(const [id,starts]of [['nov2-first','2008-11-02T02:30:00Z'],['nov1-return','2008-11-02T02:45:00Z'],['nov2-stable','2008-11-02T03:30:00Z']])f.event(id,{starts,status:'SCHEDULED',hs:null,as:null});
  assert.deepEqual(await allMeetings(f,'upcoming'),['nov1-return','nov2-first','nov2-stable']);
  f.setNow('2008-11-02T12:00:00Z');assert.deepEqual((await f.h2h()).events.items.map(e=>e.id),['nov1-return']);assert.deepEqual((await f.h2h()).upcoming.items.map(e=>e.id),['nov2-first','nov2-stable']);
  f.sqlite.exec("UPDATE source_events SET status='FINAL'");assert.deepEqual(await allMeetings(f,'events'),['nov2-stable','nov2-first','nov1-return']);
 }finally{f.close();}
});

test('public-only historical detail revalidates its original readable anchor without granting private or own-match scope',async()=>{
 const f=fixture();try{
  const current=f.event('current',{project:true});f.insert('source_event_teams',{source_team_id:HOME,source_event_id:current.source,side:'home'});
  f.event('historical-public',{day:'2024-10-12',home:AWAY,away:HOME});f.event('other-historical-public',{day:'2023-10-12'});f.event('unrelated-public',{day:'2024-10-12',away:'gotsport/public/3'});f.event('conditional-public',{day:'2024-10-12',conditional:1});
  const first=(await f.reads.match(INPUT,'current',{tab:'h2h'})).data.h2h.events.items.find(row=>row.id==='historical-public');
  assert.deepEqual(first.historical_context,{anchor_event_id:'current',team_id:'team',team_season_id:'season'});assert.equal(first.team_season_id,null);
  const historical=(await f.reads.match(INPUT,first.id,{h2h_anchor:first.historical_context.anchor_event_id})).data;
  assert.equal(historical.event.id,first.id);assert.equal(historical.event.own_match,false);assert.equal(historical.event.own_side,'away');assert.equal(historical.attendance,null);assert.equal(historical.capabilities.can_edit,false);assert.equal(historical.capabilities.can_coach,false);assert.equal(historical.h2h.perspective,HOME);
  assert.equal(historical.h2h.events.items.find(row=>row.id==='other-historical-public').historical_context.anchor_event_id,'current','historical navigation keeps the original readable anchor');
  for(const id of ['unrelated-public','conditional-public'])await assert.rejects(f.reads.match(INPUT,id,{h2h_anchor:'current'}),error=>error.code==='not_found');
  const viewer=new FeatureReads(f.db,{owner:false,teamId:'team',categories:['matches']},f.options);assert.equal((await viewer.match(INPUT,first.id,{h2h_anchor:'current'})).data.event.id,first.id);
  f.sqlite.exec('UPDATE team_source_attachments SET active=0');await assert.rejects(viewer.match(INPUT,first.id,{h2h_anchor:'current'}),error=>error.code==='not_found','stale published owned row cannot keep detached anchor access');
 }finally{f.close();}
});

test('dense midnight-fold edges repair before LIMIT and the range end includes only the intended local day',async()=>{
 const f=fixture({zone:'America/St_Johns',at:'2008-11-01T12:00:00Z'});try{
  for(let i=0;i<6;i++)f.event('premature-'+i,{starts:'2008-11-02T02:30:00Z',status:'SCHEDULED',hs:null,as:null});
  for(let i=0;i<6;i++)f.event('returned-'+i,{starts:'2008-11-02T02:45:00Z',status:'SCHEDULED',hs:null,as:null});
  f.event('stable',{starts:'2008-11-02T03:30:00Z',status:'SCHEDULED',hs:null,as:null});
  assert.deepEqual(await allMeetings(f,'upcoming'),[...Array.from({length:6},(_,i)=>'returned-'+i),...Array.from({length:6},(_,i)=>'premature-'+i),'stable']);
  assert.deepEqual((await f.h2h({range:'year'})).upcoming.items.map(e=>e.id),Array.from({length:6},(_,i)=>'returned-'+i));
  f.sqlite.exec("UPDATE source_events SET status='FINAL'");assert.deepEqual(await allMeetings(f,'events'),['stable',...Array.from({length:6},(_,i)=>'premature-'+(5-i)),...Array.from({length:6},(_,i)=>'returned-'+(5-i))]);
 }finally{f.close();}
});
