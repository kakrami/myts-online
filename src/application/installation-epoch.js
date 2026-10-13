// The exact731 contract remains immutable; current writes additionally require
// the fixed team-game extension permit and retain N+2 statement admission.
export {INSTALLATION_EPOCH,UPGRADE_TABLE,UPGRADE_DDL,JOURNAL_GUARDS,tableNames,tableGuards,installationGateSchema,freshJournalSeed} from './installation-epoch-v731.js';
export {sqlOperation,wrapDatabase} from './team-game-installation-epoch.js';
