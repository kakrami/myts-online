import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonYearForDay,observedDay,datedPeriodYears,resolveEventDate,qualifiedRosterPeriod} from '../src/domain/connection-evidence.js';
const event=(id,local_day,provider='teamsnap')=>({id,provider,local_day,starts_at:null});
test('June calendar boundary uses the actual team-local day and retains date-only values',()=>{
 assert.equal(seasonYearForDay('2026-05-31'),2025);assert.equal(seasonYearForDay('2026-06-01'),2026);
 assert.equal(observedDay({starts_at:'2026-06-01T06:30:00Z'},'America/Los_Angeles'),'2026-05-31');
 assert.equal(observedDay({starts_at:'2026-06-01T07:30:00Z'},'America/Los_Angeles'),'2026-06-01');
 assert.equal(observedDay({local_day:'2026-06-01'},'Pacific/Honolulu'),'2026-06-01');
 assert.equal(observedDay({local_day:'2026-02-30'},'UTC'),null);
});
test('verified dated periods split June-May; labels and malformed ranges do not invent years',()=>{
 assert.deepEqual(datedPeriodYears('2025-05-31','2026-06-01'),[2024,2025,2026]);
 for(const text of ['2025–2026','Spring 2026','2026','Archived',''])assert.deepEqual(datedPeriodYears(text),[]);
 assert.deepEqual(datedPeriodYears('2026-06-01','2026-05-31'),[]);
});
test('unknown events remain pending unless one verified period supports their season',()=>{
 const sources=[event('unknown',null)];
 assert.equal(resolveEventDate({timezone:'UTC',sources}).year,null);
 assert.equal(resolveEventDate({timezone:'UTC',sources,verifiedYears:[2024]}).year,2024);
 assert.equal(resolveEventDate({timezone:'UTC',sources,verifiedYears:[2024]}).day,null);
 assert.equal(resolveEventDate({timezone:'UTC',sources,verifiedYears:[2024,2025]}).state,'conflict');
});
test('cross-season disagreement retains accepted membership and date together',()=>{
 const sources=[event('a','2025-05-31','gotsport'),event('b','2025-06-01')],previous={team_season_id:'season',year:2024,effective_day:'2025-05-31',starts_at:null,local_day:'2025-05-31'};
 const result=resolveEventDate({timezone:'UTC',sources,previous});
 assert.equal(result.state,'conflict');assert.equal(result.year,2024);assert.equal(result.day,'2025-05-31');assert.equal(result.local_day,'2025-05-31');
 const first=resolveEventDate({timezone:'UTC',sources});assert.equal(first.state,'conflict');assert.equal(first.year,null);
});
test('explicit owner date wins over old timestamps and conflicting provider dates',()=>{
 const sources=[{...event('a','2025-05-31'),starts_at:'2025-05-31T12:00:00Z'},event('b','2025-06-01','gotsport')];
 const result=resolveEventDate({timezone:'UTC',sources,fields:{local_day:'2026-06-03'}});
 assert.equal(result.state,'resolved');assert.equal(result.year,2026);assert.equal(result.day,'2026-06-03');assert.equal(result.starts_at,null);assert.equal(result.basis,'owner');
});

test('contradictory native periods preserve the accepted undated membership without a made-up day',()=>{
 const previous={team_season_id:'saved',year:2024,effective_day:null,starts_at:null,local_day:null};
 const result=resolveEventDate({timezone:'UTC',sources:[event('a',null)],previous,verifiedYears:[2024,2025]});
 assert.equal(result.state,'conflict');assert.equal(result.year,2024);assert.equal(result.day,null);assert.equal(result.basis,'accepted_conflict');
});

test('roster periods require explicit member dates or one verified native season',()=>{
 assert.deepEqual(qualifiedRosterPeriod({},{}),{years:[],start:null,end:null});
 assert.deepEqual(qualifiedRosterPeriod({},{season_start_date:'2024-07-01',season_end_date:'2027-05-31'}),{years:[],start:null,end:null});
 assert.deepEqual(qualifiedRosterPeriod({},{season_start_date:'2024-07-01',season_end_date:'2025-05-31'}),{years:[2024],start:'2024-07-01',end:'2025-05-31'});
 assert.deepEqual(qualifiedRosterPeriod({roster_start_date:'2026-05-31',roster_end_date:'2026-06-01'},{season_start_date:'2024-07-01',season_end_date:'2025-05-31'}),{years:[2025,2026],start:'2026-05-31',end:'2026-06-01'});
});
