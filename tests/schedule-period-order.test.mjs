import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadRepository} from '../src/read-model/repository.js';
import {eventPresentation} from '../src/domain/presentation.js';
import {fixture,AT,INPUT} from './fixtures/head-to-head-harness.mjs';

function scheduleFixture(options) {
  const f=fixture(options),repo=new ReadRepository(f.db,{owner:true},f.options);
  return {...f,repo,
    event(id,options={}){return f.event(id,{project:true,status:'SCHEDULED',hs:null,as:null,...options});},
    schedule(input={},options={}){return repo.schedule({...INPUT,...input},options);},
    analyzed(id,state='ready',season='season') {
      f.insert('match_analysis',{app_team_id:'team',team_season_id:season,event_id:id,active_run:'analysis-'+id,state,source_revision:1,mutation_revision:0,projected_at:AT,player_count:0,unresolved_goals:0,unresolved_assists:0,tracking_complete:0,over_capacity:0,evidence:'{}',input_hash:id});
    },
  };
}

async function allSchedule(f,input,{limit=1}={}) {
  const ids=[],cursors=new Set();let cursor=null,total=null;
  do {
    const page=await f.schedule(input,{limit,cursor});
    total??=page.data.total;
    assert.equal(page.data.total,total,'a continuation retains the selected total');
    assert.ok(page.data.items.length<=limit,'each response respects its page bound');
    ids.push(...page.data.items.map(row=>row.id));
    cursor=page.data.next_cursor;
    assert.ok(!cursor||!cursors.has(cursor),'a keyset continuation must make progress');
    if(cursor)cursors.add(cursor);
    assert.ok(ids.length<=total,'a continuation must not repeat an event');
  }while(cursor);
  assert.equal(ids.length,total,'all selected events are reachable');
  assert.equal(new Set(ids).size,total,'events occur exactly once across pages');
  return ids;
}

test('Schedule Past defaults to newest-first on the server and across page boundaries',async()=>{
  const f=scheduleFixture();try {
    for(const [id,day] of [['oldest','2026-08-01'],['middle','2026-09-01'],['newest','2026-10-01']])f.event(id,{day,starts:day+'T18:00:00Z'});
    f.event('future',{day:'2026-10-20',starts:'2026-10-20T18:00:00Z'});
    const first=await f.schedule({period:'past'},{limit:1});
    assert.equal(first.selection.direction,'desc');
    assert.deepEqual(first.data.items.map(row=>row.id),['newest']);
    assert.deepEqual(await allSchedule(f,{period:'past'}),['newest','middle','oldest']);
  }finally{f.close();}
});

test('Schedule Upcoming defaults to oldest-first on the server and across page boundaries',async()=>{
  const f=scheduleFixture();try {
    for(const [id,day] of [['last','2026-11-01'],['next','2026-10-13'],['middle','2026-10-20']])f.event(id,{day,starts:day+'T18:00:00Z'});
    f.event('past',{day:'2026-10-01',starts:'2026-10-01T18:00:00Z'});
    assert.equal((await f.schedule({period:'upcoming'})).selection.direction,'asc');
    assert.deepEqual(await allSchedule(f,{period:'upcoming'}),['next','middle','last']);
  }finally{f.close();}
});

test('Schedule Day defaults to chronological order even when the supplied period is Past',async()=>{
  const f=scheduleFixture({zone:'America/Los_Angeles'});try {
    // Both instants are October 11 locally; the later kickoff is October 12 UTC.
    f.event('late',{day:'2026-10-11',starts:'2026-10-12T01:00:00Z'});
    f.event('early',{day:'2026-10-11',starts:'2026-10-11T17:00:00Z'});
    f.event('other-day',{day:'2026-10-10',starts:'2026-10-10T18:00:00Z'});
    for(const period of ['all','past']) {
      const input={mode:'day',date:'2026-10-11',period};
      assert.equal((await f.schedule(input)).selection.direction,'asc');
      assert.deepEqual(await allSchedule(f,input),['early','late']);
    }
  }finally{f.close();}
});

test('Schedule Analyzed with period All defaults to newest-first without broadening eligibility',async()=>{
  const f=scheduleFixture();try {
    for(const [id,day,state] of [['old-ready','2026-08-01','ready'],['recent-estimated','2026-10-01','estimated'],['new-pending','2026-10-05','pending']]) {
      f.event(id,{day,starts:day+'T18:00:00Z'});f.analyzed(id,state);
    }
    f.event('unpublished',{day:'2026-10-07',starts:'2026-10-07T18:00:00Z'});
    const input={type:'analyzed',period:'all'};
    assert.equal((await f.schedule(input)).selection.direction,'desc');
    assert.deepEqual(await allSchedule(f,input),['recent-estimated','old-ready']);
  }finally{f.close();}
});

test('Schedule respects explicit API direction overrides for Past, Upcoming, Day and Analyzed',async()=>{
  const f=scheduleFixture();try {
    for(const [id,day,time] of [['past-early','2026-10-01','10'],['past-late','2026-10-01','18'],['next-early','2026-10-20','10'],['next-late','2026-10-20','18']]) {
      f.event(id,{day,starts:`${day}T${time}:00:00Z`});f.analyzed(id);
    }
    for(const [input,expected] of [
      [{period:'past',direction:'asc'},['past-early','past-late']],
      [{period:'upcoming',direction:'desc'},['next-late','next-early']],
      [{mode:'day',date:'2026-10-01',period:'all',direction:'desc'},['past-late','past-early']],
      [{type:'analyzed',period:'all',direction:'asc'},['past-early','past-late','next-early','next-late']],
    ]) {
      assert.equal((await f.schedule(input)).selection.direction,input.direction);
      assert.deepEqual(await allSchedule(f,input),expected);
    }
  }finally{f.close();}
});

test('Schedule historical Seasons resolve an Upcoming preference to Past without affecting Day mode',async()=>{
  const f=scheduleFixture();try {
    for(const [id,time] of [['history-late','18'],['history-early','10']])f.event(id,{season:'history',day:'2025-10-01',starts:`2025-10-01T${time}:00:00Z`});
    const input={team_season_id:'history',period:'upcoming'},page=await f.schedule(input);
    assert.equal(page.selection.period,'past');assert.equal(page.selection.direction,'desc');
    assert.equal(input.period,'upcoming','the caller retains its preferred period for a current-season return');
    assert.deepEqual(await allSchedule(f,input),['history-late','history-early']);
    assert.deepEqual(await allSchedule(f,{...input,direction:'asc'}),['history-early','history-late']);
    const day={...input,mode:'day',date:'2025-10-01',period:'all'},dayPage=await f.schedule(day);
    assert.equal(dayPage.selection.period,'all');assert.equal(dayPage.selection.direction,'asc');
    assert.deepEqual(await allSchedule(f,day),['history-early','history-late']);
    const current=await f.schedule({period:input.period});
    assert.equal(current.selection.period,'upcoming');assert.equal(current.selection.direction,'asc');
  }finally{f.close();}
});

test('Schedule Analyzed resolves stale period preferences to All in current and historical Seasons',async()=>{
  const f=scheduleFixture();try {
    for(const [id,season,day] of [['current-old','season','2026-08-01'],['current-new','season','2026-10-01'],['history-old','history','2025-08-01'],['history-new','history','2025-10-01']]) {
      f.event(id,{season,day,starts:day+'T18:00:00Z'});f.analyzed(id,'ready',season);
    }
    for(const [season,prefix] of [['season','current'],['history','history']]) {
      const input={team_season_id:season,type:'analyzed',period:'upcoming'},page=await f.schedule(input);
      assert.equal(page.selection.period,'all');assert.equal(page.selection.direction,'desc');
      assert.deepEqual(await allSchedule(f,input),[prefix+'-new',prefix+'-old']);
    }
  }finally{f.close();}
});

test('Schedule equal timestamps use the stable ID keyset in each selected direction',async()=>{
  const f=scheduleFixture();try {
    for(const id of ['d','a','e','b','c']) {
      f.event('past-'+id,{day:'2026-10-01',starts:'2026-10-01T18:00:00Z'});
      f.event('next-'+id,{day:'2026-10-20',starts:'2026-10-20T18:00:00Z'});
    }
    assert.deepEqual(await allSchedule(f,{period:'past'},{limit:2}),['past-e','past-d','past-c','past-b','past-a']);
    assert.deepEqual(await allSchedule(f,{period:'upcoming'},{limit:2}),['next-a','next-b','next-c','next-d','next-e']);
    assert.deepEqual(await allSchedule(f,{period:'past',direction:'asc'},{limit:2}),['past-a','past-b','past-c','past-d','past-e']);
  }finally{f.close();}
});

test('Schedule cursors bind the derived direction and every changed selection filter',async()=>{
  const f=scheduleFixture();try {
    for(const id of ['a','b','c'])f.event(id,{day:'2026-10-01',starts:'2026-10-01T18:00:00Z'});
    const input={period:'past'},first=await f.schedule(input,{limit:1}),cursor=first.data.next_cursor;
    assert.ok(cursor);
    // Derived desc and an explicit desc describe the same server selection.
    const second=await f.schedule({...input,direction:'desc'},{limit:1,cursor});
    assert.deepEqual(second.data.items.map(row=>row.id),['b']);
    for(const change of [{direction:'asc'},{period:'upcoming'},{type:'games'},{mode:'day'},{date:'2026-10-01'},{search:'Home'}]) {
      await assert.rejects(f.schedule({...input,...change},{limit:1,cursor}),error=>error.code==='cursor_selection',JSON.stringify(change));
    }
  }finally{f.close();}
});

test('Schedule ordering repair leaves period classification and unknown statuses unchanged',async()=>{
  const f=scheduleFixture({zone:'America/Los_Angeles',at:'2026-10-13T01:00:00Z'});try {
    const rows=[
      ['elapsed-live','2026-10-12','2026-10-12T23:00:00Z','LIVE'],
      ['future-interrupted','2026-10-12','2026-10-13T03:00:00Z','INTERRUPTED'],
      ['future-final','2026-10-20','2026-10-20T18:00:00Z','FINAL'],
      ['future-completed','2026-10-20','2026-10-20T18:00:00Z','COMPLETED'],
      ['future-cancelled','2026-10-20','2026-10-20T18:00:00Z','CANCELLED'],
      ['past-postponed','2026-10-11',null,'POSTPONED'],
      ['today-rescheduled','2026-10-12',null,'RESCHEDULED'],
      ['undated-unknown',null,null,'UNKNOWN'],
    ];
    for(const [id,day,starts,status] of rows)f.event(id,{day,starts,status});
    assert.deepEqual(new Set(await allSchedule(f,{period:'past'})),new Set(['elapsed-live','future-final','future-completed','future-cancelled','past-postponed']));
    assert.deepEqual(new Set(await allSchedule(f,{period:'upcoming'})),new Set(['future-interrupted','today-rescheduled','undated-unknown']));
    const all=await f.schedule({period:'all'});
    assert.deepEqual(Object.fromEntries(all.data.items.map(row=>[row.id,row.status])),Object.fromEntries(rows.map(([id,,,status])=>[id,status])));
    assert.equal(all.data.items.find(row=>row.id==='undated-unknown').starts_at,null);
    assert.equal(all.data.items.find(row=>row.id==='undated-unknown').local_day,null);
  }finally{f.close();}
});

// Verbatim comparator and period wrapper from original-ui.html lines 1391–1397.
// These small adapters supply the original date/time inputs independently of
// the repository's SQL order and timezone adapter. IDs only break original ties.
function originalScheduleOrder(rows,zone,descending=false) {
  const localEventDay=value=>{
    if(!value)return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const matchTime=item=>item.starts?'known':'TBD',parseDate=value=>value?new Date(value):null;
  function scheduleCompare(a,b,descending=false){const ad=localEventDay(a.date),bd=localEventDay(b.date),direction=descending?-1:1;if(!ad||!bd)return ad?-1:bd?1:0;if(ad!==bd)return ad.localeCompare(bd)*direction;const pendingA=matchTime(a)==='TBD',pendingB=matchTime(b)==='TBD';if(pendingA!==pendingB)return pendingA?1:-1;if(pendingA)return 0;return ((parseDate(a.date)?.getTime()||0)-(parseDate(b.date)?.getTime()||0))*direction}
  function periodCompare(period){return period==='past'?(a,b)=>scheduleCompare(a,b,true):scheduleCompare}
  const compare=periodCompare(descending?'past':'upcoming'),sign=descending?-1:1;
  return rows.map(row=>({...row,date:row.starts||row.day})).sort((a,b)=>compare(a,b)||(a.id<b.id?-1:a.id>b.id?1:0)*sign).map(row=>row.id);
}

const mixedRows=()=>[
  {id:'first-day-tbd',day:'2026-10-19',starts:null},
  {id:'same-tbd-b',day:'2026-10-20',starts:null},
  {id:'same-late-b',day:'2026-10-20',starts:'2026-10-20T18:00:00.000Z'},
  {id:'undated-b',day:null,starts:null},
  {id:'same-early',day:'2026-10-20',starts:'2026-10-20T08:00:00.000Z'},
  {id:'same-late-a',day:'2026-10-20',starts:'2026-10-20T18:00:00.000Z'},
  {id:'same-tbd-a',day:'2026-10-20',starts:null},
  {id:'last-day-known',day:'2026-10-21',starts:'2026-10-21T08:00:00.000Z'},
  {id:'undated-a',day:null,starts:null},
];

test('original mixed-time comparator keeps known kickoffs before TBD and undated last in every Schedule direction',async()=>{
  const f=scheduleFixture(),rows=mixedRows();try {
    for(const row of rows){f.event(row.id,row);f.analyzed(row.id);}
    const ascending=['first-day-tbd','same-early','same-late-a','same-late-b','same-tbd-a','same-tbd-b','last-day-known','undated-a','undated-b'];
    const descending=['last-day-known','same-late-b','same-late-a','same-early','same-tbd-b','same-tbd-a','first-day-tbd','undated-b','undated-a'];
    assert.deepEqual(originalScheduleOrder(rows,'UTC'),ascending);assert.deepEqual(originalScheduleOrder(rows,'UTC',true),descending);
    for(const limit of [1,2,4]) {
      assert.deepEqual(await allSchedule(f,{period:'upcoming'},{limit}),ascending);
      assert.deepEqual(await allSchedule(f,{period:'upcoming',direction:'desc'},{limit}),descending);
      assert.deepEqual(await allSchedule(f,{type:'analyzed',period:'all'},{limit}),descending);
      assert.deepEqual(await allSchedule(f,{type:'analyzed',direction:'asc'},{limit}),ascending);
    }
    f.sqlite.exec("UPDATE team_event_rows SET status='FINAL';UPDATE team_read_state SET content_revision=content_revision+1");
    assert.deepEqual(await allSchedule(f,{period:'past'}),descending);
    assert.deepEqual(await allSchedule(f,{period:'past',direction:'asc'}),ascending);
    assert.deepEqual(await allSchedule(f,{mode:'day',date:'2026-10-20',period:'all'}),ascending.filter(id=>id.startsWith('same-')));
    assert.deepEqual(await allSchedule(f,{mode:'day',date:'2026-10-20',period:'all',direction:'desc'}),descending.filter(id=>id.startsWith('same-')));
  }finally{f.close();}
});

test('Schedule local-day order and Day membership derive known kickoffs from the team timezone',async()=>{
  const zone='America/Los_Angeles',f=scheduleFixture({zone}),rows=[
    {id:'today-early',day:'2026-10-20',starts:'2026-10-20T17:00:00.000Z'},
    {id:'today-late',day:'2026-10-21',starts:'2026-10-21T01:00:00.000Z'},
    {id:'today-tbd',day:'2026-10-20',starts:null},
    {id:'tomorrow-known',day:'2026-10-20',starts:'2026-10-21T18:00:00.000Z'},
    {id:'tomorrow-tbd',day:'2026-10-21',starts:null},
    {id:'undated',day:null,starts:null},
  ];try {
    for(const row of rows)f.event(row.id,row);
    for(const direction of ['asc','desc'])assert.deepEqual(await allSchedule(f,{period:'all',direction}),originalScheduleOrder(rows,zone,direction==='desc'));
    assert.deepEqual(await allSchedule(f,{mode:'day',date:'2026-10-20',period:'all'}),['today-early','today-late','today-tbd']);
    assert.deepEqual(await allSchedule(f,{mode:'day',date:'2026-10-20',period:'all',direction:'desc'}),['today-late','today-early','today-tbd']);
    assert.deepEqual(await allSchedule(f,{mode:'day',date:'2026-10-21',period:'all'}),['tomorrow-known','tomorrow-tbd']);
    const all=await f.schedule({period:'all'});assert.equal(all.data.items.find(row=>row.id==='today-late').local_day,'2026-10-21','ordering must not rewrite saved membership metadata');
  }finally{f.close();}
});

test('Schedule matches the original through DST gaps, repeated local times, and a skipped date',async()=>{
  for(const [zone,rows] of [
    ['America/Los_Angeles',[
      {id:'spring-before',starts:'2026-03-08T09:59:00.000Z',day:'2026-03-08'},
      {id:'spring-after',starts:'2026-03-08T10:01:00.000Z',day:'2026-03-08'},
      {id:'spring-tbd',starts:null,day:'2026-03-08'},
      {id:'fall-first',starts:'2026-11-01T08:30:00.000Z',day:'2026-11-01'},
      {id:'fall-second-a',starts:'2026-11-01T09:30:00.000Z',day:'2026-11-01'},
      {id:'fall-second-b',starts:'2026-11-01T09:30:00.000Z',day:'2026-11-01'},
      {id:'fall-tbd',starts:null,day:'2026-11-01'},
    ]],
    ['Pacific/Apia',[
      {id:'dec29-known',starts:'2011-12-30T09:30:00.000Z',day:null},
      {id:'dec29-tbd',starts:null,day:'2011-12-29'},
      {id:'skipped-date-tbd',starts:null,day:'2011-12-30'},
      {id:'dec31-known',starts:'2011-12-30T10:30:00.000Z',day:null},
      {id:'dec31-tbd',starts:null,day:'2011-12-31'},
    ]],
  ]) {
    const f=scheduleFixture({zone});try {
      for(const row of rows)f.event(row.id,row);
      for(const direction of ['asc','desc'])assert.deepEqual(await allSchedule(f,{period:'all',direction}),originalScheduleOrder(rows,zone,direction==='desc'),zone+' '+direction);
      if(zone==='Pacific/Apia')assert.deepEqual(await allSchedule(f,{mode:'day',date:'2011-12-30',period:'all'}),['skipped-date-tbd']);
    }finally{f.close();}
  }
});

test('Schedule repairs dense midnight rollbacks before LIMIT and seeks through each repeated local day',async()=>{
  const zone='America/St_Johns',f=scheduleFixture({zone}),rows=[];try {
    for(let i=0;i<7;i++)for(const [prefix,starts] of [['premature','2008-11-02T02:30:00.000Z'],['returned','2008-11-02T02:45:00.000Z'],['stable','2008-11-02T03:30:00.000Z']])rows.push({id:prefix+'-'+i,starts,day:'2008-11-02'});
    rows.push({id:'nov1-tbd',day:'2008-11-01',starts:null},{id:'nov2-tbd',day:'2008-11-02',starts:null},{id:'undated',day:null,starts:null});
    for(const row of rows)f.event(row.id,row);
    for(const direction of ['asc','desc'])for(const limit of [1,2,5,10])assert.deepEqual(await allSchedule(f,{period:'all',direction},{limit}),originalScheduleOrder(rows,zone,direction==='desc'),direction+' page '+limit);
    assert.deepEqual(await allSchedule(f,{mode:'day',date:'2008-11-01',period:'all'}),[...Array.from({length:7},(_,i)=>'returned-'+i),'nov1-tbd']);
    assert.deepEqual(await allSchedule(f,{mode:'day',date:'2008-11-02',period:'all'}),[...Array.from({length:7},(_,i)=>'premature-'+i),...Array.from({length:7},(_,i)=>'stable-'+i),'nov2-tbd']);
  }finally{f.close();}
});

test('Schedule freezes period membership through a cursor instead of losing a newly elapsed kickoff',async()=>{
  const f=scheduleFixture({at:'2026-10-12T12:00:00.000Z'});try {
    f.event('first',{starts:'2026-10-12T12:01:00.000Z',day:'2026-10-12'});f.event('second',{starts:'2026-10-12T12:02:00.000Z',day:'2026-10-12'});f.event('last',{starts:'2026-10-12T12:05:00.000Z',day:'2026-10-12'});
    const first=await f.schedule({period:'upcoming'},{limit:1});assert.deepEqual(first.data.items.map(row=>row.id),['first']);
    f.setNow('2026-10-12T12:03:00.000Z');
    const next=await f.schedule({period:'upcoming'},{limit:1,cursor:first.data.next_cursor});assert.equal(next.data.total,3);assert.deepEqual(next.data.items.map(row=>row.id),['second']);
    assert.deepEqual(await allSchedule(f,{period:'upcoming'}),['last'],'a fresh query uses the new cutoff');
  }finally{f.close();}
});

test('Schedule cursors reject the old order policy, other actors, revisions, and timezone changes',async()=>{
  const f=scheduleFixture();try {
    for(const row of mixedRows())f.event(row.id,row);
    const input={period:'upcoming'},first=await f.schedule(input,{limit:1}),cursor=first.data.next_cursor;
    const legacy=await f.options.cursor.issue({selection:first.selection,scope:'owner/team',revision:1,position:['2026-10-19','first-day-tbd']});
    await assert.rejects(f.schedule(input,{cursor:legacy}),error=>error.code==='cursor_selection');
    const viewer=new ReadRepository(f.db,{owner:false,teamId:'team'},f.options);
    await assert.rejects(viewer.schedule({...INPUT,...input},{cursor}),error=>error.code==='cursor_selection');
    f.sqlite.exec("UPDATE app_teams SET timezone='America/Los_Angeles'");
    await assert.rejects(f.schedule(input,{cursor}),error=>error.code==='cursor_selection');
    f.sqlite.exec("UPDATE app_teams SET timezone='UTC';UPDATE team_read_state SET content_revision=content_revision+1");
    await assert.rejects(f.schedule(input,{cursor}),error=>error.code==='cursor_restart');
  }finally{f.close();}
});

test('Schedule reads at most three limited streams and preserves June, scores, and unknown state',async()=>{
  const f=scheduleFixture({june:0});try {
    for(let i=0;i<205;i++)for(const kind of ['timed','dated','undated'])f.event(kind+'-'+String(i).padStart(3,'0'),{day:kind==='undated'?null:'2026-06-15',starts:kind==='timed'?'2026-06-15T18:00:00.000Z':null,status:'UNKNOWN',hs:null,as:null});
    const prepare=f.db.prepare,reads=[];
    f.db.prepare=(sql,params=[])=>{
      const statement=prepare(sql).bind(...params);
      return {...statement,bind(...values){return f.db.prepare(sql,values);},async all(){const result=await statement.all();if(sql.includes('UNION ALL'))reads.push({sql,params,rows:result.results.length});return result;}};
    };
    const page=await f.schedule({period:'all'},{limit:2});assert.equal(page.data.total,615);assert.equal(reads.length,1);assert.equal(reads[0].rows,9);assert.equal((reads[0].sql.match(/LIMIT \?/g)||[]).length,3);
    assert.ok(!reads[0].sql.includes('OFFSET'),'all three streams use strict keysets');
    assert.equal(page.data.items.length,2);for(const row of page.data.items){assert.equal(row.status,'UNKNOWN');assert.equal(row.home_score,null);assert.equal(row.away_score,null);assert.equal(row.local_day,'2026-06-15');}
    assert.deepEqual(page.data.items.map(row=>row.id),['timed-000','timed-001']);
  }finally{f.close();}
});

test('production event presentation publishes the same team-local date used by Schedule Day and calendar dots',async()=>{
  const f=scheduleFixture({zone:'America/Los_Angeles'});try {
    const team=f.sqlite.prepare("SELECT * FROM app_teams WHERE id='team'").get(),season=f.sqlite.prepare("SELECT * FROM team_seasons WHERE id='season'").get();
    for(const row of [
      {id:'early',starts:'2026-10-20T17:00:00.000Z',day:'2026-10-20'},
      {id:'late',starts:'2026-10-21T01:00:00.000Z',day:'2026-10-21'},
      {id:'today-tbd',starts:null,day:'2026-10-20'},
      {id:'tomorrow',starts:'2026-10-21T18:00:00.000Z',day:'2026-10-21'},
    ]) {
      const saved=f.event(row.id,{...row,project:false}),source=f.sqlite.prepare('SELECT * FROM source_events WHERE id=?').get(saved.source),projected=eventPresentation(team,season,row.id,[{...source,own_side:'home'}]);
      f.insert('team_event_rows',{run_id:'run-season',...projected});
    }
    const calendar=await f.repo.calendar({...INPUT,period:'all'},{from:'2026-10-20',to:'2026-10-22'});
    assert.deepEqual(calendar.data.days.map(({day,total})=>({day,total})),[{day:'2026-10-20',total:3},{day:'2026-10-21',total:1}]);
    for(const day of calendar.data.days) {
      const page=await f.schedule({mode:'day',date:day.day,period:'all'});assert.equal(page.data.total,day.total);assert.ok(page.data.items.every(row=>row.local_day===day.day));
    }
    assert.deepEqual(await allSchedule(f,{mode:'day',date:'2026-10-20',period:'all'}),['early','late','today-tbd']);
  }finally{f.close();}
});

test('Schedule checks content revision after its optional timezone repair requery',async()=>{
  const f=scheduleFixture({zone:'America/St_Johns'});try {
    f.event('premature',{starts:'2008-11-02T02:30:00.000Z',day:'2008-11-02'});f.event('returned',{starts:'2008-11-02T02:45:00.000Z',day:'2008-11-01'});
    const prepare=f.db.prepare;let repaired=false;
    f.db.prepare=(sql,params=[])=>{
      const statement=prepare(sql).bind(...params);
      return {...statement,bind(...values){return f.db.prepare(sql,values);},async all(){const result=await statement.all();if(sql.includes('ORDER BY CASE')){repaired=true;f.sqlite.exec('UPDATE team_read_state SET content_revision=content_revision+1');}return result;}};
    };
    await assert.rejects(f.schedule({period:'all'},{limit:1}),error=>error.code==='cursor_restart');assert.equal(repaired,true);
  }finally{f.close();}
});
