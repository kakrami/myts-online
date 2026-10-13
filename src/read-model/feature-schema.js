const AWARDS_SCHEMA = [
  `CREATE TABLE owner_awards(id TEXT PRIMARY KEY,app_team_id TEXT NOT NULL REFERENCES app_teams(id),team_season_id TEXT NOT NULL REFERENCES team_seasons(id),competition_id TEXT REFERENCES competitions(id),title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 300),place INTEGER CHECK(place BETWEEN 1 AND 64),note TEXT NOT NULL CHECK(length(note)<=2000),revision INTEGER NOT NULL CHECK(revision>0),request_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,write_token TEXT NOT NULL)`,
  `CREATE TABLE award_write_fences(id TEXT PRIMARY KEY,token TEXT NOT NULL)`,
  `CREATE TABLE source_competition_qualifications(id TEXT PRIMARY KEY,source_division_id TEXT NOT NULL REFERENCES source_divisions(id),participant_key TEXT NOT NULL,title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 300),place INTEGER CHECK(place BETWEEN 1 AND 64),verified_at TEXT NOT NULL,evidence TEXT NOT NULL CHECK(length(CAST(evidence AS BLOB))<=16000),content_hash TEXT NOT NULL,UNIQUE(source_division_id,participant_key,title))`,
  `CREATE TABLE award_source_state(source_division_id TEXT PRIMARY KEY REFERENCES source_divisions(id),revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TRIGGER award_source_insert AFTER INSERT ON source_competition_qualifications BEGIN INSERT INTO award_source_state(source_division_id,revision) VALUES(NEW.source_division_id,1) ON CONFLICT(source_division_id) DO UPDATE SET revision=revision+1; END`,
  `CREATE TRIGGER award_source_update AFTER UPDATE ON source_competition_qualifications BEGIN INSERT INTO award_source_state(source_division_id,revision) VALUES(OLD.source_division_id,1) ON CONFLICT(source_division_id) DO UPDATE SET revision=revision+1; INSERT INTO award_source_state(source_division_id,revision) VALUES(NEW.source_division_id,1) ON CONFLICT(source_division_id) DO UPDATE SET revision=revision+1; END`,
  `CREATE TRIGGER award_source_delete AFTER DELETE ON source_competition_qualifications BEGIN INSERT INTO award_source_state(source_division_id,revision) VALUES(OLD.source_division_id,1) ON CONFLICT(source_division_id) DO UPDATE SET revision=revision+1; END`
];
export {
  AWARDS_SCHEMA
};
