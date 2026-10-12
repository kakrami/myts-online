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
import {installationGateSchema,freshJournalSeed} from './installation-epoch.js';

export const APPLICATION_SCHEMA=[...DOMAIN_SCHEMA,...SECURITY_SCHEMA,...SYNC_SCHEMA,...TEAM_FEATURE_SCHEMA,...CATALOG_SCHEMA,...COACH_SCHEMA,...ANALYSIS_SCHEMA,...REPORT_SCHEMA,...DATA_FILE_SCHEMA,...TRACKING_CAPTURE_SCHEMA,...AWARDS_SCHEMA];
export const SCHEMA=[...APPLICATION_SCHEMA,...installationGateSchema(APPLICATION_SCHEMA)];
export const SEED=[{sql:`INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,${DOMAIN_SCHEMA_VERSION},strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO NOTHING`,params:[]},freshJournalSeed];
export {DOMAIN_SCHEMA_VERSION};
