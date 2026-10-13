import {FeatureReads} from '../read-model/feature-reads.js';
import {invalid} from '../read-model/selection.js';
import {publicHistoryProof,publicHistoryQuery,publicHistoryAdmission} from '../sync/public-history.js';
import {digest} from '../security/crypto.js';
import {gameScopeFenceSQL,assertPublishedGameCurrent} from '../domain/team-game-scope.js';
import {findPublicHistoryAnchor} from '../read-model/public-history-anchor.js';

const DAY=86400000,COOLDOWN=60000,MAX_PAIRS=8,MAX_JOBS=512;
const SESSION=`EXISTS(SELECT 1 FROM security_sessions s JOIN security_owner o ON o.id=1 WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.password_revision=o.password_revision)`;
const fields=['id','app_team_id','team_season_id','event_id','source_event_id','home_source_team_id','away_source_team_id','pair_a','pair_b','anchor_attachment_id','anchor_generation','anchor_kind','anchor_membership_id','requester_kind','requester_key','generation','state','requested_at','expires_at','cooldown_until','max_jobs','capped'];
const proposed=row=>({sql:`WITH d AS(SELECT ${fields.map(key=>'? AS '+key).join(',')})`,params:fields.map(key=>row[key])});
const unsupported=()=>({supported:false,state:'unsupported',history_complete:false,next_check_ms:null,can_refresh:false,note:'Public history refresh needs an unambiguous provider-verified GotSport game. Saved meetings remain available.'});

/** A short-lived public scan, never a logical team connection or account grant. */
export class PublicHistoryService {
  constructor(db,{principal,requesterKey,sync,now=Date.now}) {
    this.db=db;this.principal=principal;this.requesterKey=requesterKey;this.sync=sync;this.now=now;
    this.reads=new FeatureReads(db,principal.role==='owner'?{owner:true}:{owner:false,teamId:principal.team_id,categories:principal.categories},{now});
  }
  async anchor(input,eventId) {
    this.reads.category('matches');const context=await this.reads.featureContext(input),current=await this.reads.matchTarget(context,eventId);
    if(current.type!=='game'||current.conditional||current.identity_conflict)return null;
    const now=this.now(),requester=this.principal.role==='owner'?'owner':'viewer',key=requester==='owner'?'owner':this.requesterKey;
    const row=await findPublicHistoryAnchor(this.db,context,current,{now,requester,key,provider:'gotsport'});
    if(!row)return null;
    if(current._game_scope)await assertPublishedGameCurrent(this.db,current._game_scope);
    row.id=await digest(JSON.stringify(['public-history',row.app_team_id,row.team_season_id,requester,key,row.pair_a,row.pair_b]));
    return {row,context,gameScope:current._game_scope};
  }
  async saved(id) {
    return this.db.prepare(publicHistoryQuery(`SELECT d.*,${publicHistoryAdmission('d')} AS proof_live,(SELECT count(*) FROM public_history_jobs j WHERE j.demand_id=d.id AND j.generation=d.generation) AS jobs_total,(SELECT count(*) FROM public_history_jobs j WHERE j.demand_id=d.id AND j.generation=d.generation AND j.state='complete') AS jobs_complete,(SELECT count(*) FROM public_history_jobs j WHERE j.demand_id=d.id AND j.generation=d.generation AND j.state IN('failed','superseded')) AS jobs_failed FROM public_history_demands d WHERE d.id=?`,String(this.now()),{live:true})).bind(id).first();
  }
  model(row) {
    if(!row)return {supported:true,state:'idle',history_complete:false,next_check_ms:null,can_refresh:true,note:'Refresh checks the public histories of these two exact teams.'};
    const now=this.now(),state=row.state==='active'?(row.expires_at<=now?'expired':!row.proof_live?'revoked':'active'):row.state;
    return {supported:true,state,history_complete:false,requested_at:row.requested_at,expires_at:row.expires_at,cooldown_until:row.cooldown_until,can_refresh:state!=='revoked'&&row.cooldown_until<=now,next_check_ms:state==='active'?1500:null,progress:{complete:row.jobs_complete??0,total:row.jobs_total??0,failed:row.jobs_failed??0,capped:!!row.capped},note:state==='complete'?'The requested public scans finished. Providers may not publish every historical meeting.':state==='active'?'Checking public team history. Saved meetings remain available.':['partial','failed','expired'].includes(state)?'The public history check is incomplete. Saved meetings remain available; you can retry.':state==='revoked'?'This history request no longer has access to its original match. Saved meetings remain available.':'Refresh checks the public histories of these two exact teams.'};
  }
  async status(input,eventId) {const anchor=await this.anchor(input,eventId);return anchor?this.model(await this.saved(anchor.row.id)):unsupported();}
  async request(input,eventId,{force=false}={}) {
    if(typeof force!=='boolean')throw invalid('Choose a valid history refresh.');
    const anchor=await this.anchor(input,eventId);if(!anchor)return unsupported();
    const row=anchor.row,old=await this.saved(row.id),now=this.now();
    // Reopening during the finite receipt reuses its scan. A later visit after
    // expiry may request one fresh scan; expiry never renews work by itself.
    if(old&&(old.cooldown_until>now||!force&&old.expires_at>now))return this.model(old);
    const limits=await this.db.prepare(`SELECT (SELECT count(*) FROM(SELECT DISTINCT pair_a,pair_b FROM public_history_demands WHERE app_team_id=? AND state='active' AND expires_at>? AND NOT(pair_a=? AND pair_b=?))) AS active_pairs,(SELECT max(cooldown_until) FROM public_history_demands WHERE app_team_id=? AND pair_a=? AND pair_b=?) AS pair_cooldown`).bind(row.app_team_id,now,row.pair_a,row.pair_b,row.app_team_id,row.pair_a,row.pair_b).first();
    if(limits.active_pairs>=MAX_PAIRS)throw invalid('Several history checks are still running. Try again after one finishes.','history_capacity',429);
    if(limits.pair_cooldown>now)return {...this.model(old),can_refresh:false,cooldown_until:limits.pair_cooldown,note:'This pair was just requested. Wait a moment before requesting another scan.'};
    row.generation=(old?.generation??0)+1;row.requested_at=now;row.expires_at=now+DAY;row.cooldown_until=now+COOLDOWN;
    const scopeFence=anchor.gameScope?gameScopeFenceSQL(anchor.gameScope,{forWrite:false}):{sql:'1',params:[]};
    const draft=proposed(row),session=this.principal.role==='owner'?{sql:SESSION,params:[this.principal.session_id,now]}:{sql:'1',params:[]};
    const guard=`${publicHistoryAdmission('d','public_history_candidate')} AND ${session.sql} AND (${scopeFence.sql}) AND NOT EXISTS(SELECT 1 FROM public_history_demands existing WHERE existing.id=d.id AND (existing.generation<>? OR existing.cooldown_until>?)) AND NOT EXISTS(SELECT 1 FROM public_history_demands recent WHERE recent.app_team_id=d.app_team_id AND recent.pair_a=d.pair_a AND recent.pair_b=d.pair_b AND recent.cooldown_until>?) AND (SELECT count(*) FROM(SELECT DISTINCT pair_a,pair_b FROM public_history_demands active WHERE active.app_team_id=d.app_team_id AND active.state='active' AND active.expires_at>${now} AND NOT(active.pair_a=d.pair_a AND active.pair_b=d.pair_b)))<${MAX_PAIRS}`;
    const insert=this.db.prepare(publicHistoryQuery(draft.sql+` INSERT INTO public_history_demands(${fields.join(',')}) SELECT ${fields.map(key=>'d.'+key).join(',')} FROM d WHERE ${guard} ON CONFLICT(id) DO UPDATE SET ${fields.filter(key=>key!=='id').map(key=>key+'=excluded.'+key).join(',')}`,String(now),{candidateSource:'d'})).bind(...draft.params,...session.params,...scopeFence.params,old?.generation??0,now,now);
    const cleanup=this.db.prepare(`DELETE FROM public_history_jobs WHERE demand_id=? AND generation<>? AND EXISTS(SELECT 1 FROM public_history_demands d WHERE d.id=? AND d.generation=? AND d.requested_at=?)`).bind(row.id,row.generation,row.id,row.generation,now);
    const specs=['home','away'].flatMap(side=>{
      const native=row[side+'_native_id'];let evidence={};try{evidence=JSON.parse(row[side+'_evidence']||'{}');}catch{}
      const args={team_id:native,timezone:anchor.context.selection.timezone,...(evidence.club_name?{club_name:evidence.club_name}:{}),...(evidence.logo?{logo:evidence.logo}:{})};
      return ['history','catalog'].map(component=>({provider:'gotsport',component,stage:'source',scope:native,resourceKey:native,args,priority:30,recurring:false,intervalMs:43200000}));
    });
    await this.sync.jobs.enqueuePublicHistory(specs,{kind:'team',key:'public-history:'+row.id,teamId:row.app_team_id,generation:row.generation},{statements:[insert,cleanup],requestedAt:now});
    const saved=await this.saved(row.id);if(!saved||saved.generation!==row.generation)throw invalid('This match or history request changed. Reload before retrying.','history_changed',409);
    await this.sync.wake();return this.model(saved);
  }
}
