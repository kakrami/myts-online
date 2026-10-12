import { validateHalfWindows, normalizeSegments, intervalDuration } from './intervals.js';
import { allocateHalf } from './allocation.js';
import { normalizePosition, inferSpatialPosition, resolveLineup } from './lineup.js';

export const RESOLVER_VERSION = '1.0.1';
const EPS = 1e-7;
const own = (value, key) => value != null && Object.hasOwn(value, key) && value[key] != null;
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const number = (value, label) => {
 if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(label + ' must be finite and nonnegative');
 return value===0?0:value;
};
const identifier = (value, label) => {
 if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new TypeError(label + ' must be a nonempty bounded string');
 return value;
};
const freeze = value => {
 if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
 return value;
};
const fact = (value, kind = 'unknown', basis = null, sourceRefs = [], extra = {}) => ({
 value: value ?? null, state: value == null ? 'unknown' : kind,
 provenance: { kind: value == null ? 'unknown' : kind, basis, sourceRefs: [...new Set(sourceRefs)].sort(cmp), ...extra }
});
function facts(value = {}, label = 'facts') {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label + ' must be an object');
 const result = {};
 for (const key of ['totalSeconds','fieldSeconds','gkSeconds','goals','assists']) if (own(value,key)) {
  result[key] = number(value[key], label + '.' + key);
  if ((key === 'goals' || key === 'assists') && !Number.isInteger(result[key])) throw new TypeError(key + ' must be an integer');
 }
 for (const key of ['slotX','slotY']) if (own(value,key)) {result[key]=number(value[key],label+'.'+key);if(result[key]>100)throw new RangeError('pitch point exceeds 100');}
 if (own(result,'slotX')!==own(result,'slotY')) throw new RangeError('pitch point needs both coordinates');
 if (own(value,'slot') && own(result,'slotX')) throw new RangeError('choose format slot or pitch point intent');
 for (const key of ['appearance','started']) if (own(value,key)) {
  if (typeof value[key] !== 'boolean') throw new TypeError(label + '.' + key + ' must be boolean');
  result[key] = value[key];
 }
 if (own(value,'position') && !(typeof value.position==='string' && value.position.trim()==='')) {
  result.position = normalizePosition(value.position)?.label;
  if (!result.position) throw new RangeError('unsupported position');
 }
 if (own(value,'role')) {
  if (!['field','goalkeeper','unknown'].includes(value.role)) throw new RangeError('unsupported participation role');
  result.role = value.role;
 }
 if (own(value,'slot')) {
  if (!Number.isInteger(value.slot) || value.slot < 1 || value.slot > 9) throw new RangeError('slot must be 1..9');
  result.slot = value.slot;
 }
 return result;
}
function layer(input = {}, label) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(label + ' must be an object');
 if (own(input.match,'slot')) throw new RangeError('slot is a half-only decision');
 if(label==='reported') for(const row of [input.match,input.halves?.[1],input.halves?.[2]]) for(const key of ['slot','slotX','slotY'])
  if(own(row,key))throw new RangeError('layout anchors are manual-only decisions');
 for (const half of [1,2]) for (const key of ['goals','assists']) if (own(input.halves?.[half],key)) throw new RangeError(key + ' is a match-only fact');
 return { match: facts(input.match ?? {}, label + '.match'), halves: {
  1: facts(input.halves?.[1] ?? {}, label + '.halves.1'),
  2: facts(input.halves?.[2] ?? {}, label + '.halves.2')
 }};
}
function spatial(input) {
 if (input == null) return null;
 if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('spatial must be an object');
 const result = {};
 for (const key of ['avg_x','avg_y','samples','attacking_third_pct','defensive_third_pct','grid_cols','grid_rows']) if (own(input,key))
  result[key] = number(input[key], 'spatial.' + key);
 for (const key of ['avg_x','avg_y']) if (result[key] > 1) throw new RangeError('spatial coordinates must be normalized');
 if (own(input,'grid')) {
  if (!Array.isArray(input.grid) || input.grid.length > 4096) throw new RangeError('spatial grid exceeds limit');
  result.grid = input.grid.map(value => number(value, 'spatial.grid'));
 }
 if (own(input,'display_orientation')) result.display_orientation = String(input.display_orientation).slice(0,64);
 if (own(input,'source')) result.source = String(input.source).slice(0,64);
 result.tactical_left_is_top = input.tactical_left_is_top === true;
 return result;
}
const pick = (p, half, key) => {
 for (const kind of ['manual','reported']) {
  if (half != null && own(p[kind].halves[half],key)) return fact(p[kind].halves[half][key],kind,'half_decision');
  if (own(p[kind].match,key) && !(key === 'started' && half === 2) && key !== 'slot')
   return fact(p[kind].match[key],kind,'match_decision');
 }
 return fact(null);
};
/** Resolve one canonical event from bounded, already-authorized DTOs. No IO or mutable globals.
 * A source/account/date/season/revision fence remains the adapter's responsibility.
 * The commitSignature is echoed opaquely, never treated as proof of current authority.
 */
export function resolveMatchAnalysis(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input must be an object');
 const context = {};
 for (const key of ['teamId','seasonId','eventId']) context[key] = identifier(input.context?.[key], 'context.' + key);
 for (const key of ['inputRevision','sourceRevision','commitSignature','timezone']) if (own(input.context,key)) {
  const value = input.context[key];
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0))
   throw new TypeError('context.' + key + ' must be a scalar revision/string');
  if (typeof value === 'string' && value.length > 2048) throw new RangeError('context value exceeds limit');
  context[key] = value;
 }
 const issues = [], issue = (code, severity = 'error', detail = {}) => issues.push({code,severity,...detail});
 const formatInput = input.format ?? {};
 let format = fact(null);
 for (const kind of ['manual','reported','inferred']) if (own(formatInput,kind)) {
  if (formatInput[kind] !== 7 && formatInput[kind] !== 9) throw new RangeError('only evidenced 7v7/9v9 formats are supported');
  if (format.value == null) format = fact(formatInput[kind],kind,kind === 'inferred' ? 'verified_format_metadata' : 'format_decision');
 }
 if (format.value == null && input.formatEvidence != null) {
  const e = input.formatEvidence;
  if (own(e,'ownSlots') && (e.ownSlots === 7 || e.ownSlots === 9)) format = fact(e.ownSlots,'inferred','verified_own_slots');
  else if (e.bothSidesVerified === true && e.historyFormatFamily === '7_or_9' && typeof e.baselineTracks==='number' && Number.isFinite(e.baselineTracks) && e.baselineTracks>0)
   format = fact(e.baselineTracks>=17 || e.declaredFormat===9 ? 9 : 7,'inferred','original_verified_history_population');
  else if (e.bothSidesVerified === true && (e.baselineTracks === 14 || e.baselineTracks === 18))
   format = fact(e.baselineTracks / 2,'inferred','verified_both_sides_baseline');
 }
 const expectedHalves = input.expectedHalves ?? 2;
 if (expectedHalves !== 1 && expectedHalves !== 2) throw new RangeError('expectedHalves must be 1 or 2');
 const expectedHalfIds=expectedHalves===1?[1]:[1,2];
 const windows = validateHalfWindows(input.halves ?? []).map(w => {
  const result = {id:w.id,start:w.start,end:w.end,complete:w.complete === true};
  for (const key of ['clockOriginMs','reportedClockOriginSeconds']) if (own(w,key)) result[key] = w[key];
  return result;
 }).sort((a,b) => a.id - b.id);
 if (expectedHalves === 1 && windows.some(w => w.id !== 1)) throw new RangeError('one-half event requires half 1');
 const completeWindows = windows.length === expectedHalves;
 const durationSeconds = completeWindows ? windows.reduce((n,w) => n + (w.end-w.start),0) : null;
 if (durationSeconds != null && !Number.isFinite(durationSeconds * (format.value ?? 1))) throw new RangeError('match duration exceeds finite accounting');
 if (!Array.isArray(input.players) || input.players.length > 128) throw new RangeError('players must be an array of at most 128');
 const ids = new Set();
 const players = input.players.map(raw => {
  const id = identifier(raw.id,'player.id');
  if (ids.has(id)) throw new RangeError('duplicate canonical player'); ids.add(id);
  if (typeof raw.eligible !== 'boolean') throw new TypeError('player.eligible must be boolean');
  const manual = layer(raw.manual ?? {},'manual'), reported = layer(raw.reported ?? {},'reported');
  if (expectedHalves===1 && (Object.keys(manual.halves[2]).length || Object.keys(reported.halves[2]).length || raw.spatial?.halves?.[2]!=null))
   throw new RangeError('half 2 evidence is outside a one-half event');
  const seasonPosition = raw.season?.position == null || raw.season.position === '' ? null : normalizePosition(raw.season.position)?.label;
  if (raw.season?.position && !seasonPosition) throw new RangeError('unsupported season position');
  return {id,eligible:raw.eligible,manual,reported,seasonPosition,
   spatial: {match:spatial(raw.spatial?.match),halves:{1:spatial(raw.spatial?.halves?.[1]),2:spatial(raw.spatial?.halves?.[2])}},
   refs:{1:[],2:[]}, observed:{1:{field:[],goalkeeper:[],unknown:[]},2:{field:[],goalkeeper:[],unknown:[]}}
  };
 }).sort((a,b) => cmp(a.id,b.id));
 const byId = new Map(players.map(p => [p.id,p]));
 if (!Array.isArray(input.observations ?? []) || (input.observations ?? []).length > 2048) throw new RangeError('observations exceed limit');
 const unassigned = [], keeper = {1:[],2:[]}; let intervalCount = 0;
 const observationIds = new Set();
 for (const raw of [...(input.observations ?? [])].sort((a,b) => cmp(a.id,b.id))) {
  const id = identifier(raw.id,'observation.id');
  if (observationIds.has(id)) throw new RangeError('duplicate observation identity'); observationIds.add(id);
  if (raw.half !== 1 && raw.half !== 2) throw new RangeError('observation half must be 1 or 2');
  if (expectedHalves===1 && raw.half===2) throw new RangeError('half 2 observation is outside a one-half event');
  if (!['own','opponent'].includes(raw.side) || typeof raw.dummy !== 'boolean' || !['verified','unresolved'].includes(raw.mapping)
   || !['field','goalkeeper','unknown'].includes(raw.role)) throw new TypeError('observation requires explicit side/dummy/mapping/role');
  const sourceId = identifier(raw.source?.id,'source.id');
  if (!Array.isArray(raw.segments)) throw new TypeError('observation segments must be an array');
  intervalCount += raw.segments.length;
  if (intervalCount > 4096) throw new RangeError('match interval input exceeds limit');
  const window = windows.find(w => w.id === raw.half);
  const segments = normalizeSegments(raw.segments,window ?? null);
  const p = raw.playerId == null ? null : byId.get(raw.playerId);
  let reason = raw.side !== 'own' ? 'opponent' : raw.dummy ? 'dummy' : !window ? 'missing_half_window' : raw.mapping !== 'verified' ? 'unresolved_mapping'
   : !p ? 'unmapped_identity' : !p.eligible ? 'outside_dated_eligibility' : null;
  if (reason) {
   unassigned.push({id,half:raw.half,sourceId,reason,observedSeconds:intervalDuration(segments)});
   if (raw.side === 'own' && !raw.dummy && raw.role === 'goalkeeper' && !p) keeper[raw.half].push(...segments);
   continue;
  }
  p.observed[raw.half][raw.role].push(...segments); p.refs[raw.half].push(sourceId);
 }
 for (const p of players) for (const half of [1,2]) {
  for (const role of ['field','goalkeeper','unknown']) p.observed[half][role] = normalizeSegments(p.observed[half][role],windows.find(w => w.id===half) ?? null);
  p.refs[half] = [...new Set(p.refs[half])].sort(cmp);
 }
 // Whole-match quantities have unknown timing. Apportion only across all actual
 // windows; explicit same-priority half quantities stay pinned. No nominal halves.
 const portions = new Map();
 for (const p of players) {
  const result = {manual:{1:{},2:{}},reported:{1:{},2:{}}};
  for (const kind of ['manual','reported']) for (const key of ['totalSeconds','fieldSeconds','gkSeconds']) {
   const matchValue = p[kind].match[key];
   for (const w of windows) if (own(p[kind].halves[w.id],key)) result[kind][w.id][key] = p[kind].halves[w.id][key];
   if (matchValue == null || !completeWindows) continue;
   const pinned = windows.filter(w => own(p[kind].halves[w.id],key));
   const fixed = pinned.reduce((n,w) => n + p[kind].halves[w.id][key],0);
   const open = windows.filter(w => !own(p[kind].halves[w.id],key));
   const remaining = matchValue - fixed;
   if (remaining < -EPS || (!open.length && Math.abs(remaining) > EPS)) {
    const superseded=kind==='reported' && windows.every(w=>own(p.manual.match,key)||own(p.manual.halves[w.id],key)||pick(p,w.id,'appearance').state==='manual'&&pick(p,w.id,'appearance').value===false);
    issue('match_half_quantity_conflict',superseded?'warning':'error',{playerId:p.id,kind,field:key,matchSeconds:matchValue,halfSeconds:fixed,superseded});
    continue;
   }
   const span = open.reduce((n,w) => n + (w.end-w.start),0);
   for (const w of open) result[kind][w.id][key] = Math.max(0,remaining) * (w.end-w.start) / span;
  }
  portions.set(p.id,result);
 }
 const halfResults = {}, halfFacts = {};
 for (const w of windows) {
  const roster = players.map(p => {
   let appearance = pick(p,w.id,'appearance'); const started = pick(p,w.id,'started'), position = pick(p,w.id,'position'), role = pick(p,w.id,'role');
   const observed = p.observed[w.id], all = normalizeSegments([...observed.field,...observed.goalkeeper,...observed.unknown],w);
   if(appearance.value===true&&appearance.provenance.basis==='match_decision') appearance=fact(null,'unknown','whole_participation_has_unasserted_half_timing');
   const observedProof=intervalDuration(all)>0,openingProof=started.value===true;
   let a=appearance.value;
   if(a==null&&(observedProof||openingProof))a=true;
   let s = started.value;
   const values = portions.get(p.id), scalars = {};
   for (const kind of ['manual','reported']) {
    const total = values[kind][w.id].totalSeconds, field = values[kind][w.id].fieldSeconds, gk = values[kind][w.id].gkSeconds;
    if (total != null) scalars[kind+'Seconds'] = total;
    if (gk != null) scalars[kind+'GkSeconds'] = gk;
    if (field != null) scalars[kind+'FieldSeconds'] = field;
   }
   const halfQuantityProof=['manual','reported'].some(kind=>['totalSeconds','fieldSeconds','gkSeconds'].some(key=>(p[kind].halves[w.id][key]??0)>0));
   if(a==null&&halfQuantityProof)a=true;
   if (appearance.state === 'reported' && appearance.value === false && ((scalars.manualSeconds ?? 0)>0 || (scalars.manualGkSeconds ?? 0)>0 || (scalars.manualFieldSeconds ?? 0)>0)) {
    a=observedProof||openingProof||['totalSeconds','fieldSeconds','gkSeconds'].some(key=>(p.manual.halves[w.id][key]??0)>0)?true:null;
    appearance=fact(a,a===true?'manual':'unknown','manual_quantity_overrides_reported_dnp',p.refs[w.id]);
   }
   // Explicit participation decisions outrank uncorrected observation evidence.
   if (appearance.value === false) {
    const kind = appearance.state;
    if (scalars[kind+'Seconds'] == null) scalars[kind+'Seconds'] = 0;
    if (scalars[kind+'GkSeconds'] == null) scalars[kind+'GkSeconds'] = 0;
    if (scalars[kind+'FieldSeconds'] == null) scalars[kind+'FieldSeconds'] = 0;
   }
   if (s == null && a !== false && all.some(([start,end]) => start < w.start + 30 && end > w.start)) s = true;
   if (s == null && (a === false || (w.complete && all.length>0))) s = false;
   if (a === false && s === true) issue('dnp_started_conflict','error',{playerId:p.id,half:w.id});
   halfFacts[p.id] ??= {};
   halfFacts[p.id][w.id] = {
    appearance: appearance.value == null ? fact(a,a==null?'unknown':'inferred',a===true?'evidenced_half_participation':a===false?'confirmed_half_nonparticipation':'no_half_participation_proof',p.refs[w.id]) : appearance,
    started: started.value==null?(a===false?fact(false,appearance.state,'confirmed_dnp_nonstarter',[],{participation:appearance}):fact(s,s==null?'unknown':'inferred',s===true?'observed_opening_window':s===false?'complete_late_participation':'no_half_start_proof',p.refs[w.id])):started,
    position, role,
    slot: pick(p,w.id,'slot'),slotX:pick(p,w.id,'slotX'),slotY:pick(p,w.id,'slotY')
   };
   return {id:p.id,eligible:p.eligible,appearance:a,started:s,position:position.value,role:role.value,
    segments:observed.field,goalkeeperSegments:observed.goalkeeper,unknownRoleSegments:observed.unknown,
    allowEstimate:completeWindows||!['totalSeconds','fieldSeconds','gkSeconds'].some(key=>pick(p,null,key).value!=null),...scalars};
  });
  const result = allocateHalf({format:format.value,window:w,players:roster,keeperSegments:keeper[w.id],
   evidenceComplete:w.complete,estimateCapacity:input.estimateCapacity!==false});
  halfResults[w.id] = result;
  for (const v of result.violations) issue(v.code,'error',{half:w.id,...v});
 }
 const rows = players.map(p => {
  const halves = {}, metric = key => {
   const values = windows.map(w => halfResults[w.id].players.find(r => r.id===p.id)?.[key] ?? null);
   const amount=completeWindows&&values.every(v=>v!==null)?values.reduce((n,v)=>n+v,0):null;
   if(amount!=null&&!Number.isFinite(amount)){issue('allocation_numeric_overflow','error',{playerId:p.id,field:key});return null;}
   return amount;
  };
  for (const w of windows) {
   const r = halfResults[w.id].players.find(row => row.id===p.id), h = halfFacts[p.id][w.id];
   const secondsFact = (value,role) => {
    const basis=role==='total'?r.provenance.total:role==='field'?r.provenance.field:r.provenance.goalkeeper;
    const estimated=role!=='goalkeeper'&&r.estimatedSeconds>EPS;
    const kind=estimated?'estimated':basis==='manual'?'manual':basis==='reported'?'reported':basis==='mixedderived'||basis?.includes('manual')||basis?.includes('reported')?'mixed':value==null?'unknown':'inferred';
    return fact(value,kind,role==='total'?'effective_half_quantity':'effective_half_role',p.refs[w.id],
     {allocation:{...r.provenance},observedSeconds:r.observedSeconds,estimatedSeconds:role==='goalkeeper'?0:r.estimatedSeconds,halfTiming:'unasserted_for_scalars_and_estimates'});
   };
   halves[w.id] = {...h,totalSeconds:secondsFact(r.totalSeconds,'total'),fieldSeconds:secondsFact(r.fieldSeconds,'field'),
    gkSeconds:secondsFact(r.gkSeconds,'goalkeeper'),
    lowerBoundSeconds:fact(r.lowerBoundSeconds,r.totalSeconds==null?'inferred':secondsFact(r.totalSeconds,'total').state,'supported_quantity_lower_bound',p.refs[w.id],{exactTotal:r.totalSeconds!=null}),
    observedSeconds:r.observedSeconds,estimatedSeconds:r.estimatedSeconds,unknownRoleSeconds:r.unknownRoleSeconds};
  }
  const aggregate = key => {
   const amount = metric(key);
   const entries = windows.map(w=>halves[w.id]?.[key]).filter(Boolean);
   const kinds = [...new Set(entries.filter(f=>f.value!==null).map(f=>f.state))];
   return fact(amount,kinds.length===1?kinds[0]:'mixed','sum_actual_halves',p.refs[1].concat(p.refs[2]),
    {parts:entries.map((f,index)=>({half:windows[index].id,value:f.value,state:f.state}))});
  };
  let totalSeconds = aggregate('totalSeconds'), fieldSeconds = aggregate('fieldSeconds'), gkSeconds = aggregate('gkSeconds');
  // Missing windows leave the match quantity usable, with half/role accounting
  // explicitly unavailable. A match correction never creates absent windows.
  const derived=(value,parts,basis)=>{
   if(!Number.isFinite(value)){issue('allocation_numeric_overflow','error',{playerId:p.id});value=null;}
   const kinds=[...new Set(parts.map(part=>part.fact.state))],kind=kinds.length===1?kinds[0]:'mixed';
   return fact(value,kind,basis,p.refs[1].concat(p.refs[2]),{parts:parts.map(part=>({field:part.field,value:part.fact.value,state:part.fact.state})),halfTiming:'unavailable_without_all_actual_windows'});
  };
  if (!completeWindows) {
   const quantity=key=>{
    const global=pick(p,null,key);
    const explicit=expectedHalfIds.map(half=>{
     for(const kind of ['manual','reported']) {
      if(own(p[kind].halves[half],key))return{half,kind,fact:fact(p[kind].halves[half][key],kind,'explicit_half_quantity')};
      if(p[kind].halves[half].appearance===false)return{half,kind,fact:fact(0,kind,'explicit_half_dnp')};
     }
     return{half,kind:null,fact:fact(null)};
    });
    const manual=explicit.filter(part=>part.kind==='manual');
    if(global.state==='manual') {
     const fixed=manual.reduce((n,part)=>n+part.fact.value,0);
     if(fixed>global.value+EPS || manual.length===expectedHalfIds.length&&Math.abs(fixed-global.value)>EPS)
      issue('match_half_quantity_conflict','error',{playerId:p.id,kind:'manual',field:key,matchSeconds:global.value,halfSeconds:fixed});
     return global;
    }
    if(explicit.every(part=>part.fact.value!=null)) {
     const amount=explicit.reduce((n,part)=>n+part.fact.value,0),parts=explicit.map(part=>({field:'half_'+part.half,fact:part.fact}));
     if(!manual.length&&global.state==='reported'&&Math.abs(global.value-amount)>EPS)
      issue('match_half_quantity_conflict',expectedHalfIds.every(half=>pick(p,half,'appearance').state==='manual'&&pick(p,half,'appearance').value===false)?'warning':'error',{playerId:p.id,kind:'reported',field:key,matchSeconds:global.value,halfSeconds:amount});
     return derived(amount,parts,'sum_explicit_halves_without_windows');
    }
    if(manual.length&&global.state==='reported') return fact(null,'unknown','partial_half_override_without_distribution');
    return global;
   };
   totalSeconds=quantity('totalSeconds');fieldSeconds=quantity('fieldSeconds');gkSeconds=quantity('gkSeconds');
   if(totalSeconds.value==null&&fieldSeconds.value!=null&&gkSeconds.value!=null)
    totalSeconds=derived(fieldSeconds.value+gkSeconds.value,[{field:'field',fact:fieldSeconds},{field:'goalkeeper',fact:gkSeconds}],'explicit_field_plus_keeper');
   if(totalSeconds.value!=null&&fieldSeconds.value!=null&&gkSeconds.value==null&&fieldSeconds.value<=totalSeconds.value)
    gkSeconds=derived(totalSeconds.value-fieldSeconds.value,[{field:'total',fact:totalSeconds},{field:'field',fact:fieldSeconds}],'explicit_total_minus_field');
   if(totalSeconds.value!=null&&gkSeconds.value!=null&&fieldSeconds.value==null&&gkSeconds.value<=totalSeconds.value)
    fieldSeconds=derived(totalSeconds.value-gkSeconds.value,[{field:'total',fact:totalSeconds},{field:'goalkeeper',fact:gkSeconds}],'explicit_total_minus_keeper');
  }
  let appearance = pick(p,null,'appearance');
  const explicitHalfAppearance=expectedHalfIds.some(half=>own(p.manual.halves[half],'appearance') || own(p.reported.halves[half],'appearance'));
  if (explicitHalfAppearance) {
   const parts=expectedHalfIds.map(half=>({half,...(halves[half]?.appearance??pick(p,half,'appearance'))})),values=parts.map(part=>part.value);
   const value=values.some(v=>v===true)?true:values.every(v=>v===false)?false:appearance.value===true?true:null;
   const kinds=[...new Set(parts.map(part=>part.state))],kind=kinds.length===1?kinds[0]:'mixed';
   const wholeOnlyPositive=value===true&&!values.some(v=>v===true)&&appearance.value===true;
   appearance=fact(value,wholeOnlyPositive?appearance.state:kind,wholeOnlyPositive?'whole_participation_half_timing_unknown':'effective_half_appearance',p.refs[1].concat(p.refs[2]),{parts:parts.map(part=>({half:part.half,value:part.value,state:part.state}))});
  }
  if (appearance.value == null) {
   const halfAppearances = Object.values(halves).map(h=>h.appearance.value);
   const any = halfAppearances.some(v=>v===true) || [totalSeconds,fieldSeconds,gkSeconds].some(f=>(f.value??0)>0);
   const dnp = completeWindows && halfAppearances.every(v=>v===false);
   appearance = fact(any?true:dnp?false:null,any||dnp?'inferred':'unknown',any?'evidenced_match_participation':dnp?'all_halves_dnp':'no_match_participation_proof',p.refs[1].concat(p.refs[2]));
  }
  const manualPositive=[totalSeconds,fieldSeconds,gkSeconds].some(f=>(f.value??0)>0&&(f.state==='manual'||f.state==='mixed'));
  if (appearance.state==='reported' && appearance.value===false && manualPositive) appearance=fact(true,'manual','manual_quantity_overrides_reported_dnp');
  if(!completeWindows&&appearance.value===false) {
   const selected=appearance.state==='manual'?'manual':'reported',dnpZero=current=>{
    const explicitSame=current.state===selected||(current.state==='mixed'&&current.provenance.parts?.some(part=>part.state===selected));
    return explicitSame&&current.value!=null?current:fact(0,selected,'clock_independent_dnp');
   };
   totalSeconds=dnpZero(totalSeconds);fieldSeconds=dnpZero(fieldSeconds);gkSeconds=dnpZero(gkSeconds);
  }
  if(totalSeconds.value===0) {
   if(fieldSeconds.value==null)fieldSeconds=fact(0,totalSeconds.state,'zero_total_implies_zero_field');
   if(gkSeconds.value==null)gkSeconds=fact(0,totalSeconds.state,'zero_total_implies_zero_keeper');
  }
  if(totalSeconds.value!=null&&fieldSeconds.value!=null&&fieldSeconds.value>totalSeconds.value+EPS)
   issue('match_field_exceeds_total','error',{playerId:p.id});
  if(totalSeconds.value!=null&&gkSeconds.value!=null&&gkSeconds.value>totalSeconds.value+EPS)
   issue('match_goalkeeper_exceeds_total','error',{playerId:p.id});
  if(totalSeconds.value!=null&&fieldSeconds.value!=null&&gkSeconds.value!=null&&Math.abs(fieldSeconds.value+gkSeconds.value-totalSeconds.value)>EPS)
   issue('match_role_conservation','error',{playerId:p.id});
  if (appearance.value===false && (totalSeconds.value ?? 0)>0) issue('match_dnp_positive_seconds','error',{playerId:p.id});
  let effectiveStart=halves[1]?.started??pick(p,1,'started');
  if(appearance.value===false&&effectiveStart.value==null)effectiveStart=fact(false,appearance.state,'confirmed_dnp_nonstarter');
  if(appearance.value===false&&effectiveStart.value===true)issue('match_dnp_started_conflict','error',{playerId:p.id});
  if(!p.eligible&&(appearance.value===true||effectiveStart.value===true||[totalSeconds,fieldSeconds,gkSeconds].some(f=>(f.value??0)>0)))
   issue('participation_outside_eligibility','error',{playerId:p.id});
  return {id:p.id,eligible:p.eligible,appearance,started:effectiveStart,position:pick(p,null,'position'),
   totalSeconds,fieldSeconds,gkSeconds,minutes:fact(totalSeconds.value==null?null:totalSeconds.value/60,totalSeconds.state,totalSeconds.provenance.basis,totalSeconds.provenance.sourceRefs,{seconds:totalSeconds}),
   fieldMinutes:fact(fieldSeconds.value==null?null:fieldSeconds.value/60,fieldSeconds.state,fieldSeconds.provenance.basis,fieldSeconds.provenance.sourceRefs,{seconds:fieldSeconds}),
   gkMinutes:fact(gkSeconds.value==null?null:gkSeconds.value/60,gkSeconds.state,gkSeconds.provenance.basis,gkSeconds.provenance.sourceRefs,{seconds:gkSeconds}),
   goals:pick(p,null,'goals'),assists:pick(p,null,'assists'),halves,
   observedSeconds:windows.reduce((n,w)=>n+(halves[w.id]?.observedSeconds??0),0),
   estimatedSeconds:windows.reduce((n,w)=>n+(halves[w.id]?.estimatedSeconds??0),0),
   _seasonPosition:p.seasonPosition,_spatial:p.spatial};
 });
 const positionFor = (row,half) => {
  const p = byId.get(row.id), chosen = half==null?row.position:row.halves[half].position;
  if (chosen.value!=null) return chosen;
  const quantities = half==null?row:row.halves[half];
  const total = quantities.totalSeconds.value, gk = quantities.gkSeconds.value;
  if (total!=null && total>0 && gk!=null && gk>=300 && gk>=.6*total) return fact('GK','inferred','keeper_display_threshold',p.refs[1].concat(p.refs[2]));
  const sp = half==null?p.spatial.match:(p.spatial.halves[half]??p.spatial.match);
  const peers = rows.map(other=>({id:other.id,minutes:(half==null?other.totalSeconds.value:other.halves[half].totalSeconds.value)/60,
   gkMinutes:(half==null?other.gkSeconds.value:other.halves[half].gkSeconds.value)/60,
   spatial:half==null?other._spatial.match:(other._spatial.halves[half]??other._spatial.match)}));
  const inferred = inferSpatialPosition({id:row.id,minutes:total==null?null:total/60,gkMinutes:gk==null?null:gk/60,spatial:sp},peers);
  if (inferred) return fact(inferred.label === '—'?inferred.group:inferred.label,'inferred','verified_spatial_position',p.refs[1].concat(p.refs[2]));
  return fact(p.seasonPosition,p.seasonPosition?'season_default':'unknown','season_position_default');
 };
 for (const row of rows) {
  row.position = positionFor(row,null);
  for (const w of windows) row.halves[w.id].position = positionFor(row,w.id);
  const p = byId.get(row.id);
  const explicitHalf = expectedHalfIds.some(half=>own(p.manual.halves[half],'position') || own(p.reported.halves[half],'position'));
  if (explicitHalf) {
   const parts = expectedHalfIds.map(half=>({half,...(row.halves[half]?.position??pick(p,half,'position'))}));
   const values = parts.map(part=>part.value), kinds=[...new Set(parts.map(part=>part.state))];
   const groups = values.map(value=>normalizePosition(value)?.group);
   const value = values.every(v=>v!=null) && values.every(v=>v===values[0]) ? values[0]
    : groups.every(Boolean) && groups.every(v=>v===groups[0]) ? groups[0] : null;
   const kind=value!=null&&values.every(v=>v===values[0])&&kinds.length===1?kinds[0]:'mixed';
   row.position={value,state:kind,provenance:{kind,basis:'effective_half_positions',sourceRefs:[...new Set(p.refs[1].concat(p.refs[2]))].sort(cmp),
    parts:parts.map(part=>({half:part.half,value:part.value,state:part.state}))}};
  }
 }
 const lineups = {};
 for (const w of windows) lineups[w.id] = resolveLineup({format:format.value,half:w.id,players:rows.map(r=>{
  const h = r.halves[w.id];
  return {id:r.id,eligible:r.eligible,appearance:h.appearance.value,started:h.started.value,
   minutes:h.totalSeconds.value==null?null:h.totalSeconds.value/60,gkMinutes:h.gkSeconds.value==null?null:h.gkSeconds.value/60,
   position:{value:h.position.value,provenance:{kind:h.position.state}},manualSlot:h.slot.value,
   manualPoint:h.slotX.state==='manual'&&h.slotY.state==='manual'?{x:h.slotX.value,y:h.slotY.value}:null,
   spatial:r._spatial.halves[w.id]??r._spatial.match};
 })});
 for (const row of rows) {delete row._seasonPosition;delete row._spatial;}
 const sumKnown = key => {
  const values=windows.map(w=>halfResults[w.id][key]);
  return completeWindows && values.every(v=>v!=null)?values.reduce((a,b)=>a+b,0):null;
 };
 const totals={capacitySeconds:sumKnown('capacitySeconds'),assignedSeconds:sumKnown('assignedSeconds'),
  unassignedGkSeconds:sumKnown('unassignedGkSeconds'),unallocatedSeconds:sumKnown('unallocatedSeconds'),
  overCapacity:windows.some(w=>halfResults[w.id].overCapacity),assignedIsLowerBound:!completeWindows||windows.some(w=>halfResults[w.id].assignedIsLowerBound)};
 for (const w of windows) for (const warning of lineups[w.id].warnings ?? []) issue(typeof warning==='string'?warning:warning.code,'warning',{half:w.id});
 issues.sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b)));
 return freeze({version:RESOLVER_VERSION,context,format,durationSeconds,players:rows,lineups,halfAccounting:halfResults,totals,
  unassigned,issues,publishable:!issues.some(i=>i.severity==='error'),coverage:completeWindows&&format.value!=null?'bounded':'partial'});
}
