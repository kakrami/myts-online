import {createHash} from 'node:crypto';
import {V731_FINGERPRINT,V731_PLAN_HASH} from '../src/application/schema-v731.js';
import {teamGameExpectedObjects} from '../src/application/team-game-schema-upgrade.js';
export function preservedFixture(identity,{phase='complete',cursor=identity.expansion.length}={}){
 const setup={schema_fingerprint:V731_FINGERPRINT,next_index:731,state:'ready',started_at:'original-start',completed_at:'original-complete'};
 const journal={epoch:'team-connections-v1',from_fingerprint:'e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003',to_fingerprint:V731_FINGERPRINT,plan_hash:V731_PLAN_HASH,phase:'complete',cursor:'',started_at:'old-upgrade-start',completed_at:'old-upgrade-complete',original_started_at:setup.started_at,original_completed_at:setup.completed_at,original_cursor:270,writer_mode:null,writer_epoch:null,permit_guard:null};
 const extension={id:1,epoch:'team-games-v1',record_version:1,origin:'preserved731',base_fingerprint:V731_FINGERPRINT,base_plan_hash:V731_PLAN_HASH,target_fingerprint:identity.fingerprint,plan_hash:identity.planHash,base_setup_started_at:setup.started_at,base_setup_completed_at:setup.completed_at,base_cursor:731,base_journal_hash:createHash('sha256').update(JSON.stringify(journal)).digest('hex'),phase,cursor,started_at:'extension-start',completed_at:phase==='complete'?'extension-complete':null,assertion:1,writer_mode:null,writer_epoch:null,permit_guard:null};
 const objects=teamGameExpectedObjects(identity.expansion,cursor),names=objects.filter(o=>o.type==='table').map(o=>o.name);return {setup,journal,extension,objects,names};
}
