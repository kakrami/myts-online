/** A connection is owner intent; seasonal attachments are its materialized views.
 * Authorization, reconciliation backlog, and incomplete evidence are independent.
 * No connection row invents a season from its creation date. */
export const CONNECTION_SCHEMA = [
  `CREATE TABLE team_source_connections(id TEXT PRIMARY KEY,app_team_id TEXT NOT NULL REFERENCES app_teams(id) ON DELETE CASCADE,source_team_id TEXT NOT NULL REFERENCES source_teams(id),account_id TEXT REFERENCES provider_accounts(id),scope_mode TEXT NOT NULL CHECK(scope_mode IN('observed_history','fixed_seasons')),scope_origin TEXT NOT NULL DEFAULT 'owner' CHECK(scope_origin IN('owner','legacy_ambiguous','verified_continuity')),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>0),input_revision INTEGER NOT NULL DEFAULT 1 CHECK(input_revision>0),reconciled_revision INTEGER NOT NULL DEFAULT 0 CHECK(reconciled_revision>=0),created_at TEXT NOT NULL,last_reconciled_at TEXT,UNIQUE(app_team_id,source_team_id))`,
  `CREATE INDEX connection_source ON team_source_connections(source_team_id,active,app_team_id)`,
  `CREATE INDEX connection_dirty ON team_source_connections(active,reconciled_revision,input_revision,id)`,
  // Receipts deliberately survive removal of the team or root. They describe a
  // past accepted command, never permission to restore a removed connection.
  `CREATE TABLE connection_command_receipts(request_id TEXT PRIMARY KEY CHECK(length(request_id) BETWEEN 1 AND 128),payload_version INTEGER NOT NULL DEFAULT 2 CHECK(payload_version IN(1,2)),payload_hash TEXT CHECK(payload_hash IS NULL OR length(payload_hash)=64),team_id TEXT NOT NULL,connection_id TEXT NOT NULL,connection_generation INTEGER NOT NULL CHECK(connection_generation>0),outcome TEXT NOT NULL CHECK(outcome IN('created','connected','already_connected')),created_at TEXT NOT NULL,CHECK((payload_version=1 AND payload_hash IS NULL) OR(payload_version=2 AND payload_hash IS NOT NULL)))`,
  `CREATE INDEX connection_receipts_root ON connection_command_receipts(connection_id,request_id)`,
  // For fixed roots these rows are the explicit allowed set, including disabled
  // restrictions. For observed-history roots they record derived membership.
  `CREATE TABLE team_connection_seasons(connection_id TEXT NOT NULL REFERENCES team_source_connections(id) ON DELETE CASCADE,team_season_id TEXT NOT NULL REFERENCES team_seasons(id),attachment_id TEXT UNIQUE REFERENCES team_source_attachments(id) ON DELETE SET NULL,basis TEXT NOT NULL CHECK(basis IN('fixed','events','dated_metadata','imported_snapshot')),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN(0,1)),generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>0),PRIMARY KEY(connection_id,team_season_id))`,
  `CREATE INDEX connection_season_attachment ON team_connection_seasons(attachment_id,connection_id)`,
  `CREATE TABLE connection_event_resolutions(connection_id TEXT NOT NULL REFERENCES team_source_connections(id) ON DELETE CASCADE,source_event_id TEXT NOT NULL REFERENCES source_events(id),team_season_id TEXT REFERENCES team_seasons(id),state TEXT NOT NULL CHECK(state IN('pending','resolved','conflict','excluded')),effective_day TEXT,basis TEXT NOT NULL,source_hash TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>0),PRIMARY KEY(connection_id,source_event_id),CHECK(state<>'resolved' OR team_season_id IS NOT NULL))`,
  `CREATE INDEX connection_event_season ON connection_event_resolutions(connection_id,team_season_id,state,source_event_id)`,
  // A canonical game has only one accepted calendar membership per logical team.
  // On contradiction the accepted date and season remain together; evidence can
  // become conflicted without hiding the already accepted corrected game.
  `CREATE TABLE team_event_season_resolutions(app_team_id TEXT NOT NULL REFERENCES app_teams(id) ON DELETE CASCADE,event_id TEXT NOT NULL REFERENCES events(id),team_season_id TEXT REFERENCES team_seasons(id),state TEXT NOT NULL CHECK(state IN('pending','resolved','conflict')),effective_day TEXT,starts_at TEXT,local_day TEXT,basis TEXT NOT NULL,evidence TEXT NOT NULL CHECK(json_valid(evidence) AND length(CAST(evidence AS BLOB))<=16000),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),PRIMARY KEY(app_team_id,event_id),CHECK(team_season_id IS NULL OR effective_day IS NOT NULL OR basis IN('dated_metadata','accepted_projection','accepted_conflict')))`,
  `CREATE INDEX team_event_resolved_season ON team_event_season_resolutions(app_team_id,team_season_id,event_id)`,
  // Period-qualified observations are snapshots. Later current-roster edits
  // must not rewrite historical jerseys/roles via a join to source_players.
  `CREATE TABLE connection_roster_evidence(connection_id TEXT NOT NULL REFERENCES team_source_connections(id) ON DELETE CASCADE,team_season_id TEXT NOT NULL REFERENCES team_seasons(id),source_player_id TEXT NOT NULL REFERENCES source_players(id),basis_key TEXT NOT NULL,basis TEXT NOT NULL CHECK(basis IN('game','attendance','dated_roster','accepted_projection','imported_snapshot')),source_event_id TEXT REFERENCES source_events(id),valid_from TEXT,valid_until TEXT,certainty TEXT NOT NULL DEFAULT 'verified' CHECK(certainty IN('verified','preserved_uncertain')),name TEXT NOT NULL,jersey TEXT,position TEXT,observed_at TEXT NOT NULL,source_hash TEXT NOT NULL,PRIMARY KEY(connection_id,team_season_id,source_player_id,basis_key),CHECK(basis NOT IN('game','attendance') OR source_event_id IS NOT NULL),CHECK(basis<>'dated_roster' OR(valid_from IS NOT NULL AND valid_until IS NOT NULL AND valid_from<=valid_until)))`,
  `CREATE INDEX connection_roster_season ON connection_roster_evidence(connection_id,team_season_id,source_player_id)`,
];

// Scope checks run in the same transaction as every relation write. Independent
// foreign keys alone would allow a connection to borrow another team's season.
const sourceScope=(root,event)=>`EXISTS(SELECT 1 FROM source_event_teams st WHERE st.source_event_id=${event} AND (st.source_team_id=${root}.source_team_id OR EXISTS(SELECT 1 FROM source_team_links link WHERE (link.a=${root}.source_team_id AND link.b=st.source_team_id) OR(link.b=${root}.source_team_id AND link.a=st.source_team_id))))`;
const checks={
  team_source_connections:`EXISTS(SELECT 1 FROM source_teams s WHERE s.id=NEW.source_team_id AND s.account_id IS NEW.account_id)`,
  team_connection_seasons:`EXISTS(SELECT 1 FROM team_source_connections r JOIN team_seasons s ON s.app_team_id=r.app_team_id WHERE r.id=NEW.connection_id AND s.id=NEW.team_season_id AND (NEW.attachment_id IS NULL OR EXISTS(SELECT 1 FROM team_source_attachments a WHERE a.id=NEW.attachment_id AND a.app_team_id=r.app_team_id AND a.team_season_id=s.id AND a.source_team_id=r.source_team_id AND a.account_id IS r.account_id)))`,
  connection_event_resolutions:`EXISTS(SELECT 1 FROM team_source_connections r JOIN source_events e ON e.id=NEW.source_event_id WHERE r.id=NEW.connection_id AND e.account_id IS r.account_id AND ${sourceScope('r','e.id')} AND (NEW.team_season_id IS NULL OR EXISTS(SELECT 1 FROM team_seasons s WHERE s.id=NEW.team_season_id AND s.app_team_id=r.app_team_id)))`,
  team_event_season_resolutions:`NEW.team_season_id IS NULL OR EXISTS(SELECT 1 FROM team_seasons s WHERE s.id=NEW.team_season_id AND s.app_team_id=NEW.app_team_id)`,
  connection_roster_evidence:`EXISTS(SELECT 1 FROM team_source_connections r JOIN team_seasons s ON s.app_team_id=r.app_team_id JOIN source_players p ON p.account_id IS r.account_id WHERE r.id=NEW.connection_id AND s.id=NEW.team_season_id AND p.id=NEW.source_player_id AND (NEW.source_event_id IS NULL OR EXISTS(SELECT 1 FROM source_events e WHERE e.id=NEW.source_event_id AND e.account_id IS r.account_id AND ${sourceScope('r','e.id')})))`,
};
for(const [table,condition]of Object.entries(checks))for(const operation of ['INSERT','UPDATE'])CONNECTION_SCHEMA.push(`CREATE TRIGGER connection_scope_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN NOT(${condition}) BEGIN SELECT RAISE(ABORT,'connection_scope_mismatch'); END`);

const connectedSources=alias=>`source_team_id=${alias} OR source_team_id IN(SELECT a FROM source_team_links WHERE b=${alias} UNION SELECT b FROM source_team_links WHERE a=${alias})`;
const dirty=(condition)=>`UPDATE team_source_connections SET input_revision=input_revision+1 WHERE active=1 AND (${condition});`;
const equivalentEvents=event=>`SELECT ${event} UNION SELECT other.source_event_id FROM event_source_links origin JOIN canonical_event_ids oc ON oc.input_id=origin.event_id JOIN canonical_event_ids pc ON pc.canonical_id=oc.canonical_id JOIN event_source_links other ON other.event_id=pc.input_id WHERE origin.source_event_id=${event}`;
const eventRoots=event=>`source_team_id IN(SELECT st.source_team_id FROM source_event_teams st WHERE st.source_event_id IN(${equivalentEvents(event)})) OR source_team_id IN(SELECT a FROM source_team_links WHERE b IN(SELECT source_team_id FROM source_event_teams WHERE source_event_id IN(${equivalentEvents(event)})) UNION SELECT b FROM source_team_links WHERE a IN(SELECT source_team_id FROM source_event_teams WHERE source_event_id IN(${equivalentEvents(event)})))`;
// A saved source page and its outstanding reconciliation obligation commit
// together, including accepted file imports. Scheduled repair can recover a
// crash before any first season or job-subscription admission.
for(const [table,condition]of Object.entries({
  source_event_teams:connectedSources('NEW.source_team_id'),
  source_roster_memberships:connectedSources('NEW.source_team_id'),
  source_game_members:connectedSources('NEW.source_team_id'),
  source_attendance:connectedSources('NEW.source_team_id'),
  source_teams:connectedSources('NEW.id'),
  source_team_links:`source_team_id IN(NEW.a,NEW.b)`,
  source_competition_memberships:connectedSources('NEW.source_team_id'),
  source_events:eventRoots('NEW.id'),
  event_source_links:eventRoots('NEW.source_event_id'),
}))for(const operation of (table==='event_source_links'?['UPDATE']:['INSERT','UPDATE']))CONNECTION_SCHEMA.push(`CREATE TRIGGER connection_dirty_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN ${dirty(condition)} END`);
CONNECTION_SCHEMA.push(
  `CREATE TRIGGER connection_dirty_timezone AFTER UPDATE OF timezone ON app_teams WHEN OLD.timezone<>NEW.timezone BEGIN ${dirty('app_team_id=NEW.id')} END`,
  `CREATE TRIGGER connection_dirty_owner_event AFTER INSERT ON domain_overrides WHEN NEW.kind='event' AND (json_type(NEW.fields,'$.starts_at') IS NOT NULL OR json_type(NEW.fields,'$.local_day') IS NOT NULL) BEGIN ${dirty('app_team_id=NEW.app_team_id')} END`,
  `CREATE TRIGGER connection_dirty_owner_event_update AFTER UPDATE ON domain_overrides WHEN NEW.kind='event' AND (json_extract(OLD.fields,'$.starts_at') IS NOT json_extract(NEW.fields,'$.starts_at') OR json_extract(OLD.fields,'$.local_day') IS NOT json_extract(NEW.fields,'$.local_day') OR json_type(OLD.fields,'$.starts_at') IS NOT json_type(NEW.fields,'$.starts_at') OR json_type(OLD.fields,'$.local_day') IS NOT json_type(NEW.fields,'$.local_day')) BEGIN ${dirty('app_team_id=NEW.app_team_id')} END`,
  `CREATE TRIGGER connection_dirty_owner_event_delete AFTER DELETE ON domain_overrides WHEN OLD.kind='event' AND (json_type(OLD.fields,'$.starts_at') IS NOT NULL OR json_type(OLD.fields,'$.local_day') IS NOT NULL) BEGIN ${dirty('app_team_id=OLD.app_team_id')} END`,
  `CREATE TRIGGER connection_pending_status AFTER UPDATE OF input_revision ON team_source_connections WHEN NEW.input_revision<>OLD.input_revision BEGIN UPDATE team_read_state SET pending=1,status_revision=status_revision+1 WHERE app_team_id=NEW.app_team_id; END`,
);

for(const [table,condition]of Object.entries({source_event_teams:connectedSources('OLD.source_team_id'),source_roster_memberships:connectedSources('OLD.source_team_id'),source_game_members:connectedSources('OLD.source_team_id'),source_attendance:connectedSources('OLD.source_team_id'),source_competition_memberships:connectedSources('OLD.source_team_id'),source_team_links:'source_team_id IN(OLD.a,OLD.b)'}))CONNECTION_SCHEMA.push(`CREATE TRIGGER connection_dirty_${table}_delete AFTER DELETE ON ${table} BEGIN ${dirty(condition)} END`);
for(const operation of ['INSERT','UPDATE'])CONNECTION_SCHEMA.push(`CREATE TRIGGER connection_dirty_competition_${operation.toLowerCase()} AFTER ${operation} ON source_competitions BEGIN ${dirty(`source_team_id IN(SELECT m.source_team_id FROM source_competition_memberships m JOIN source_divisions d ON d.id=m.source_division_id WHERE d.competition_id=NEW.id UNION SELECT st.source_team_id FROM source_event_teams st JOIN source_events e ON e.id=st.source_event_id WHERE e.competition_key=NEW.id)`)} END`);

// Metadata can change without a new membership row. These dependencies must
// become durable in the same source-page transaction, including file imports.
for(const operation of ['INSERT','UPDATE']) {
  CONNECTION_SCHEMA.push(`CREATE TRIGGER connection_dirty_player_${operation.toLowerCase()} AFTER ${operation} ON source_players BEGIN ${dirty(`source_team_id IN(SELECT source_team_id FROM source_roster_memberships WHERE source_player_id=NEW.id) OR id IN(SELECT connection_id FROM connection_roster_evidence WHERE source_player_id=NEW.id)`)} END`);
  const affected=`SELECT m.source_team_id FROM source_competition_memberships m WHERE m.source_division_id=NEW.id OR (NEW.provider='gotsport' AND m.source_division_id GLOB 'gotsport/public/bracket%3A*' AND NEW.competition_id='gotsport/public/'||json_extract(m.evidence,'$.event_id')) UNION SELECT st.source_team_id FROM source_event_teams st JOIN source_events e ON e.id=st.source_event_id WHERE e.division_key=NEW.id`;
  CONNECTION_SCHEMA.push(`CREATE TRIGGER connection_dirty_division_${operation.toLowerCase()} AFTER ${operation} ON source_divisions BEGIN ${dirty(`source_team_id IN(${affected}) OR source_team_id IN(SELECT a FROM source_team_links WHERE b IN(${affected}) UNION SELECT b FROM source_team_links WHERE a IN(${affected}))`)} END`);
}

// Source reassignment invalidates both canonical groups, including the old
// group's consumers after the moved link no longer points at that group.
CONNECTION_SCHEMA.push(`CREATE TRIGGER connection_dirty_event_old_group AFTER UPDATE OF event_id ON event_source_links WHEN OLD.event_id<>NEW.event_id BEGIN ${dirty(`source_team_id IN(SELECT st.source_team_id FROM source_event_teams st JOIN event_source_links peer ON peer.source_event_id=st.source_event_id JOIN canonical_event_ids pc ON pc.input_id=peer.event_id WHERE pc.canonical_id=(SELECT canonical_id FROM canonical_event_ids WHERE input_id=OLD.event_id))`)} END`);
