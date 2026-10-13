// Pinned, executable source oracle. This file does not import rebuild runtime code.
export const ORIGINAL_COACH_PROVENANCE = Object.freeze({
  version: "6.20.133",
  commit: "50e1be224806ff7e7c439d26e15fd0421e3f6f01",
  workerBlob: "bd2d055483abae37ddae2680ec62f6282da6680c",
  backend: { helpers: [851, 853, 875], positions: [5594, 5594], validation: [5602, 5604], profiles: [5606, 5606], identity: [5607, 5607], clockActions: [5608, 5628] },
  appHtml: { helpers: [487, 574, 2146], slots: [2232, 2245], coach: [2617, 2626], pregame: [2631, 2631], configurationActions: [2639, 2639] }
});

export const ORIGINAL_COACH_SOURCE = Object.freeze({
  "backend_helpers": "const clean = v => String(v ?? '').trim();\nclass ApiError extends Error { constructor(message,status=500,code='server_error'){super(message);this.status=status;this.code=code;} }\nfunction safeJsonParse(v,fallback={}){try{return JSON.parse(v||'');}catch{return fallback;}}",
  "backend_positions": "const COACH_POSITIONS=new Set(['GK','SW','LB','LWB','LCB','CB','RCB','RB','RWB','LM','LCM','CDM','CM','CAM','RCM','RM','LW','SS','CF','ST','RW']);",
  "backend_validation": "function coachSeason(v){const n=Number(v);if(!Number.isInteger(n)||n<2000||n>2100)throw new ApiError('Invalid season.',400);return n;}\nfunction coachAliases(v){if(!Array.isArray(v)||!v.length||v.length>3)throw new ApiError('Select a game.',400);const out=[...new Set(v.map(clean))];if(out.some(x=>!(/^(event|trace|gotsport):[A-Za-z0-9._:%-]{1,180}$/.test(x))))throw new ApiError('Invalid game identity.',400);return out;}\nfunction coachAttributes(v){if(!v||typeof v!=='object'||Array.isArray(v))throw new ApiError('Invalid coach attributes.',400);const positions=v.positions||{},keys=Object.keys(positions),endurance=v.endurance??null,target=v.target_minutes??null;if(!positions||typeof positions!=='object'||Array.isArray(positions)||keys.length>3||keys.some(k=>!COACH_POSITIONS.has(k)||!Number.isInteger(positions[k])||positions[k]<1||positions[k]>5)||endurance!==null&&(!Number.isInteger(endurance)||endurance<1||endurance>5)||target!==null&&(!Number.isInteger(target)||target<0||target>180))throw new ApiError('Invalid coach attributes.',400);return{positions,endurance,target_minutes:target};}",
  "backend_profiles": "async function coachProfiles(env,family,season){const rows=await env.DB.prepare('SELECT season,member_id,attributes_json,updated_at FROM coach_profiles WHERE family_key=? AND season IN (?,?) ORDER BY season').bind(family,season-1,season).all();return Object.fromEntries((rows.results||[]).map(r=>[r.member_id,{...safeJsonParse(r.attributes_json,{}),updated_at:r.updated_at,inherited_from:r.season===season?null:r.season}]));}",
  "backend_identity": "async function coachSessionRow(env,family,aliases){const q=aliases.map(()=>'?').join(',');const rows=await env.DB.prepare(`SELECT alias,game_key FROM coach_game_aliases WHERE family_key=? AND alias IN (${q})`).bind(family,...aliases).all(),keys=new Set(rows.results.map(r=>r.game_key));if(keys.size>1)throw new ApiError('These game sources point to different coach sessions. Refresh and contact the owner before editing.',409,'coach_identity_conflict');if(!keys.size)return null;const row=await env.DB.prepare('SELECT game_key,revision,state_json,updated_at FROM coach_sessions WHERE family_key=? AND game_key=?').bind(family,[...keys][0]).first();return row?{...row,known_aliases:rows.results.map(r=>r.alias)}:null;}",
  "backend_clock_actions": "function coachElapsed(s,stamp){return Math.max(0,s.elapsed_ms+(s.phase==='running'?Math.max(0,stamp-Date.parse(s.running_since||'')):0));}\nfunction coachAccount(s,stamp){if(s.phase!=='running')return;const delta=Math.max(0,Math.min(12*3600000,stamp-Date.parse(s.running_since||'')));s.elapsed_ms+=delta;s.period_elapsed_ms+=delta;for(const id of Object.values(s.field))s.minutes_ms[id]=(s.minutes_ms[id]||0)+delta;s.running_since=new Date(stamp).toISOString();}\nfunction coachApply(s,a,stamp){const type=clean(a?.type),ids=new Set(s.roster.map(p=>p.id)),active=new Set(s.active),field=s.field,occupied=new Set(Object.values(field));if(s.history.length>=500)throw new ApiError('The match history is full.',409);const fail=()=>{throw new ApiError('That action is not available in the current match state.',409,'coach_state');};\n if(type==='configure'){if(s.phase!=='planning')fail();if(![7,9].includes(a.format)||!Number.isInteger(a.half_minutes)||a.half_minutes<5||a.half_minutes>90)throw new ApiError('Choose a valid game format and half length.',400);if(Object.keys(field).length>a.format)throw new ApiError('Remove starters before reducing the game format.',400);s.format=a.format;s.half_minutes=a.half_minutes;}\n else if(type==='availability'){if(s.phase!=='planning')fail();const id=clean(a.player);if(!ids.has(id))throw new ApiError('Unknown player.',400);if(a.available===true)s.active.push(id);else if(a.available===false){if(occupied.has(id))throw new ApiError('Move this player to the bench first.',400);s.active=s.active.filter(x=>x!==id);}else throw new ApiError('Invalid availability.',400);}\n else if(type==='assign'){if(!['planning','halftime'].includes(s.phase))fail();const id=clean(a.player),slot=Number(a.slot);if(!Number.isInteger(slot)||slot<0||slot>22||!active.has(id))throw new ApiError('Choose an available player and position.',400);for(const [key,value] of Object.entries(field))if(value===id)delete field[key];const previous=field[slot];if(previous&&previous!==id&&a.swap_slot!=null){const swap=Number(a.swap_slot);if(Number.isInteger(swap)&&swap>=0&&swap<=22)field[swap]=previous;else delete field[slot];}field[slot]=id;if(Object.keys(field).length>s.format)throw new ApiError('The field is full for this format.',400);}\n else if(type==='bench'){if(!['planning','halftime'].includes(s.phase))fail();for(const [slot,id] of Object.entries(field))if(id===clean(a.player))delete field[slot];}\n else if(type==='start'){if(s.phase!=='planning'||Object.keys(field).length!==s.format)fail();s.phase='running';s.running_since=new Date(stamp).toISOString();}\n else if(type==='pause'){if(s.phase!=='running')fail();coachAccount(s,stamp);s.phase='paused';s.running_since=null;}\n else if(type==='resume'){if(s.phase!=='paused')fail();s.phase='running';s.running_since=new Date(stamp).toISOString();}\n else if(type==='halftime'){if(!['running','paused'].includes(s.phase)||s.period!==1)fail();coachAccount(s,stamp);s.phase='halftime';s.running_since=null;}\n else if(type==='next_half'){if(s.phase!=='halftime'||Object.keys(field).length!==s.format)fail();s.period=2;s.period_elapsed_ms=0;s.phase='running';s.running_since=new Date(stamp).toISOString();}\n else if(type==='finish'){if(!['running','paused','halftime'].includes(s.phase))fail();coachAccount(s,stamp);s.phase='finished';s.running_since=null;}\n else if(type==='sub'){if(!['running','paused'].includes(s.phase))fail();const outgoing=clean(a.out),incoming=clean(a.in),slot=Object.keys(field).find(k=>field[k]===outgoing);if(slot===undefined||!active.has(incoming)||occupied.has(incoming))throw new ApiError('Choose an on-field player and an available substitute.',400);coachAccount(s,stamp);field[slot]=incoming;}\n else if(type==='correct_sub'){if(!['paused','halftime','finished'].includes(s.phase))fail();const outgoing=clean(a.out),incoming=clean(a.in),slot=Object.keys(field).find(k=>field[k]===outgoing),delta=Number(a.delta);if(slot===undefined||!active.has(incoming)||occupied.has(incoming)||!Number.isInteger(delta)||delta<=0||delta>3600000||delta>s.elapsed_ms||delta>(s.minutes_ms[outgoing]||0))throw new ApiError('Choose the players and elapsed minutes for the missed substitution.',400);s.minutes_ms[outgoing]-=delta;s.minutes_ms[incoming]=(s.minutes_ms[incoming]||0)+delta;field[slot]=incoming;}\n else if(type==='move'){if(!['running','paused'].includes(s.phase))fail();const from=Number(a.from),to=Number(a.to);if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>22||to<0||to>22||field[from]==null)throw new ApiError('Choose an on-field player and position.',400);const p=field[from],other=field[to];delete field[from];field[to]=p;if(other)field[from]=other;coachAccount(s,stamp);}\n else if(type==='adjust_minutes'){if(s.phase==='planning'||s.phase==='running')fail();const id=clean(a.player),delta=Number(a.delta);if(!ids.has(id)||!Number.isInteger(delta)||Math.abs(delta)>3600000||Math.max(0,(s.minutes_ms[id]||0)+delta)!==(s.minutes_ms[id]||0)+delta)throw new ApiError('Invalid minute correction.',400);s.minutes_ms[id]=(s.minutes_ms[id]||0)+delta;}\n else if(type==='adjust_clock'){if(!['paused','halftime','finished'].includes(s.phase))fail();const delta=Number(a.delta);if(!Number.isInteger(delta)||Math.abs(delta)>900000||s.period_elapsed_ms+delta<0||s.elapsed_ms+delta<0||Object.values(field).some(id=>(s.minutes_ms[id]||0)+delta<0))throw new ApiError('Invalid clock correction.',400);s.elapsed_ms+=delta;s.period_elapsed_ms+=delta;for(const id of Object.values(field))s.minutes_ms[id]=(s.minutes_ms[id]||0)+delta;}\n else fail();\n s.history.push({type,at:new Date(stamp).toISOString(),period:s.period,elapsed_ms:s.elapsed_ms,player:clean(a.player||''),out:clean(a.out||''),in:clean(a.in||''),slot:a.slot??null,delta:a.delta??null});return s;\n}",
  "frontend_helpers": "const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null); const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));\nfunction norm(v){return String(v??'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/\\b(?:soccer|football|club|academy)\\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\\s+/g,' ').trim()}function tokens(v){return new Set(norm(v).split(' ').filter(Boolean))}function similarity(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size)}\nfunction recognizedPositionGroup(raw){const q=norm(raw);if(!q||q==='player')return'';if(/goal|keeper|\\bgk\\b/.test(q))return'GK';if(/defen|back|sweep|\\b(?:def|cb|lcb|rcb|lb|rb|lwb|rwb|sw)\\b/.test(q))return'DEF';if(/mid|\\b(?:cm|lcm|rcm|dm|am|lm|rm|cdm|cam)\\b/.test(q))return'MID';if(/forward|striker|wing|attack|\\b(?:fwd|st|ss|cf|lw|rw)\\b/.test(q))return'FWD';return''}",
  "frontend_slots": "function lineupDropTargets(){return [\n {slot_x:50,slot_y:91,position:'GK'},{slot_x:50,slot_y:81,position:'SW'},\n {slot_x:15,slot_y:70,position:'LB'},{slot_x:35,slot_y:70,position:'LCB'},\n {slot_x:50,slot_y:70,position:'CB'},{slot_x:65,slot_y:70,position:'RCB'},\n {slot_x:85,slot_y:70,position:'RB'},\n {slot_x:9,slot_y:58,position:'LWB'},{slot_x:91,slot_y:58,position:'RWB'},\n {slot_x:18,slot_y:44,position:'LM'},{slot_x:35,slot_y:44,position:'LCM'},\n {slot_x:50,slot_y:56,position:'CDM'},{slot_x:50,slot_y:44,position:'CM'},\n {slot_x:50,slot_y:32,position:'CAM'},{slot_x:65,slot_y:44,position:'RCM'},\n {slot_x:82,slot_y:44,position:'RM'},\n {slot_x:18,slot_y:19,position:'LW'},{slot_x:82,slot_y:19,position:'RW'},\n {slot_x:40,slot_y:24,position:'SS'},{slot_x:60,slot_y:24,position:'CF'},\n {slot_x:35,slot_y:9,position:'ST',side:'Left'},{slot_x:50,slot_y:9,position:'ST',side:'Center'},{slot_x:65,slot_y:9,position:'ST',side:'Right'}\n ];}",
  "frontend_coach": "function coachGameAliases(item){return [...new Set([item.event?.id!=null?'event:'+item.event.id:'',item.gotsport?.uid?'gotsport:'+encodeURIComponent(item.gotsport.uid):'',item.game?.game_id!=null?'trace:'+item.game.game_id:''].filter(Boolean))]}\nfunction coachFormat(item){const n=Number.parseInt(String(item.game?.format||''),10);return n===7||n===9?n:7}\nfunction coachClock(s){return s.elapsed_ms+(s.phase==='running'?Math.max(0,Date.now()-Date.parse(s.running_since||'')):0)}\nfunction coachMinutes(s,id){return (s.minutes_ms[id]||0)+(s.phase==='running'&&Object.values(s.field).includes(id)?Math.max(0,Date.now()-Date.parse(s.running_since||'')):0)}\nfunction coachTime(ms){const seconds=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`}\nfunction coachHistoryMinutes(p){if(!p)return[];return rowsForMember(p).filter(r=>num(r.minutes)>0&&seasonStatTraceIncluded(r.game_id)).slice(-5).map(r=>num(r.minutes)).filter(Number.isFinite)}\nfunction coachRecommendations(s,profiles){if(!['running','paused'].includes(s.phase))return[];const on=Object.entries(s.field),used=new Set(on.map(([,id])=>id)),bench=s.roster.filter(p=>s.active.includes(p.id)&&!used.has(p.id)),slots=lineupDropTargets(),out=[];\n for(const [slot,id] of on){const current=s.roster.find(p=>p.id===id);if(!current)continue;const code=slots[Number(slot)]?.position||'',minutes=coachMinutes(s,id)/60000,profile=profiles[id]||{};for(const p of bench){const a=profiles[p.id]||{},rating=a.positions?.[code]||0,group=recognizedPositionGroup(code),groupMatch=Object.keys(a.positions||{}).some(x=>recognizedPositionGroup(x)===group),benchMinutes=coachMinutes(s,p.id)/60000;if(!rating&&!groupMatch&&resolvedPosition(playerFromId(p.id))!==code)continue;const recent=coachHistoryMinutes(playerFromId(p.id)),recentAvg=recent.length?recent.reduce((n,x)=>n+x,0)/recent.length:null,sourceRole=resolvedPosition(playerFromId(p.id)),target=a.target_minutes??s.half_minutes*2/s.roster.length*s.format,need=Math.max(0,target-benchMinutes),over=minutes-(profile.target_minutes??target),score=rating*8+(groupMatch?3:0)+Math.min(15,need)/3+Math.max(0,over)/3+(a.endurance||3)+(sourceRole===code?1:0)-Math.max(0,benchMinutes-minutes)/2;out.push({out:current,in:p,slot:Number(slot),score,reason:`${rating?`${rating}/5 at ${code}`:sourceRole===code?'Played here previously':`${group.toLowerCase()} position`} · ${Math.round(benchMinutes)} min today; ${current.name} ${Math.round(minutes)} min${recentAvg!=null?` · recent Trace estimate ~${Math.round(recentAvg)} min`:''}`})}}\n return out.sort((a,b)=>b.score-a.score).slice(0,3)}\nfunction coachSuggestedField(s,profiles){const preferred=s.format===7?[0,3,6,10,14,19,21]:[0,2,4,6,10,12,14,17,21],chosen=new Set(),field={};for(const slot of preferred){const code=lineupDropTargets()[slot].position,group=recognizedPositionGroup(code);let best=null,bestScore=-Infinity;for(const p of s.roster){if(!s.active.includes(p.id)||chosen.has(p.id))continue;const a=profiles[p.id]||{},rated=a.positions?.[code]||0,same=Object.entries(a.positions||{}).filter(([pos])=>recognizedPositionGroup(pos)===group).reduce((m,[,score])=>Math.max(m,score),0);const natural=assignedPosition(playerFromId(p.id))===code?2:0;const score=rated*10+same*3+natural;if(score>bestScore){bestScore=score;best=p}}if(best){field[slot]=best.id;chosen.add(best.id)}}return field}",
  "ui_pregame": " function render(){if(!alive())return;if(!session){const members=roster(),available=members.filter(p=>item.event?availabilityStatus(item.event,playerFromId(p.id))!=='no':true);root.innerHTML=`<div class=\"card coach-workspace\"><div class=\"card-head\"><h3>Game plan</h3></div><div class=\"card-body\"><p class=\"source-note\">Create a private lineup for this match. Attendance marked No is excluded initially.</p><div class=\"edit-fields coach-setup\"><label>Format<select id=\"coachFormat\"><option value=\"7\" ${coachFormat(item)===7?'selected':''}>7v7</option><option value=\"9\" ${coachFormat(item)===9?'selected':''}>9v9</option></select></label><label>Minutes per half<input id=\"coachHalf\" type=\"number\" min=\"5\" max=\"90\" value=\"25\"></label></div><p class=\"coach-setup-count\">${available.length} available players · ${members.length} on roster</p><button type=\"button\" class=\"btn primary\" data-coach-create>Create game plan</button><div class=\"login-error hidden\" data-coach-error></div></div></div>`;root.querySelector('[data-coach-create]').onclick=()=>action({type:'create'},{format:Number(root.querySelector('#coachFormat').value),half_minutes:Number(root.querySelector('#coachHalf').value),active:available.map(p=>p.id)});return}",
  "ui_configuration_actions": " root.querySelector('[data-coach-adjust-clock]')?.addEventListener('click',()=>{const input=root.querySelector('[data-coach-clock-delta]'),value=Number(input.value);if(!input.value||!Number.isFinite(value))return;void action({type:'adjust_clock',delta:Math.round(value*60000)})});root.querySelector('[data-coach-late-save]')?.addEventListener('click',()=>{const input=root.querySelector('[data-coach-late-minutes]'),value=Number(input.value),out=root.querySelector('[data-coach-late-out]')?.value,incoming=root.querySelector('[data-coach-late-in]')?.value;if(!input.value||!Number.isFinite(value)||!out||!incoming)return;void action({type:'correct_sub',out,in:incoming,delta:Math.round(value*60000)})});root.querySelector('[data-coach-adjust-player-save]')?.addEventListener('click',()=>{const input=root.querySelector('[data-coach-adjust-minutes]'),value=Number(input.value);if(!input.value||!Number.isFinite(value))return;void action({type:'adjust_minutes',player:root.querySelector('[data-coach-adjust-player]').value,delta:Math.round(value*60000)})});root.querySelectorAll('[data-coach-action]').forEach(b=>b.onclick=async()=>{const type=b.dataset.coachAction;if(type==='finish'&&!await appConfirm({title:'End game?',message:'Finish the clock and keep the recorded lineup and minutes?',confirmText:'End game'}))return;void action({type})});root.querySelector('[data-coach-format]')?.addEventListener('change',event=>action({type:'configure',format:Number(event.target.value),half_minutes:s.half_minutes}));root.querySelector('[data-coach-half]')?.addEventListener('change',event=>action({type:'configure',format:s.format,half_minutes:Number(event.target.value)}));"
});

// Only external presentation/read adapters are injected. The recommendation,
// lineup choice, attribute merge, and mutation algorithms are the pinned source.
export function createOriginalCoachOracle({ nowMs = 0, players = {}, history = {}, includedGames = null } = {}) {
  let clock = nowMs;
  class FixtureDate extends Date { static now() { return clock; } }
  const rowsForMember = p => history[p?.id] || [];
  const seasonStatTraceIncluded = id => includedGames === null || includedGames.includes(id);
  const playerFromId = id => players[id] || { id };
  const resolvedPosition = p => p?.resolved_position || "";
  const assignedPosition = p => p?.assigned_position || "";
  const names = [
    "coachSeason", "coachAliases", "coachAttributes", "coachProfiles", "coachSessionRow",
    "coachElapsed", "coachAccount", "coachApply", "coachGameAliases", "coachFormat",
    "coachClock", "coachMinutes", "coachTime", "coachHistoryMinutes", "coachRecommendations",
    "coachSuggestedField", "lineupDropTargets", "recognizedPositionGroup"
  ];
  const executable = ["backend_helpers", "backend_positions", "backend_validation",
    "backend_profiles", "backend_identity", "backend_clock_actions", "frontend_helpers",
    "frontend_slots", "frontend_coach"].map(key => ORIGINAL_COACH_SOURCE[key]).join("\n");
  const oracle = Function("Date", "rowsForMember", "seasonStatTraceIncluded", "playerFromId",
    "resolvedPosition", "assignedPosition", executable + "\nreturn {" + names.join(",") + "};"
  )(FixtureDate, rowsForMember, seasonStatTraceIncluded, playerFromId, resolvedPosition, assignedPosition);
  return { ...oracle, setNow: value => { clock = value; } };
}

// The original handler creates exactly this state. This helper is fixture input,
// not a separately implemented Coach mutation algorithm.
export function coachState({ count = 10, format = 7, fieldCount = 0, ...overrides } = {}) {
  const roster = Array.from({ length: count }, (_, i) => ({ id: "p" + i, name: "Player " + i, jersey: String(i + 1) }));
  return {
    season: 2026, team_id: "T", roster, active: roster.map(p => p.id), format,
    half_minutes: 25, phase: "planning", period: 1, elapsed_ms: 0, period_elapsed_ms: 0,
    running_since: null, field: Object.fromEntries(roster.slice(0, fieldCount).map((p, i) => [i, p.id])),
    minutes_ms: {}, history: [], ...overrides
  };
}

export function originalProfilesFixture(rows) {
  const calls = [];
  return { calls, env: { DB: { prepare(sql) { return { bind(...args) { calls.push({ sql, args }); return {
    async all() { const [, previous, current] = args; return { results: rows.filter(row => row.season === previous || row.season === current).sort((a, b) => a.season - b.season) }; }
  }; } }; } } } };
}

function expectError(assert, run, status, code = null) {
  let error; try { run(); } catch (e) { error = e; }
  assert.ok(error, "Expected original source to reject the action");
  assert.equal(error.status, status);
  if (code) assert.equal(error.code, code);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function originalCoachCases() {
  const cases = [];
  const add = (name, run) => cases.push({ name, run });
  add("Coach source pin is original 6.20.133", assert => {
    assert.equal(ORIGINAL_COACH_PROVENANCE.commit, "50e1be224806ff7e7c439d26e15fd0421e3f6f01");
    assert.equal(ORIGINAL_COACH_PROVENANCE.workerBlob, "bd2d055483abae37ddae2680ec62f6282da6680c");
    assert.equal(ORIGINAL_COACH_PROVENANCE.version, "6.20.133");
  });
  add("Coach attributes retain empty values, explicit target zero and three valid positions", assert => {
    const o = createOriginalCoachOracle();
    assert.deepEqual(o.coachAttributes({}), { positions: {}, endurance: null, target_minutes: null });
    assert.deepEqual(o.coachAttributes({ positions: { GK: 5, CB: 1, ST: 3 }, endurance: 5, target_minutes: 0 }),
      { positions: { GK: 5, CB: 1, ST: 3 }, endurance: 5, target_minutes: 0 });
    assert.equal(o.coachAttributes({ target_minutes: 180 }).target_minutes, 180);
  });
  add("Coach attributes reject unknown or fourth position, invalid ratings and out of range targets", assert => {
    const o = createOriginalCoachOracle();
    for (const v of [null, [], { positions: { X: 3 } }, { positions: { GK: 1, CB: 2, CM: 3, ST: 4 } },
      { positions: { GK: 0 } }, { positions: { GK: 6 } }, { positions: { GK: 2.5 } },
      { endurance: 0 }, { endurance: 6 }, { target_minutes: -1 }, { target_minutes: 181 }, { target_minutes: 0.5 }])
      expectError(assert, () => o.coachAttributes(v), 400);
  });
  add("Coach profiles inherit previous season and current row replaces the whole attributes object", async assert => {
    const o = createOriginalCoachOracle(), f = originalProfilesFixture([
      { season: 2025, member_id: "p0", attributes_json: JSON.stringify({ positions: { GK: 5 }, endurance: 4, target_minutes: 40 }), updated_at: "previous" },
      { season: 2025, member_id: "p1", attributes_json: JSON.stringify({ positions: { CB: 3 }, endurance: 2, target_minutes: 20 }), updated_at: "previous1" },
      { season: 2026, member_id: "p0", attributes_json: JSON.stringify({ positions: {}, endurance: null, target_minutes: null }), updated_at: "current" }
    ]);
    assert.deepEqual(await o.coachProfiles(f.env, "F", 2026), {
      p0: { positions: {}, endurance: null, target_minutes: null, updated_at: "current", inherited_from: null },
      p1: { positions: { CB: 3 }, endurance: 2, target_minutes: 20, updated_at: "previous1", inherited_from: 2025 }
    });
    assert.deepEqual(f.calls[0].args, ["F", 2025, 2026]);
    assert.ok(f.calls[0].sql.includes("season IN (?,?) ORDER BY season"));
  });
  add("Coach original profiles do not carry through a skipped season (source characterization)", async assert => {
    const o = createOriginalCoachOracle(), f = originalProfilesFixture([
      { season: 2024, member_id: "p0", attributes_json: '{"positions":{"GK":5}}', updated_at: "older" }
    ]);
    assert.deepEqual(await o.coachProfiles(f.env, "F", 2026), {});
    // README carry-forward promise is broader; this fixture must not silently invent it.
  });
  add("Coach aliases preserve event GotSport Trace identities, deduplicate and validate", assert => {
    const o = createOriginalCoachOracle();
    assert.deepEqual(o.coachGameAliases({ event: { id: 12 }, gotsport: { uid: "A:B C" }, game: { game_id: 99 } }),
      ["event:12", "gotsport:A%3AB%20C", "trace:99"]);
    assert.deepEqual(o.coachAliases(["event:12", "event:12"]), ["event:12"]);
    for (const aliases of [[], ["other:12"], ["event:x/y"], ["event:1", "event:2", "trace:3", "trace:4"]])
      expectError(assert, () => o.coachAliases(aliases), 400);
  });
  add("Coach session aliases reject two distinct sessions and accept one shared identity", async assert => {
    const o = createOriginalCoachOracle();
    function envFor(rows, row = { game_key: "game", revision: 3, state_json: "{}" }) {
      return { DB: { prepare(sql) { return { bind() { return {
        async all() { return { results: rows }; }, async first() { return row; }
      }; } }; } } };
    }
    const row = await o.coachSessionRow(envFor([{ alias: "event:1", game_key: "game" }, { alias: "trace:2", game_key: "game" }]), "F", ["event:1", "trace:2"]);
    assert.deepEqual(row.known_aliases, ["event:1", "trace:2"]);
    let error; try { await o.coachSessionRow(envFor([{ alias: "event:1", game_key: "a" }, { alias: "trace:2", game_key: "b" }]), "F", ["event:1", "trace:2"]); } catch (e) { error = e; }
    assert.equal(error?.status, 409); assert.equal(error?.code, "coach_identity_conflict");
    assert.equal(await o.coachSessionRow(envFor([]), "F", ["event:1"]), null);
  });
  add("Coach pregame reconfiguration preserves lineup availability minutes and prior history", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7, minutes_ms: { p0: 123 }, history: [{ type: "assign" }] });
    const before = clone(s);
    o.coachApply(s, { type: "configure", format: 9, half_minutes: 30 }, 60000);
    assert.equal(s.format, 9); assert.equal(s.half_minutes, 30);
    for (const key of ["roster", "active", "field", "minutes_ms", "elapsed_ms", "period_elapsed_ms", "phase", "period"])
      assert.deepEqual(s[key], before[key]);
    assert.deepEqual(s.history.slice(0, -1), before.history);
    assert.equal(s.history.at(-1).type, "configure");
  });
  add("Coach format downgrade requires benching excess starters first", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ format: 9, count: 11, fieldCount: 9 });
    expectError(assert, () => o.coachApply(s, { type: "configure", format: 7, half_minutes: 25 }, 0), 400);
    assert.equal(s.format, 9); assert.equal(s.history.length, 0);
    o.coachApply(s, { type: "bench", player: "p8" }, 0); o.coachApply(s, { type: "bench", player: "p7" }, 0);
    o.coachApply(s, { type: "configure", format: 7, half_minutes: 25 }, 0);
    assert.equal(s.format, 7); assert.equal(Object.keys(s.field).length, 7);
  });
  add("Coach configuration permits only planning, formats 7 or 9 and integer half lengths 5 to 90", assert => {
    const o = createOriginalCoachOracle();
    for (const half of [5, 90]) { const s = coachState(); o.coachApply(s, { type: "configure", format: 7, half_minutes: half }, 0); assert.equal(s.half_minutes, half); }
    for (const a of [{ format: 8, half_minutes: 25 }, { format: "7", half_minutes: 25 }, { format: 7, half_minutes: 4 }, { format: 7, half_minutes: 91 }, { format: 7, half_minutes: 25.5 }])
      expectError(assert, () => o.coachApply(coachState(), { type: "configure", ...a }, 0), 400);
    for (const phase of ["running", "paused", "halftime", "finished"])
      expectError(assert, () => o.coachApply(coachState({ phase }), { type: "configure", format: 7, half_minutes: 25 }, 0), 409, "coach_state");
  });
  add("Coach availability is game-local, requires benching a starter and is backend planning-only", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 1 });
    expectError(assert, () => o.coachApply(s, { type: "availability", player: "p0", available: false }, 0), 400);
    o.coachApply(s, { type: "availability", player: "p9", available: false }, 0);
    assert.equal(s.active.includes("p9"), false); assert.equal(s.roster.length, 10);
    expectError(assert, () => o.coachApply(coachState({ phase: "halftime" }), { type: "availability", player: "p9", available: false }, 0), 409, "coach_state");
  });
  add("Coach assign swaps selected positions and bench removes a starter before kickoff", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 2 });
    o.coachApply(s, { type: "assign", player: "p0", slot: 1, swap_slot: 0 }, 0);
    assert.deepEqual(s.field, { 0: "p1", 1: "p0" });
    o.coachApply(s, { type: "bench", player: "p0" }, 0);
    assert.deepEqual(s.field, { 0: "p1" });
    expectError(assert, () => o.coachApply(coachState({ active: ["p0"] }), { type: "assign", player: "p1", slot: 1 }, 0), 400);
  });
  add("Coach start requires exactly the configured number of field players", assert => {
    const o = createOriginalCoachOracle();
    expectError(assert, () => o.coachApply(coachState({ fieldCount: 6 }), { type: "start" }, 0), 409, "coach_state");
    const s = coachState({ fieldCount: 7 }); o.coachApply(s, { type: "start" }, 0);
    assert.equal(s.phase, "running"); assert.equal(s.running_since, "1970-01-01T00:00:00.000Z");
    assert.equal(s.elapsed_ms, 0); assert.deepEqual(s.minutes_ms, {});
  });
  add("Coach clock and current field minutes derive from timestamps without mutating a read", assert => {
    const o = createOriginalCoachOracle({ nowMs: 90000 }), s = coachState({ fieldCount: 7, phase: "running", running_since: "1970-01-01T00:00:00.000Z" });
    const before = clone(s);
    assert.equal(o.coachClock(s), 90000); assert.equal(o.coachMinutes(s, "p0"), 90000);
    assert.equal(o.coachMinutes(s, "p9"), 0); assert.equal(o.coachElapsed(s, 90000), 90000);
    assert.deepEqual(s, before);
    assert.equal(o.coachTime(90600), "01:30"); assert.equal(o.coachTime(-100), "00:00");
  });
  add("Coach pause accounts each current field player once and excludes paused wall time", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7 });
    o.coachApply(s, { type: "start" }, 0); o.coachApply(s, { type: "pause" }, 600000);
    assert.equal(s.elapsed_ms, 600000); assert.equal(s.period_elapsed_ms, 600000); assert.equal(s.running_since, null);
    for (let i = 0; i < 7; i++) assert.equal(s.minutes_ms["p" + i], 600000);
    o.setNow(1200000); assert.equal(o.coachClock(s), 600000);
    o.coachApply(s, { type: "resume" }, 1200000); o.coachApply(s, { type: "pause" }, 1500000);
    assert.equal(s.elapsed_ms, 900000); assert.equal(s.minutes_ms.p0, 900000);
  });
  add("Coach timestamp accounting clamps backward time and caps one account gap at twelve hours", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7, phase: "running", running_since: "1970-01-01T00:01:00.000Z" });
    o.coachAccount(s, 0); assert.equal(s.elapsed_ms, 0);
    o.coachAccount(s, 13 * 3600000); assert.equal(s.elapsed_ms, 12 * 3600000);
    // Original persisted account cap differs from unbounded presentation reads.
    o.setNow(26 * 3600000); assert.equal(o.coachClock(s), 25 * 3600000);
  });
  add("Coach live substitution accounts outgoing first and credits incoming only afterward", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7 });
    o.coachApply(s, { type: "start" }, 0); o.coachApply(s, { type: "sub", out: "p0", in: "p7" }, 600000);
    assert.equal(s.field[0], "p7"); assert.equal(s.minutes_ms.p0, 600000); assert.equal(s.minutes_ms.p7, undefined);
    o.coachApply(s, { type: "pause" }, 900000);
    assert.equal(s.minutes_ms.p0, 600000); assert.equal(s.minutes_ms.p7, 300000);
    assert.equal(Object.values(s.minutes_ms).reduce((sum, n) => sum + n, 0), 7 * s.elapsed_ms);
    assert.equal(s.history.at(-2).elapsed_ms, 600000);
  });
  add("Coach paused substitution accrues no clock time and rejects inactive or occupied incoming players", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7, phase: "paused", elapsed_ms: 600000, period_elapsed_ms: 600000, minutes_ms: { p0: 600000 } });
    o.coachApply(s, { type: "sub", out: "p0", in: "p7" }, 999999);
    assert.equal(s.elapsed_ms, 600000); assert.equal(s.minutes_ms.p0, 600000); assert.equal(s.minutes_ms.p7, undefined);
    for (const incoming of ["p1", "missing"])
      expectError(assert, () => o.coachApply(coachState({ fieldCount: 7, phase: "paused" }), { type: "sub", out: "p0", in: incoming }, 0), 400);
    expectError(assert, () => o.coachApply(coachState({ fieldCount: 7, phase: "planning" }), { type: "sub", out: "p0", in: "p7" }, 0), 409, "coach_state");
  });
  add("Coach late substitution transfers only requested minutes and preserves elapsed and period clocks", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7, phase: "paused", elapsed_ms: 600000, period_elapsed_ms: 600000, minutes_ms: { p0: 600000 } });
    o.coachApply(s, { type: "correct_sub", out: "p0", in: "p7", delta: 120000 }, 900000);
    assert.equal(s.minutes_ms.p0, 480000); assert.equal(s.minutes_ms.p7, 120000);
    assert.equal(s.field[0], "p7"); assert.equal(s.elapsed_ms, 600000); assert.equal(s.period_elapsed_ms, 600000);
    assert.equal(s.history.at(-1).delta, 120000); assert.equal(s.history.at(-1).elapsed_ms, 600000);
  });
  add("Coach late substitution rejects zero, excessive or unaccounted transfer and running phase", assert => {
    const o = createOriginalCoachOracle();
    for (const delta of [0, -1, 600001, 3600001, 1.5])
      expectError(assert, () => o.coachApply(coachState({ fieldCount: 7, phase: "paused", elapsed_ms: 600000, minutes_ms: { p0: 600000 } }), { type: "correct_sub", out: "p0", in: "p7", delta }, 0), 400);
    expectError(assert, () => o.coachApply(coachState({ fieldCount: 7, phase: "running" }), { type: "correct_sub", out: "p0", in: "p7", delta: 1 }, 0), 409, "coach_state");
  });
  add("Coach positional move swaps on-field players without losing accounting", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7 });
    o.coachApply(s, { type: "start" }, 0); o.coachApply(s, { type: "move", from: 0, to: 1 }, 60000);
    assert.equal(s.field[0], "p1"); assert.equal(s.field[1], "p0");
    assert.equal(s.minutes_ms.p0, 60000); assert.equal(s.minutes_ms.p1, 60000);
    assert.equal(Object.values(s.minutes_ms).reduce((n, x) => n + x, 0), 7 * 60000);
  });
  add("Coach clock correction credits current field only with fifteen minute and nonnegative bounds", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7, phase: "paused", elapsed_ms: 600000, period_elapsed_ms: 600000, minutes_ms: Object.fromEntries(Array.from({ length: 8 }, (_, i) => ["p" + i, 600000])) });
    o.coachApply(s, { type: "adjust_clock", delta: 120000 }, 0);
    assert.equal(s.elapsed_ms, 720000); assert.equal(s.period_elapsed_ms, 720000);
    assert.equal(s.minutes_ms.p0, 720000); assert.equal(s.minutes_ms.p7, 600000);
    for (const delta of [-720001, 900001, 1.5])
      expectError(assert, () => o.coachApply(clone(s), { type: "adjust_clock", delta }, 0), 400);
    expectError(assert, () => o.coachApply(coachState({ phase: "running" }), { type: "adjust_clock", delta: 1 }, 0), 409, "coach_state");
  });
  add("Coach individual minute correction affects one roster player and accepts zero but no negative total", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ phase: "finished", elapsed_ms: 600000, minutes_ms: { p0: 120000 } });
    o.coachApply(s, { type: "adjust_minutes", player: "p0", delta: -120000 }, 0);
    assert.equal(s.minutes_ms.p0, 0); assert.equal(s.elapsed_ms, 600000);
    for (const a of [{ player: "p0", delta: -1 }, { player: "missing", delta: 1 }, { player: "p1", delta: 3600001 }])
      expectError(assert, () => o.coachApply(clone(s), { type: "adjust_minutes", ...a }, 0), 400);
    for (const phase of ["planning", "running"])
      expectError(assert, () => o.coachApply(coachState({ phase }), { type: "adjust_minutes", player: "p0", delta: 1 }, 0), 409, "coach_state");
  });
  add("Coach halftime pauses, permits lineup changes and second half resets only period clock", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7 });
    o.coachApply(s, { type: "start" }, 0); o.coachApply(s, { type: "halftime" }, 1500000);
    assert.equal(s.phase, "halftime"); assert.equal(s.period, 1); assert.equal(s.elapsed_ms, 1500000);
    o.coachApply(s, { type: "bench", player: "p0" }, 1600000);
    expectError(assert, () => o.coachApply(s, { type: "next_half" }, 1600000), 409, "coach_state");
    o.coachApply(s, { type: "assign", player: "p7", slot: 0 }, 1600000);
    o.coachApply(s, { type: "next_half" }, 1800000);
    assert.equal(s.period, 2); assert.equal(s.period_elapsed_ms, 0); assert.equal(s.elapsed_ms, 1500000);
    o.coachApply(s, { type: "finish" }, 3300000);
    assert.equal(s.phase, "finished"); assert.equal(s.elapsed_ms, 3000000); assert.equal(s.period_elapsed_ms, 1500000);
    assert.equal(s.minutes_ms.p0, 1500000); assert.equal(s.minutes_ms.p7, 1500000);
    assert.equal(Object.values(s.minutes_ms).reduce((n, x) => n + x, 0), 7 * 3000000);
  });
  add("Coach nine-player fifty-minute game with both-half substitutions accounts for 450 player minutes", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ count: 11, format: 9, fieldCount: 9 });
    o.coachApply(s, { type: "start" }, 0);
    o.coachApply(s, { type: "sub", out: "p0", in: "p9" }, 600000);
    o.coachApply(s, { type: "halftime" }, 1500000);
    o.coachApply(s, { type: "next_half" }, 1800000);
    o.coachApply(s, { type: "sub", out: "p1", in: "p10" }, 2400000);
    o.coachApply(s, { type: "finish" }, 3300000);
    assert.equal(s.phase, "finished"); assert.equal(s.elapsed_ms, 3000000);
    assert.equal(s.period_elapsed_ms, 1500000); assert.equal(s.running_since, null);
    assert.equal(s.minutes_ms.p0, 600000); assert.equal(s.minutes_ms.p9, 2400000);
    assert.equal(s.minutes_ms.p1, 2100000); assert.equal(s.minutes_ms.p10, 900000);
    assert.equal(Object.values(s.minutes_ms).reduce((n, x) => n + x, 0) / 60000, 450);
    assert.equal(Object.keys(s.field).length, 9);
    assert.deepEqual(s.history.map(h => h.type), ["start", "sub", "halftime", "next_half", "sub", "finish"]);
    o.setNow(3600000); assert.equal(o.coachClock(s), 3000000);
  });
  add("Coach half length does not automatically stop original clock and history is capped at 500", assert => {
    const o = createOriginalCoachOracle(), s = coachState({ fieldCount: 7, half_minutes: 5 });
    o.coachApply(s, { type: "start" }, 0); o.coachAccount(s, 600000);
    assert.equal(s.phase, "running"); assert.equal(s.period, 1); assert.equal(s.elapsed_ms, 600000);
    expectError(assert, () => o.coachApply(coachState({ history: Array.from({ length: 500 }, () => ({ type: "assign" })) }), { type: "configure", format: 7, half_minutes: 25 }, 0), 409);
  });
  add("Coach recent Trace estimate uses last five positive included rows in adapter order", assert => {
    const rows = [
      { game_id: "a", minutes: 1 }, { game_id: "b", minutes: 2 }, { game_id: "c", minutes: 0 },
      { game_id: "x", minutes: 100 }, { game_id: "d", minutes: 3 }, { game_id: "e", minutes: 4 },
      { game_id: "f", minutes: 5 }, { game_id: "g", minutes: 6 }, { game_id: "h", minutes: null }
    ];
    const o = createOriginalCoachOracle({ history: { p1: rows }, includedGames: ["a", "b", "c", "d", "e", "f", "g", "h"] });
    assert.deepEqual(o.coachHistoryMinutes({ id: "p1" }), [2, 3, 4, 5, 6]);
    assert.deepEqual(o.coachHistoryMinutes(null), []);
  });
  add("Coach recommendation exact score, descending top three and reason retain recent-history provenance", assert => {
    const players = { p1: { id: "p1", resolved_position: "GK" } };
    const o = createOriginalCoachOracle({ players, history: { p1: [{ game_id: "x", minutes: 6 }, { game_id: "y", minutes: 8 }, { game_id: "z", minutes: 10 }] } });
    const s = coachState({ count: 5, phase: "paused", field: { 0: "p0" }, minutes_ms: { p0: 600000, p1: 120000, p2: 300000, p3: 0, p4: 900000 } });
    const profiles = { p0: { target_minutes: 5 },
      p1: { positions: { GK: 5 }, endurance: 4, target_minutes: 20 },
      p2: { positions: { GK: 4 }, endurance: 5, target_minutes: 20 },
      p3: { positions: { GK: 3 }, endurance: 3, target_minutes: 20 },
      p4: { positions: { GK: 5 }, endurance: 5, target_minutes: 20 } };
    const result = o.coachRecommendations(s, profiles);
    assert.deepEqual(result.map(r => r.in.id), ["p1", "p4", "p2"]);
    assert.deepEqual(result.map(r => r.slot), [0, 0, 0]);
    const expected = [54 + 2 / 3, 48 + 5 / 6, 46 + 2 / 3];
    result.forEach((r, i) => assert.ok(Math.abs(r.score - expected[i]) < 1e-10));
    assert.equal(result[0].reason, "5/5 at GK · 2 min today; Player 0 10 min · recent Trace estimate ~8 min");
    assert.equal(result[1].reason, "5/5 at GK · 15 min today; Player 0 10 min");
    for (const phase of ["planning", "halftime", "finished"])
      assert.deepEqual(o.coachRecommendations({ ...s, phase }, profiles), []);
  });
  add("Coach recommendations admit same-group or resolved-role evidence and reject unavailable substitutes", assert => {
    const o = createOriginalCoachOracle({ players: { p2: { id: "p2", resolved_position: "LCB" } } });
    const s = coachState({ count: 5, phase: "paused", field: { 3: "p0" }, active: ["p0", "p1", "p2", "p4"] });
    const result = o.coachRecommendations(s, { p1: { positions: { RB: 4 } }, p3: { positions: { LCB: 5 } }, p4: { positions: { ST: 5 } } });
    assert.deepEqual(result.map(r => r.in.id).sort(), ["p1", "p2"]);
    assert.ok(result.find(r => r.in.id === "p1").reason.startsWith("def position"));
    assert.ok(result.find(r => r.in.id === "p2").reason.startsWith("Played here previously"));
  });
  add("Coach recommendation target zero is explicit and history affects explanation only", assert => {
    const s = coachState({ count: 2, phase: "paused", field: { 0: "p0" }, minutes_ms: {} });
    const profiles = { p0: { target_minutes: 0 }, p1: { positions: { GK: 5 }, target_minutes: 0, endurance: 3 } };
    const noHistory = createOriginalCoachOracle().coachRecommendations(s, profiles);
    const withHistory = createOriginalCoachOracle({ history: { p1: [{ minutes: 90, game_id: "x" }] } }).coachRecommendations(s, profiles);
    assert.equal(noHistory[0].score, 46);
    assert.equal(withHistory[0].score, noHistory[0].score);
    assert.equal(withHistory[0].reason.endsWith("recent Trace estimate ~90 min"), true);
  });
  add("Coach default recommendation target uses full roster count including unavailable players", assert => {
    const s = coachState({ count: 10, phase: "paused", field: { 0: "p0" }, active: ["p0", "p1"], half_minutes: 5 });
    const r = createOriginalCoachOracle().coachRecommendations(s, { p1: { positions: { GK: 1 } } });
    assert.ok(Math.abs(r[0].score - (8 + 3 + 7 / 3 + 3)) < 1e-10);
  });
  add("Coach suggested seven and nine player lineups retain original slot order without duplicates or inactive players", assert => {
    const o = createOriginalCoachOracle();
    for (const [format, expected] of [[7, [0, 3, 6, 10, 14, 19, 21]], [9, [0, 2, 4, 6, 10, 12, 14, 17, 21]]]) {
      const s = coachState({ count: 11, format, active: Array.from({ length: 10 }, (_, i) => "p" + (i + 1)) });
      const field = o.coachSuggestedField(s, {});
      assert.deepEqual(Object.keys(field).map(Number), expected);
      assert.deepEqual(Object.values(field), Array.from({ length: format }, (_, i) => "p" + (i + 1)));
      assert.equal(new Set(Object.values(field)).size, format);
    }
  });
  add("Coach suggested lineup exact rating outranks group evidence and assigned natural role breaks ties", assert => {
    const o = createOriginalCoachOracle({ players: { p0: { id: "p0", assigned_position: "GK" } } });
    const s = coachState({ count: 4, active: ["p0", "p1", "p2", "p3"] });
    assert.equal(o.coachSuggestedField(s, { p1: { positions: { GK: 1 } }, p2: { positions: { GK: 5 } } })[0], "p2");
    assert.equal(o.coachSuggestedField(s, {})[0], "p0");
    const field = o.coachSuggestedField(s, { p0: { positions: { GK: 5 } }, p1: { positions: { CB: 5 } }, p2: { positions: { LCB: 4 } } });
    assert.equal(field[3], "p2"); // LCB 4*10 + same-group 4*3 outranks CB same-group 5*3.
  });
  add("Coach original source format accepts parsed 7 or 9 and falls back to seven", assert => {
    const o = createOriginalCoachOracle();
    assert.equal(o.coachFormat({ game: { format: "9v9" } }), 9);
    assert.equal(o.coachFormat({ game: { format: "7v7" } }), 7);
    assert.equal(o.coachFormat({ game: { format: "11v11" } }), 7);
    assert.equal(o.coachFormat({}), 7);
  });
  return cases;
}
