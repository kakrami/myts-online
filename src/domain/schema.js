import { AUXILIARY_SCHEMA } from './auxiliary-schema.js';
import {serializationSchema} from './serialization.js';
import {CONNECTION_SCHEMA} from './connection-schema.js';
export const DOMAIN_SCHEMA_VERSION = 1;

export const DOMAIN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS team_lifecycle(team_id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN('deleting','deleted')),requested_at TEXT NOT NULL,deleted_at TEXT)`,
  `CREATE TABLE domain_installation(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,source_revision INTEGER NOT NULL DEFAULT 0,mutation_revision INTEGER NOT NULL DEFAULT 0,public_revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)`,
  `CREATE TABLE domain_fences(id TEXT PRIMARY KEY CHECK(id IN ('source','domain')),token TEXT NOT NULL)`,
  `CREATE TABLE domain_import_preconditions(id INTEGER PRIMARY KEY CHECK(id=1),expected_value INTEGER NOT NULL,actual_value INTEGER NOT NULL CHECK(expected_value=actual_value))`,
  `CREATE TABLE domain_source_preconditions(id INTEGER PRIMARY KEY CHECK(id=1),expected_revision INTEGER NOT NULL,actual_revision INTEGER NOT NULL CHECK(expected_revision=actual_revision))`,
  `CREATE TABLE domain_projection_preconditions(id INTEGER PRIMARY KEY CHECK(id=1),expected_mutation INTEGER NOT NULL,actual_mutation INTEGER NOT NULL CHECK(expected_mutation=actual_mutation),expected_status INTEGER NOT NULL,actual_status INTEGER NOT NULL CHECK(expected_status=actual_status))`,
  `CREATE TABLE provider_accounts(id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN ('teamsnap','trace')),native_id TEXT NOT NULL,name TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),UNIQUE(provider,native_id))`,
  `CREATE TABLE app_teams(id TEXT PRIMARY KEY,name TEXT NOT NULL,timezone TEXT NOT NULL,season_year INTEGER NOT NULL,request_id TEXT UNIQUE,created_at TEXT NOT NULL)`,
  `CREATE TABLE team_seasons(id TEXT PRIMARY KEY,app_team_id TEXT NOT NULL REFERENCES app_teams(id) ON DELETE CASCADE,year INTEGER NOT NULL,start_day TEXT NOT NULL,end_day TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,include_june INTEGER NOT NULL DEFAULT 1 CHECK(include_june IN(0,1)),UNIQUE(app_team_id,year))`,
  `CREATE TABLE team_read_state(app_team_id TEXT PRIMARY KEY REFERENCES app_teams(id) ON DELETE CASCADE,content_revision INTEGER NOT NULL DEFAULT 0,status_revision INTEGER NOT NULL DEFAULT 0,pending INTEGER NOT NULL DEFAULT 0 CHECK(pending IN(0,1)))`,
  `CREATE TABLE team_projection_state(team_season_id TEXT PRIMARY KEY REFERENCES team_seasons(id),app_team_id TEXT NOT NULL REFERENCES app_teams(id),projection_hash TEXT NOT NULL DEFAULT '',source_revision INTEGER NOT NULL DEFAULT 0,input_revision INTEGER NOT NULL DEFAULT 0,published_input_revision INTEGER NOT NULL DEFAULT -1,published_run_id TEXT,pending INTEGER NOT NULL DEFAULT 1 CHECK(pending IN(0,1)))`,
  `CREATE TABLE source_teams(id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN('gotsport','live','teamsnap','trace')),scope TEXT NOT NULL,account_id TEXT REFERENCES provider_accounts(id),native_id TEXT NOT NULL,name TEXT NOT NULL,name_authority INTEGER NOT NULL CHECK(name_authority BETWEEN 0 AND 3),club_key TEXT,season_label TEXT,archived INTEGER NOT NULL CHECK(archived IN(0,1)),evidence TEXT NOT NULL CHECK(length(CAST(evidence AS BLOB))<=64000),provenance TEXT NOT NULL DEFAULT 'provider' CHECK(provenance IN('provider','file_import')),content_hash TEXT NOT NULL,observed_at TEXT NOT NULL,UNIQUE(provider,scope,native_id),CHECK((provider IN('gotsport','live') AND scope='public' AND account_id IS NULL) OR (provider IN('teamsnap','trace') AND scope=account_id AND account_id IS NOT NULL)))`,
  `CREATE TABLE source_team_state(source_team_id TEXT PRIMARY KEY REFERENCES source_teams(id) ON DELETE CASCADE,content_revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX source_teams_name ON source_teams(provider,name COLLATE NOCASE,id)`,
  `CREATE TABLE account_source_teams(account_id TEXT NOT NULL REFERENCES provider_accounts(id),source_team_id TEXT NOT NULL REFERENCES source_teams(id),PRIMARY KEY(account_id,source_team_id))`,
  `CREATE TABLE source_team_links(a TEXT NOT NULL REFERENCES source_teams(id),b TEXT NOT NULL REFERENCES source_teams(id),kind TEXT NOT NULL CHECK(kind='provider_external_key'),evidence TEXT NOT NULL CHECK(length(CAST(evidence AS BLOB))<=16000),PRIMARY KEY(a,b),CHECK(a<>b))`,
  `CREATE INDEX source_team_links_b ON source_team_links(b,a)`,
  `CREATE TABLE team_source_attachments(id TEXT PRIMARY KEY,app_team_id TEXT NOT NULL REFERENCES app_teams(id),team_season_id TEXT NOT NULL REFERENCES team_seasons(id),source_team_id TEXT NOT NULL REFERENCES source_teams(id),account_id TEXT REFERENCES provider_accounts(id),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),generation INTEGER NOT NULL DEFAULT 1,UNIQUE(app_team_id,team_season_id,source_team_id))`,
  `CREATE INDEX attachment_source ON team_source_attachments(source_team_id,active,app_team_id)`,
  `CREATE TABLE source_players(id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN('teamsnap','trace')),scope TEXT NOT NULL,account_id TEXT NOT NULL REFERENCES provider_accounts(id),native_id TEXT NOT NULL,name TEXT NOT NULL,jersey TEXT,evidence TEXT NOT NULL CHECK(length(CAST(evidence AS BLOB))<=64000),provenance TEXT NOT NULL DEFAULT 'provider' CHECK(provenance IN('provider','file_import')),content_hash TEXT NOT NULL,observed_at TEXT NOT NULL,UNIQUE(provider,scope,native_id),CHECK(scope=account_id))`,
  `CREATE TABLE source_roster_memberships(source_team_id TEXT NOT NULL REFERENCES source_teams(id),source_player_id TEXT NOT NULL REFERENCES source_players(id),active INTEGER NOT NULL CHECK(active IN(0,1)),scan_id TEXT NOT NULL,provenance TEXT NOT NULL DEFAULT 'provider' CHECK(provenance IN('provider','file_import')),PRIMARY KEY(source_team_id,source_player_id))`,
  `CREATE INDEX source_roster_player ON source_roster_memberships(source_player_id,source_team_id)`,
  `CREATE TABLE source_events(id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN('gotsport','live','teamsnap','trace')),scope TEXT NOT NULL,account_id TEXT REFERENCES provider_accounts(id),native_id TEXT NOT NULL,competition_key TEXT,division_key TEXT,match_number TEXT,starts_at TEXT,local_day TEXT,time_precision TEXT NOT NULL CHECK(time_precision IN('instant','day','pending')),type TEXT NOT NULL CHECK(type IN('game','practice','event')),status TEXT NOT NULL,conditional INTEGER NOT NULL CHECK(conditional IN(0,1)),home_source_team_id TEXT REFERENCES source_teams(id),away_source_team_id TEXT REFERENCES source_teams(id),home_label TEXT NOT NULL,away_label TEXT NOT NULL,home_score REAL CHECK(home_score IS NULL OR home_score>=0),away_score REAL CHECK(away_score IS NULL OR away_score>=0),title TEXT NOT NULL,venue TEXT NOT NULL,evidence TEXT NOT NULL CHECK(length(CAST(evidence AS BLOB))<=64000),provenance TEXT NOT NULL DEFAULT 'provider' CHECK(provenance IN('provider','file_import')),content_hash TEXT NOT NULL,observed_at TEXT NOT NULL,UNIQUE(provider,scope,native_id),CHECK((provider IN('gotsport','live') AND scope='public' AND account_id IS NULL) OR (provider IN('teamsnap','trace') AND scope=account_id AND account_id IS NOT NULL)))`,
  `CREATE TABLE source_event_teams(source_team_id TEXT NOT NULL REFERENCES source_teams(id),source_event_id TEXT NOT NULL REFERENCES source_events(id),side TEXT NOT NULL CHECK(side IN('home','away')),PRIMARY KEY(source_team_id,source_event_id))`,
  `CREATE INDEX source_event_team_event ON source_event_teams(source_event_id,source_team_id)`,
  `CREATE INDEX source_events_time ON source_events(starts_at,local_day,id)`,
  `CREATE TABLE players(id TEXT PRIMARY KEY,created_at TEXT NOT NULL)`,
  `CREATE TABLE player_source_links(source_player_id TEXT PRIMARY KEY REFERENCES source_players(id),player_id TEXT NOT NULL REFERENCES players(id),reason TEXT NOT NULL,evidence TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1)`,
  `CREATE INDEX player_links_canonical ON player_source_links(player_id,source_player_id)`,
  `CREATE TABLE events(id TEXT PRIMARY KEY,created_at TEXT NOT NULL)`,
  `CREATE TABLE event_source_links(source_event_id TEXT PRIMARY KEY REFERENCES source_events(id),event_id TEXT NOT NULL REFERENCES events(id),reason TEXT NOT NULL,evidence TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1)`,
  `CREATE INDEX event_links_canonical ON event_source_links(event_id,source_event_id)`,
  `CREATE TABLE team_player_rows(run_id TEXT NOT NULL REFERENCES team_projection_runs(id),app_team_id TEXT NOT NULL REFERENCES app_teams(id),team_season_id TEXT NOT NULL REFERENCES team_seasons(id),player_id TEXT NOT NULL REFERENCES players(id),name TEXT NOT NULL,jersey TEXT,source_ids TEXT NOT NULL,PRIMARY KEY(run_id,app_team_id,team_season_id,player_id))`,
  `CREATE TABLE team_event_rows(run_id TEXT NOT NULL REFERENCES team_projection_runs(id),app_team_id TEXT NOT NULL REFERENCES app_teams(id),team_season_id TEXT NOT NULL REFERENCES team_seasons(id),event_id TEXT NOT NULL REFERENCES events(id),competition_id TEXT,division_id TEXT,starts_at TEXT,local_day TEXT,type TEXT NOT NULL,status TEXT NOT NULL,conditional INTEGER NOT NULL,own_side TEXT NOT NULL CHECK(own_side IN('home','away')),home_name TEXT NOT NULL,away_name TEXT NOT NULL,home_score REAL,away_score REAL,goals_for REAL,goals_against REAL,title TEXT NOT NULL,venue TEXT NOT NULL,source_ids TEXT NOT NULL,schedule_source_id TEXT NOT NULL REFERENCES source_events(id),result_source_id TEXT NOT NULL REFERENCES source_events(id),result_conflict INTEGER NOT NULL DEFAULT 0 CHECK(result_conflict IN(0,1)),identity_conflict INTEGER NOT NULL DEFAULT 0 CHECK(identity_conflict IN(0,1)),conflict TEXT,PRIMARY KEY(run_id,app_team_id,team_season_id,event_id))`,
  `CREATE INDEX team_events_selection ON team_event_rows(run_id,app_team_id,team_season_id,starts_at,local_day,event_id)`,
  `CREATE TABLE domain_overrides(app_team_id TEXT NOT NULL REFERENCES app_teams(id),kind TEXT NOT NULL CHECK(kind IN('player','event')),entity_id TEXT NOT NULL,fields TEXT NOT NULL CHECK(length(CAST(fields AS BLOB))<=16000),revision INTEGER NOT NULL,PRIMARY KEY(app_team_id,kind,entity_id))`,
  `CREATE TABLE team_projection_runs(id TEXT PRIMARY KEY,app_team_id TEXT NOT NULL REFERENCES app_teams(id),team_season_id TEXT NOT NULL REFERENCES team_seasons(id),input_revision INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('building','published','obsolete')),created_at TEXT NOT NULL)`,
  `CREATE INDEX projection_runs_selection ON team_projection_runs(app_team_id,team_season_id,state,id)`,
  `CREATE TABLE domain_team_preconditions(id INTEGER PRIMARY KEY CHECK(id=1),expected_input INTEGER NOT NULL,actual_input INTEGER NOT NULL CHECK(expected_input=actual_input))`,
  `CREATE TABLE source_event_state(source_event_id TEXT PRIMARY KEY,input_revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE VIEW team_players AS SELECT r.app_team_id,r.team_season_id,r.player_id,r.name,r.jersey,r.source_ids FROM team_player_rows r JOIN team_projection_state s ON s.team_season_id=r.team_season_id AND s.app_team_id=r.app_team_id AND s.published_run_id=r.run_id`,
  `CREATE VIEW team_events AS SELECT r.app_team_id,r.team_season_id,r.event_id,r.competition_id,r.division_id,r.starts_at,r.local_day,r.type,r.status,r.conditional,r.own_side,r.home_name,r.away_name,r.home_score,r.away_score,r.goals_for,r.goals_against,r.title,r.venue,r.source_ids,r.schedule_source_id,r.result_source_id,r.result_conflict,r.identity_conflict,r.conflict FROM team_event_rows r JOIN team_projection_state s ON s.team_season_id=r.team_season_id AND s.app_team_id=r.app_team_id AND s.published_run_id=r.run_id`,
  ...AUXILIARY_SCHEMA,
];

DOMAIN_SCHEMA.push(...CONNECTION_SCHEMA);
DOMAIN_SCHEMA.push(...serializationSchema(DOMAIN_SCHEMA));

export async function initializeDomain(db) {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results;
  if (tables.some((r) => r.name === "domain_installation")) {
    const row = await db.prepare("SELECT schema_version FROM domain_installation WHERE id=1").first();
    if (row?.schema_version === DOMAIN_SCHEMA_VERSION) return { installed: true };
    throw Object.assign(new Error("An empty database is required for this build."), { code: "fresh_database_required", status: 409 });
  }
  if (tables.some((r) => r.name !== "d1_migrations"))
    throw Object.assign(new Error("An empty database is required for this build."), { code: "fresh_database_required", status: 409 });
  await db.batch([
    ...DOMAIN_SCHEMA.map((sql) => db.prepare(sql)),
    db.prepare("INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,?,?)").bind(DOMAIN_SCHEMA_VERSION,new Date().toISOString()),
  ]);
  return { installed: true };
}
