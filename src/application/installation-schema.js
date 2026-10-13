import {DOMAIN_SCHEMA,DOMAIN_SCHEMA_VERSION} from '../domain/schema.js';
import {SECURITY_SCHEMA} from '../security/schema.js';
import {SYNC_SCHEMA} from '../sync/schema.js';
import {COACH_SCHEMA} from '../coaching/schema.js';
import {ANALYSIS_SCHEMA} from '../analysis/schema.js';
import {REPORT_SCHEMA} from '../reporting/schema.js';
import {DATA_FILE_SCHEMA} from '../reporting/data-schema.js';
import {TRACKING_CAPTURE_SCHEMA} from '../tracking/schema.js';
import {TEAM_FEATURE_SCHEMA} from './team-features.js';
import {CATALOG_SCHEMA} from './team-catalog.js';
import {AWARDS_SCHEMA} from '../read-model/feature-schema.js';
import {TEAM_GAME_SCHEMA,TEAM_GAME_TABLES} from '../domain/team-game-schema.js';
import {V731_SCHEMA,V731_SEED,V731_FINGERPRINT,V731_PLAN_HASH,V731_CURSOR} from './schema-v731.js';
import {tableGuards} from './installation-epoch-v731.js';
import {TEAM_GAME_BOOTSTRAP_SCHEMA,TEAM_GAME_RUN_BASE_DDL,TEAM_GAME_RUN_TARGET_DDL,TEAM_GAME_RUN_ALTER} from './team-game-installation-epoch.js';

// Keep the predecessor statement order and seed byte-identical. A new target
// never recomputes or rewrites the historical714 ->731 transition.
export const TEAM_GAME_EXPANSION_SCHEMA=[TEAM_GAME_RUN_ALTER,...TEAM_GAME_SCHEMA,...tableGuards(TEAM_GAME_TABLES)];
export const SCHEMA=[...V731_SCHEMA.map(sql=>sql===TEAM_GAME_RUN_BASE_DDL?TEAM_GAME_RUN_TARGET_DDL:sql),...TEAM_GAME_BOOTSTRAP_SCHEMA,...TEAM_GAME_EXPANSION_SCHEMA.filter(sql=>sql!==TEAM_GAME_RUN_ALTER)];
export const APPLICATION_SCHEMA=[...DOMAIN_SCHEMA,...SECURITY_SCHEMA,...SYNC_SCHEMA,...TEAM_FEATURE_SCHEMA,...CATALOG_SCHEMA,...COACH_SCHEMA,...ANALYSIS_SCHEMA,...REPORT_SCHEMA,...DATA_FILE_SCHEMA,...TRACKING_CAPTURE_SCHEMA,...AWARDS_SCHEMA];
export const TEAM_GAME_FRESH_SEED={sql:`INSERT INTO installation_team_games_upgrade(id,epoch,origin,base_fingerprint,base_plan_hash,target_fingerprint,plan_hash,base_setup_started_at,base_setup_completed_at,base_cursor,base_journal_hash,phase,cursor,started_at,completed_at) SELECT 1,'team-games-v1','fresh','${V731_FINGERPRINT}','${V731_PLAN_HASH}',schema_fingerprint,'fresh',started_at,NULL,${V731_CURSOR},NULL,'complete',${TEAM_GAME_EXPANSION_SCHEMA.length},started_at,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM setup_state WHERE id=1 AND state='initializing' AND NOT EXISTS(SELECT 1 FROM installation_team_games_upgrade WHERE id=1)`,params:[]};
export const SEED=[...V731_SEED,TEAM_GAME_FRESH_SEED];
export {DOMAIN_SCHEMA_VERSION};
