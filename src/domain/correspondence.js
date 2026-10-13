const parse=(v)=>typeof v==='string'?JSON.parse(v||'{}'):v||{};
const normalize=(s)=>String(s||'').trim().replace(/\s+/g,' ');
const id=()=>crypto.randomUUID();
const sameContext=(a,b)=>!!(a.name&&a.starts_on&&a.ends_on&&a.website_domain&&a.season_year)&&normalize(a.name)===normalize(b.name)&&a.starts_on===b.starts_on&&a.ends_on===b.ends_on&&a.website_domain===b.website_domain&&a.season_year===b.season_year;
function checkedParticipant(link,now) {
  const p=parse(link.evidence),observations=p.observations||[];
  const endpointProof=(path,season=false)=>observations.some(o=>o.endpoint===`https://gotsportlive-api.azurewebsites.net/api/clubapi/${path}`&&String(parse(o.params).ClubID)===String(p.club)&&(!season||String(parse(o.params).SeasonID)===String(p.season)));
  return p.external_source_name==='GotSport'&&Number(p.external_source_id)===6&&p.default_season===true&&String(p.item_id)===String(p.live_team_id)&&String(p.external_key)===String(p.team_id)&&p.club&&p.season&&p.season_name&&Date.parse(p.expires_at)>now&&Date.parse(p.verified_at)<=now+60000&&endpointProof('initclubteams')&&endpointProof('getteams',true)&&observations.every(o=>o.status===200&&/^[0-9a-f]{64}$/i.test(o.hash||'')&&Number.isFinite(Date.parse(o.at))&&now-Date.parse(o.at)<=6*3600000&&Date.parse(o.at)<=now+60000);
}

/** Native identity decisions are separate from display similarity. Only strict
 * complete-scope public evidence can create an automatic durable event link. */
export async function buildPublicCorrespondences(repo,visible,{now=Date.now()}={}) {
  const publicEvents=visible.filter(e=>['gotsport','live'].includes(e.provider)),competitionIds=[...new Set(publicEvents.filter(e=>e.competition_key).map(e=>e.competition_key))],divisionIds=[...new Set(publicEvents.filter(e=>e.division_key).map(e=>e.division_key))];
  if(!competitionIds.length&&!divisionIds.length)return {matches:[],reviews:[],canonicalCompetitions:new Map(),canonicalDivisions:new Map(),newCompetitions:[],newDivisions:[],metadataLinks:[],metadataAliases:[]};
  const [competitions,divisions,coverage,participantLinks,previous,eventLinks,competitionLinks,divisionLinks]=await Promise.all([
    repo.db.prepare('SELECT * FROM source_competitions WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(competitionIds)).all(),
    repo.db.prepare('SELECT * FROM source_divisions WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(divisionIds)).all(),
    repo.db.prepare('SELECT * FROM source_division_coverage WHERE source_division_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(divisionIds)).all(),
    repo.db.prepare('SELECT * FROM source_team_links WHERE a IN(SELECT value FROM json_each(?)) OR b IN(SELECT value FROM json_each(?))').bind(JSON.stringify(publicEvents.flatMap(e=>[e.home_source_team_id,e.away_source_team_id]).filter(Boolean)),JSON.stringify(publicEvents.flatMap(e=>[e.home_source_team_id,e.away_source_team_id]).filter(Boolean))).all(),
    repo.db.prepare('SELECT * FROM source_event_correspondences WHERE a IN(SELECT value FROM json_each(?)) OR b IN(SELECT value FROM json_each(?))').bind(JSON.stringify(publicEvents.map(e=>e.id)),JSON.stringify(publicEvents.map(e=>e.id))).all(),
    repo.db.prepare('SELECT * FROM event_source_links WHERE source_event_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(publicEvents.map(e=>e.id))).all(),
    repo.db.prepare('SELECT * FROM competition_source_links WHERE source_competition_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(competitionIds)).all(),
    repo.db.prepare('SELECT * FROM division_source_links WHERE source_division_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(divisionIds)).all(),
  ]);
  const comps=new Map(competitions.results.map(c=>[c.id,c])),divs=new Map(divisions.results.map(d=>[d.id,d])),complete=new Set(coverage.results.filter(c=>c.complete===1).map(c=>c.source_division_id)),oldBySource=new Map(previous.results.flatMap(p=>[[p.a,p],[p.b,p]]));
  const participants=new Map(participantLinks.results.map(l=>[`${l.a}|${l.b}`,l]));
  // Uniqueness is checked against all native events in a complete division, not
  // only the connected team's filtered list or the current UI page.
  const scopes=(await repo.db.prepare('SELECT provider,division_key,match_number,COUNT(*) AS record_count FROM source_events WHERE division_key IN(SELECT value FROM json_each(?)) AND match_number IN(SELECT value FROM json_each(?)) GROUP BY provider,division_key,match_number').bind(JSON.stringify([...new Set(publicEvents.map(e=>e.division_key).filter(Boolean))]),JSON.stringify([...new Set(publicEvents.map(e=>e.match_number).filter(Boolean))])).all()).results;
  const unique=(e)=>scopes.some(s=>s.provider===e.provider&&s.division_key===e.division_key&&s.match_number===e.match_number&&s.record_count===1);
  const matches=[],reviews=[],taken=new Set();
  for(const gs of publicEvents.filter(e=>e.provider==='gotsport')) {
    const existing=oldBySource.get(gs.id),gsComp=gs.competition_key?comps.get(gs.competition_key):null;
    const candidates=publicEvents.filter(lv=>lv.provider==='live'&&gs.match_number&&gs.match_number===lv.match_number&&gsComp&&sameContext(gsComp,comps.get(lv.competition_key)||{}));
    const contexts=gsComp?competitions.results.filter(c=>c.provider==='live'&&sameContext(gsComp,c)):[];
    const valid=candidates.filter(lv=>{
      const home=participants.get(`${gs.home_source_team_id}|${lv.home_source_team_id}`),away=participants.get(`${gs.away_source_team_id}|${lv.away_source_team_id}`),gsDivision=gs.division_key?gs.division_key:null,lvDivision=lv.division_key?lv.division_key:null;
      if(!home||!away||gs.type!=='game'||lv.type!=='game'||gs.conditional||lv.conditional||gs.home_source_team_id===gs.away_source_team_id||lv.home_source_team_id===lv.away_source_team_id)return false;
      const p1=parse(home.evidence),p2=parse(away.evidence),lvContext=parse(comps.get(lv.competition_key).evidence);
      if(p1.season!==p2.season||p1.season!==String(lvContext.season_id)||p1.season_name!==p2.season_name||p1.season_name!==lvContext.season_name)return false;
      const gp=parse(gs.evidence),lp=parse(lv.evidence),gd=divs.get(gsDivision),ld=divs.get(lvDivision),gdp=parse(gd?.evidence),ldp=parse(ld?.evidence);
      if(!gd||!ld||gd.competition_id!==gsComp.id||ld.competition_id!==lv.competition_key||String(gp.event_id)!==gsComp.native_id||String(gp.group_id)!==String(gdp.group)||!gp.schedule_id||!gp.home_registration||!gp.away_registration||!gdp.brackets?.some(b=>String(b.id)===String(gp.bracket_id))||String(lp.organizer)!==comps.get(lv.competition_key).native_id||String(lp.category)!==String(ldp.category)||!ldp.leagues?.includes(String(lp.league_id))||String(lp.home_club_id)!==String(p1.club)||String(lp.away_club_id)!==String(p2.club)||lp.home_real!==true||lp.away_real!==true)return false;
      if(existing?.b===lv.id) return true; // A verified native pair survives rescheduling.
      return gs.provenance==='provider'&&lv.provenance==='provider'&&gsComp.provenance==='provider'&&comps.get(lv.competition_key).provenance==='provider'&&gd.provenance==='provider'&&ld.provenance==='provider'&&contexts.length===1&&divs.has(gsDivision)&&divs.has(lvDivision)&&complete.has(gsDivision)&&complete.has(lvDivision)&&unique(gs)&&unique(lv)&&checkedParticipant(home,now)&&checkedParticipant(away,now)&&gs.starts_at&&lv.starts_at&&Math.abs(Date.parse(gs.starts_at)-Date.parse(lv.starts_at))<=60000&&!oldBySource.has(lv.id);
    });
    if(existing&&valid.every(lv=>lv.id!==existing.b)) {reviews.push({...existing,status:'review',proof:JSON.stringify({...parse(existing.proof),issue:'Current context or participants contradict the verified pair.'})});continue;}
    if(valid.length!==1||taken.has(valid[0].id))continue;
    const lv=valid[0];taken.add(lv.id);
    const gsDivision=gs.division_key,lvDivision=lv.division_key,home=participants.get(`${gs.home_source_team_id}|${lv.home_source_team_id}`),away=participants.get(`${gs.away_source_team_id}|${lv.away_source_team_id}`);
    const proof=existing?parse(existing.proof):{method:'strict_composite',source_refs:[gs.id,lv.id],competition_refs:[gsComp.id,lv.competition_key],division_refs:[gsDivision,lvDivision],match_number:gs.match_number,competition:{name:gsComp.name,starts_on:gsComp.starts_on,ends_on:gsComp.ends_on,website_domain:gsComp.website_domain,season_year:gsComp.season_year},ordered_participants:[parse(home.evidence),parse(away.evidence)],initial_kickoffs:[gs.starts_at,lv.starts_at],coverage:coverage.results.filter(c=>[gsDivision,lvDivision].includes(c.source_division_id)),checked_at:new Date(now).toISOString()};
    const ownerDecision=eventLinks.results.some(l=>[gs.id,lv.id].includes(l.source_event_id)&&['owner_confirmed','owner_unlinked'].includes(l.reason));
    if(!ownerDecision)matches.push({a:gs.id,b:lv.id,competition_refs:proof.competition_refs,division_refs:proof.division_refs,method:'strict_composite',proof:JSON.stringify(proof),verified_at:existing?.verified_at||new Date(now).toISOString(),status:'verified',changed:!existing||existing.status!=='verified'});
  }
  const canonicalCompetitions=new Map(competitionLinks.results.map(l=>[l.source_competition_id,l.competition_id])),canonicalDivisions=new Map(divisionLinks.results.map(l=>[l.source_division_id,l.division_id])),newCompetitions=[],newDivisions=[],metadataLinks=[],metadataAliases=[];
  for(const [kind,entities,map,created,linkRows]of [['competition',competitions.results,canonicalCompetitions,newCompetitions,competitionLinks.results],['division',divisions.results,canonicalDivisions,newDivisions,divisionLinks.results]]) {
    const refKey=kind==='competition'?'competition_refs':'division_refs';
    for(const match of matches) {
      const [a,b]=match[refKey],canonical=map.get(a)||map.get(b)||id();
      if(!map.has(a)&&!map.has(b))created.push(canonical);
      const previousIds=[map.get(a),map.get(b)].filter(Boolean);
      for(const old of previousIds)if(old!==canonical)metadataAliases.push({kind,merged_id:old,canonical_id:canonical});
      for(const [source,value]of map)if(previousIds.includes(value))map.set(source,canonical);
      map.set(a,canonical);map.set(b,canonical);
      metadataLinks.push({kind,source_id:a,id:canonical,reason:'strict_composite',evidence:match.proof},{kind,source_id:b,id:canonical,reason:'strict_composite',evidence:match.proof});
    }
    for(const entity of entities)if(!map.has(entity.id)){const canonical=id();map.set(entity.id,canonical);created.push(canonical);metadataLinks.push({kind,source_id:entity.id,id:canonical,reason:'source_identity',evidence:'{}'});}
  }
  return {matches,reviews,canonicalCompetitions,canonicalDivisions,newCompetitions,newDivisions,metadataLinks,metadataAliases};
}
