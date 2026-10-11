import {JobCoordinator} from '../sync/coordinator.js';
import {wakeSync} from '../sync/runtime.js';
import {SyncError} from '../sync/errors.js';

// Also included in DOMAIN_SCHEMA and SYNC_SCHEMA for their independent native
// tests. Fresh bootstrap uses the same declaration; this is not a migration.
export const TEAM_LIFECYCLE_SCHEMA=[`CREATE TABLE IF NOT EXISTS team_lifecycle(team_id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN('deleting','deleted')),requested_at TEXT NOT NULL,deleted_at TEXT)`];
export const activeTeamPredicate=alias=>`NOT EXISTS(SELECT 1 FROM team_lifecycle lifecycle WHERE lifecycle.team_id=${alias}.id)`;
const need=(value,message)=>{if(!value)throw new SyncError('invalid_job',message,{kind:'permanent'});return value;};
const stale=()=>Object.assign(new SyncError('stale_revision','This team changed. Reload it before removing it.',{kind:'permanent'}),{status:409});
const plan=[
  ['tracking_capture_parts','capture_id IN(SELECT id FROM tracking_captures WHERE app_team_id=?)',64],
  ['tracking_captures','app_team_id=?',20],
  ['tracking_capture_choices','plan_id IN(SELECT id FROM tracking_capture_plans WHERE app_team_id=?)',100],
  ['tracking_capture_plans','app_team_id=?',20],
  ['team_source_attachments','app_team_id=?',100],
  ['security_viewer_tokens','team_id=?',100],
  ['coach_stints','app_team_id=?',100],['coach_lineup','app_team_id=?',100],['coach_timeline','app_team_id=?',100],
  ['coach_session_players','app_team_id=?',100],['coach_sessions','app_team_id=?',100],
  ['coach_profile_positions','app_team_id=?',100],['coach_profiles','app_team_id=?',100],
  ['analysis_lineup_assignments','app_team_id=?',100],['analysis_lineup_headers','app_team_id=?',100],
  ['player_match_analysis','app_team_id=?',100],['match_analysis','app_team_id=?',100],
  ['analysis_track_assignments','app_team_id=?',100],['analysis_overrides','app_team_id=?',100],
  ['report_export_parts','export_id IN(SELECT e.id FROM report_exports e JOIN report_snapshots s ON s.id=e.snapshot_id WHERE s.app_team_id=?)',64],
  ['report_pdf_objects','export_id IN(SELECT e.id FROM report_exports e JOIN report_snapshots s ON s.id=e.snapshot_id WHERE s.app_team_id=?)',64],
  ['report_rows','snapshot_id IN(SELECT id FROM report_snapshots WHERE app_team_id=?)',100],
  ['report_exports','snapshot_id IN(SELECT id FROM report_snapshots WHERE app_team_id=?)',100],['report_snapshots','app_team_id=?',100],
  ['data_file_parts','export_id IN(SELECT id FROM data_file_exports WHERE app_team_id=?)',64],
  ['data_file_entries','export_id IN(SELECT id FROM data_file_exports WHERE app_team_id=?)',100],['data_file_exports','app_team_id=?',100],
  ['data_file_import_segments','import_id IN(SELECT id FROM data_file_imports WHERE app_team_id=?)',16],['data_file_imports','app_team_id=?',100],
  ['owner_awards','app_team_id=?',100],['game_bookmarks','app_team_id=?',100],['domain_overrides','app_team_id=?',100],
  ['team_event_rows','app_team_id=?',100],['team_player_rows','app_team_id=?',100],
  ['team_projection_state','app_team_id=?',100],['team_projection_runs','app_team_id=?',100],
  ['season_inclusion_rules','team_season_id IN(SELECT id FROM team_seasons WHERE app_team_id=?)',100],
  ['season_controls','team_season_id IN(SELECT id FROM team_seasons WHERE app_team_id=?)',100],
  ['team_profiles','app_team_id=?',100],['team_read_state','app_team_id=?',100],['team_seasons','app_team_id=?',100],
];

/** Trusted owner command. The API must authorize and check same origin first. */
export class TeamLifecycleService {
  constructor(db,env,{wake,coordinatorOptions}={}){this.db=db;this.env=env;this.wakeAction=wake||wakeSync;this.jobs=new JobCoordinator(db,coordinatorOptions);}
  async beginDelete(teamId,{revision}={}) {
    const existing=await this.db.prepare('SELECT * FROM team_lifecycle WHERE team_id=?').bind(teamId).first();
    if(existing?.state==='deleted')return {teamId,state:'deleted'};
    if(revision!==undefined&&!existing)need(Number.isSafeInteger(revision)&&revision>=0,'Reload this team before removing it.');
    need(await this.db.prepare('SELECT id FROM app_teams WHERE id=?').bind(teamId).first(),'This team is unavailable.');
    // Provision work first. Maintenance cannot claim until the deleting marker
    // commits, so either crash window remains recoverable without a browser.
    const jobId=await this.jobs.enqueue({provider:'maintenance',component:'team_delete',stage:'maintenance',scope:teamId,resourceKey:teamId,args:{teamId},priority:95,recurring:false},[{kind:'team',key:`delete:${teamId}`,teamId}]);
    const useRevision=revision!==undefined&&!existing,revisionGuard=useRevision?'COALESCE((SELECT revision FROM team_profiles WHERE app_team_id=app_teams.id),0)=?':'1';
    const saved=await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO team_lifecycle(team_id,state,requested_at) SELECT id,'deleting',? FROM app_teams WHERE id=? AND ${revisionGuard}`).bind(new Date().toISOString(),teamId,...(useRevision?[revision]:[])),
      this.db.prepare("UPDATE team_read_state SET status_revision=status_revision+1 WHERE app_team_id=? AND EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=? AND state='deleting')").bind(teamId,teamId),
    ]);
    if(!saved[0].meta.changes&&!existing){const marker=await this.status(teamId);if(!marker)throw stale();}
    await this.wakeAction(this.env);return {teamId,state:'deleting',jobId};
  }
  async status(teamId){return this.db.prepare('SELECT team_id,state,requested_at,deleted_at FROM team_lifecycle WHERE team_id=?').bind(teamId).first();}
}

/** One bounded FK-safe page; shared accounts, native facts and identities stay. */
export async function collectTeamDeletion({db,lease,args,checkpoint}) {
  need(lease.stage==='maintenance'&&lease.component==='team_delete'&&lease.scope===args.teamId&&lease.resource_key===args.teamId,'Invalid team deletion demand.');
  const life=await db.prepare("SELECT state FROM team_lifecycle WHERE team_id=? AND state='deleting'").bind(args.teamId).first();need(life,'Team deletion is not active.');
  const response=(extra={})=>({statements:[],checkpoint,complete:false,coverage:'partial',publishContent:false,...extra});
  if(!checkpoint.tables) {
    const present=new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(row=>row.name));
    return response({checkpoint:{tables:plan.filter(([table])=>present.has(table)).map(([table])=>table),index:0,phase:'subscriptions'}});
  }
  need(Array.isArray(checkpoint.tables)&&checkpoint.tables.every(table=>plan.some(([allowed])=>allowed===table)),'Invalid cleanup checkpoint.');
  if(checkpoint.phase==='subscriptions') {
    const rows=(await db.prepare('SELECT 1 FROM sync_job_subscribers WHERE app_team_id=? AND job_id<>? LIMIT 101').bind(args.teamId,lease.id).all()).results;
    return response({removeTeamDemand:true,checkpoint:{...checkpoint,phase:rows.length<=100?'tables':'subscriptions'}});
  }
  if(checkpoint.phase==='tables'&&checkpoint.index<checkpoint.tables.length) {
    const table=checkpoint.tables[checkpoint.index],[,predicate,limit]=plan.find(([name])=>name===table);
    const rows=(await db.prepare(`SELECT rowid FROM ${table} WHERE ${predicate} LIMIT ?`).bind(args.teamId,limit+1).all()).results;
    return response({statements:rows.length?[{sql:`DELETE FROM ${table} WHERE rowid IN(SELECT rowid FROM ${table} WHERE ${predicate} LIMIT ${limit}) AND $FENCE`,params:[args.teamId]}]:[],rowsSaved:0,checkpoint:{...checkpoint,index:checkpoint.index+(rows.length<=limit?1:0)}});
  }
  need(checkpoint.phase==='tables'&&checkpoint.index===checkpoint.tables.length,'Unknown team deletion phase.');
  return response({statements:[
    {sql:"UPDATE team_lifecycle SET state='deleted',deleted_at=? WHERE team_id=? AND state='deleting' AND $FENCE",params:[new Date().toISOString(),args.teamId]},
    {sql:'DELETE FROM app_teams WHERE id=? AND $FENCE',params:[args.teamId]},
  ],checkpoint:{finished:true},complete:true,coverage:'complete'});
}
