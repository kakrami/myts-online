import test from 'node:test';
import assert from 'node:assert/strict';
import {freshHarness} from './fresh-harness.js';
import {materializationHarness} from './fixtures/connection-materialization-harness.mjs';
import {eventPresentation} from '../src/domain/presentation.js';

// Full local Workerd/D1 installation and real owner HTTP reads. Synthetic saved
// projections have no source attachment or background/provider work to execute.
test('native owner Schedule API orders and paginates Past, Upcoming, Day and Analyzed',async()=>{
  const h=await freshHarness();try {
    await h.initialize();
    const now=new Date(),at=now.toISOString(),year=now.getUTCFullYear()-(now.getUTCMonth()<5?1:0);
    const day=offset=>new Date(now.valueOf()+offset*86400000).toISOString().slice(0,10);
    const team='schedule-team',season='schedule-season',run='schedule-run',scope={team_id:team,team_season_id:season};
    const insert=(table,row)=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row));
    await h.db.batch([
      insert('app_teams',{id:team,name:'Synthetic Schedule team',timezone:'UTC',season_year:year,created_at:at}),
      insert('team_seasons',{id:season,app_team_id:team,year,start_day:`${year}-06-01`,end_day:`${year+1}-06-01`,start_at:`${year}-06-01T00:00:00Z`,end_at:`${year+1}-06-01T00:00:00Z`,include_june:0}),
      insert('team_read_state',{app_team_id:team,content_revision:1,status_revision:1,pending:0}),
      insert('team_projection_runs',{id:run,app_team_id:team,team_season_id:season,input_revision:1,state:'published',created_at:at}),
      insert('team_projection_state',{team_season_id:season,app_team_id:team,published_run_id:run,pending:0}),
    ]);
    const events=[['past-old',-3,'12'],['past-early',-2,'08'],['past-a',-2,'18'],['past-b',-2,'18'],['next-a',2,'08'],['next-b',2,'08'],['next-late',2,'18'],['next-last',3,'12'],['past-tbd',-2,null],['next-tbd',2,null],['undated-a',null,null],['undated-b',null,null]];
    for(const [id,offset,hour] of events) {
      const source='gotsport/public/schedule-'+id,local_day=offset===null?null:day(offset),starts_at=hour?`${local_day}T${hour}:00:00.000Z`:null;
      await h.db.batch([
        insert('events',{id,created_at:at}),
        insert('source_events',{id:source,provider:'gotsport',scope:'public',native_id:id,starts_at,local_day,time_precision:starts_at?'instant':local_day?'day':'pending',type:'game',status:'SCHEDULED',conditional:0,home_label:'Us',away_label:'Them',title:id,venue:'Synthetic field',evidence:'{}',content_hash:id,observed_at:at}),
        insert('team_event_rows',{run_id:run,app_team_id:team,team_season_id:season,event_id:id,starts_at,local_day,type:'game',status:'SCHEDULED',conditional:0,own_side:'home',home_name:'Us',away_name:'Them',title:id,venue:'Synthetic field',source_ids:JSON.stringify([source]),schedule_source_id:source,result_source_id:source}),
      ]);
    }
    for(const id of ['past-old','past-b','past-tbd'])await h.db.batch([insert('match_analysis',{app_team_id:team,team_season_id:season,event_id:id,active_run:'analysis-'+id,state:'ready',source_revision:1,mutation_revision:0,projected_at:at,player_count:0,unresolved_goals:0,unresolved_assists:0,tracking_complete:0,over_capacity:0,evidence:'{}',input_hash:id})]);
    async function request(input) {return h.request('/api/schedule?'+new URLSearchParams({...scope,...input}));}
    async function read(input) {const result=await request(input);assert.equal(result.status,200,JSON.stringify(result.data));return result.data;}
    async function pages(input) {
      const ids=[],cursors=new Set();let cursor=null,total=null;
      do {
        const page=await read({...input,limit:1,...cursor?{cursor}:{}});total??=page.data.total;
        assert.equal(page.data.total,total);assert.ok(page.data.items.length<=1);
        ids.push(...page.data.items.map(row=>row.id));cursor=page.data.next_cursor;
        assert.ok(!cursor||!cursors.has(cursor),'native cursor must advance');
        if(cursor)cursors.add(cursor);assert.ok(ids.length<=total,'native cursor must not repeat rows');
      }while(cursor);
      assert.equal(new Set(ids).size,total);assert.equal(ids.length,total);return ids;
    }
    const first=await read({period:'past',limit:1});assert.equal(first.selection.direction,'desc');
    assert.deepEqual(first.data.items.map(row=>row.id),['past-b']);
    assert.deepEqual(await pages({period:'past'}),['past-b','past-a','past-early','past-tbd','past-old']);
    assert.deepEqual(await pages({period:'upcoming'}),['next-a','next-b','next-late','next-tbd','next-last','undated-a','undated-b']);
    assert.deepEqual(await pages({mode:'day',date:day(-2),period:'all'}),['past-early','past-a','past-b','past-tbd']);
    assert.deepEqual(await pages({type:'analyzed',period:'all'}),['past-b','past-tbd','past-old']);
    assert.deepEqual(await pages({period:'past',direction:'asc'}),['past-old','past-early','past-a','past-b','past-tbd']);
    assert.deepEqual(await pages({period:'upcoming',direction:'desc'}),['next-last','next-late','next-b','next-a','next-tbd','undated-b','undated-a']);
    for(const input of [{period:'past',direction:'asc'},{period:'upcoming'},{period:'past',type:'games'}]) {
      const rejected=await request({...input,limit:1,cursor:first.data.next_cursor});
      assert.equal(rejected.status,400,JSON.stringify(rejected.data));assert.equal(rejected.data.error.code,'cursor_selection');
    }
    const counters=await h.mf.getKVNamespace('COUNTERS','provider');assert.equal(await counters.get('counts'),null,'Schedule reads do not invoke a provider');
    console.log(JSON.stringify({native_schedule_order:'PASS',owner_http:true,projected_events:events.length,page_limit:1,past:'desc',upcoming:'asc',day:'asc',analyzed:'desc',explicit_direction:true,known_before_tbd:true,undated_last:true,selection_bound_cursors:true,provider_requests:0}));
  }finally{await h.dispose();}
});

test('native Schedule midnight rollback repair stays within the unchanged owner HTTP budget and agrees with calendar dots',async()=>{
  const h=await materializationHarness();try {
    await h.initialize();
    const at=new Date().toISOString(),team={id:'schedule-fold-team',name:'Synthetic timezone team',timezone:'America/St_Johns',season_year:2008,created_at:at},season={id:'schedule-fold-season',app_team_id:team.id,year:2008,start_day:'2008-06-01',end_day:'2009-06-01',start_at:'2008-06-01T02:30:00.000Z',end_at:'2009-06-01T02:30:00.000Z',include_june:0},run='schedule-fold-run';
    const insert=(table,row)=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row));
    await h.db.batch([insert('app_teams',team),insert('team_seasons',season),insert('team_read_state',{app_team_id:team.id,content_revision:1,status_revision:1,pending:0}),insert('team_projection_runs',{id:run,app_team_id:team.id,team_season_id:season.id,input_revision:1,state:'published',created_at:at}),insert('team_projection_state',{team_season_id:season.id,app_team_id:team.id,published_run_id:run,pending:0})]);
    const rows=[];
    for(let i=0;i<4;i++)for(const [prefix,starts_at] of [['premature','2008-11-02T02:30:00.000Z'],['returned','2008-11-02T02:45:00.000Z'],['stable','2008-11-02T03:30:00.000Z']])rows.push({id:'fold-'+prefix+'-'+i,starts_at,local_day:'2008-11-02'});
    rows.push({id:'fold-nov1-tbd',starts_at:null,local_day:'2008-11-01'},{id:'fold-nov2-tbd',starts_at:null,local_day:'2008-11-02'},{id:'fold-undated',starts_at:null,local_day:null},{id:'plain-known',starts_at:'2008-10-01T15:00:00.000Z',local_day:'2008-10-01'});
    for(const row of rows) {
      const source={...row,id:'gotsport/public/'+row.id,provider:'gotsport',scope:'public',native_id:row.id,time_precision:row.starts_at?'instant':row.local_day?'day':'pending',type:'game',status:'FINAL',conditional:0,home_label:'Us',away_label:'Them',home_score:null,away_score:null,title:row.id,venue:'Synthetic field',evidence:'{}',content_hash:row.id,observed_at:at};
      // Use the production projector's presentation boundary. Timed source day
      // metadata is normalized to the team's local date before publication.
      const projected=eventPresentation(team,season,row.id,[{...source,own_side:'home'}]);assert.ok(projected);
      await h.db.batch([insert('events',{id:row.id,created_at:at}),insert('source_events',source),insert('team_event_rows',{run_id:run,...projected})]);
    }
    const scope={team_id:team.id,team_season_id:season.id},budgets=[];
    async function request(input,path='/api/schedule') {const response=await h.request(path+'?'+new URLSearchParams({...scope,...input}));assert.equal(response.status,200,JSON.stringify(response.data));assert.ok(response.statements>0&&response.statements<=48,'unchanged owner route budget: '+response.statements);budgets.push(response.statements);return response;}
    async function pages(direction) {
      const ids=[];let cursor=null;
      do {const response=await request({period:'past',direction,search:'fold-',limit:1,...cursor?{cursor}:{}}),page=response.data.data;ids.push(...page.items.map(row=>row.id));cursor=page.next_cursor;assert.ok(ids.length<=15);}while(cursor);
      assert.equal(new Set(ids).size,15);return ids;
    }
    const ascending=[...Array.from({length:4},(_,i)=>'fold-returned-'+i),'fold-nov1-tbd',...Array.from({length:4},(_,i)=>'fold-premature-'+i),...Array.from({length:4},(_,i)=>'fold-stable-'+i),'fold-nov2-tbd','fold-undated'];
    const descending=[...Array.from({length:4},(_,i)=>'fold-stable-'+(3-i)),...Array.from({length:4},(_,i)=>'fold-premature-'+(3-i)),'fold-nov2-tbd',...Array.from({length:4},(_,i)=>'fold-returned-'+(3-i)),'fold-nov1-tbd','fold-undated'];
    assert.deepEqual(await pages('asc'),ascending);assert.deepEqual(await pages('desc'),descending);
    const plain=await request({period:'past',direction:'asc',search:'plain-',limit:1}),fold=await request({period:'past',direction:'asc',search:'fold-',limit:1});
    assert.equal(fold.statements,plain.statements+1,'the measured route accounts for the optional transition repair requery');
    const calendar=(await request({period:'all',from:'2008-11-01',to:'2008-11-03'},'/api/calendar')).data.data.days;
    for(const day of calendar) {const page=(await request({mode:'day',date:day.day,period:'all'})).data.data;assert.equal(page.total,day.total);assert.ok(page.items.every(row=>row.local_day===day.day));}
    assert.deepEqual(calendar.map(({day,total})=>({day,total})),[{day:'2008-11-01',total:5},{day:'2008-11-02',total:9}]);
    assert.equal((await h.provider()).calls.length,0,'all acceptance reads use saved projections');
    console.log(JSON.stringify({native_schedule_local_day_order:'PASS',owner_http:true,source_fingerprint:h.sourceFingerprint,projected_events:rows.length,page_limit:1,midnight_rollback:true,calendar_day_agreement:true,ordinary_http_statements:plain.statements,repair_http_statements:fold.statements,max_http_statements:Math.max(...budgets),provider_requests:0}));
  }finally{await h.dispose();}
});
