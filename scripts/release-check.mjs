import {readFile,writeFile,mkdir,copyFile,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {VERSION} from '../src/application/version.js';
import {installationSchema} from '../src/application/fresh-install.js';
import {SCHEMA,SEED,DOMAIN_SCHEMA_VERSION} from '../src/application/installation-schema.js';
import {InstallationUpgrade,V714_FINGERPRINT,V714_CURSOR,V714_OBJECTS,schemaObjects,sealStatements,journalStatements,equalObjects} from '../src/application/schema-upgrade.js';
import {INSTALLATION_EPOCH} from '../src/application/installation-epoch.js';
import {InstallationUpgrade as PredecessorInstallation} from '../src/application/schema-upgrade-v731.js';
import {V731_FINGERPRINT,V731_PLAN_HASH,V731_CURSOR,V731_OBJECTS,V731_SCHEMA,V731_SEED} from '../src/application/schema-v731.js';
import {TEAM_GAME_EPOCH,TEAM_GAME_BOOTSTRAP_SCHEMA} from '../src/application/team-game-installation-epoch.js';
import {teamGameExpectedObjects} from '../src/application/team-game-schema-upgrade.js';
import {transferObjects} from '../src/application/transfer-schema-upgrade.js';
import {zipEntry,zipDirectory,zipEnd,concat} from '../src/reporting/encoders.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configFile='wrangler.jsonc';
const placeholder='00000000-0000-0000-0000-000000000000';
const preservedDatabase='60f77502-33d4-41d6-80d4-1c5577ebba76';
const oldDatabaseHash=createHash('sha256').update('c3585493-4ad5-44f2-9484-816a615ee633').digest('hex');
const sourceDirectories=new Set(['analysis','application','coaching','domain','read-model','reporting','security','sources','sync','tracking']);
const sha256=data=>createHash('sha256').update(data).digest('hex');
const fail=message=>{throw new Error(message);};
const relative=file=>path.relative(root,file).split(path.sep).join('/');

// Parse comments without changing text inside quoted URLs or passwords. The
// resulting document remains data; configuration is never evaluated as code.
export function parseJSONC(text){let out='',quoted=false,escaped=false;for(let i=0;i<text.length;i++){const c=text[i],next=text[i+1];if(quoted){out+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;out+=c;continue;}if(c==='/'&&next==='/'){while(i<text.length&&text[i]!=='\n')i++;out+='\n';continue;}if(c==='/'&&next==='*'){i+=2;while(i<text.length&&!(text[i]==='*'&&text[i+1]==='/'))i++;i++;out+=' ';continue;}out+=c;}let clean='',inString=false,escape=false;for(let i=0;i<out.length;i++){const c=out[i];if(inString){clean+=c;if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;continue;}if(c==='"'){inString=true;clean+=c;continue;}if(c===','){let n=i+1;while(/\s/.test(out[n]||'')&&n<out.length)n++;if(out[n]===']'||out[n]==='}')continue;}clean+=c;}return JSON.parse(clean);}

export function validateConfiguration(config,{deployment=false}={}){
 if(config.name!=='myts-v7'||config.main!=='worker.js')fail('Deploy this release to the existing myts-v7 Worker using worker.js.');
 if(config.preview_urls!==false)fail('Explicitly disable Preview URLs with preview_urls: false.');
 if(config.limits?.cpu_ms!==30000)fail('Set limits.cpu_ms to 30000 explicitly for the portable owner password verifier.');
 if(config.assets?.directory!=='./web'||config.assets?.binding!=='ASSETS'||config.assets?.run_worker_first!==true)fail('The complete fresh web assets and ASSETS binding are required.');
 if(Object.hasOwn(config,'migrations')||config.exports?.SyncRuntime?.type!=='durable-object'||config.exports.SyncRuntime.storage!=='sqlite')fail('Use the fresh declarative SQLite SyncRuntime export without migrations.');
 if(!config.durable_objects?.bindings?.some(binding=>binding.name==='SYNC'&&binding.class_name==='SyncRuntime'))fail('The independent SYNC background runtime binding is required.');
 if(JSON.stringify(config.triggers?.crons)!==JSON.stringify(['* * * * *']))fail('Keep the one-minute background recovery trigger.');
 const databases=config.d1_databases;
 if(!Array.isArray(databases)||databases.length!==1||databases[0].binding!=='DB')fail('Configure exactly one fresh DB binding.');
 const database=databases[0];
 if(database.database_name!=='myts-v7-rebuild-data')fail('Use myts-v7-rebuild-data while preserving myts-v7-data.');
 if(typeof database.database_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(database.database_id))fail('The fresh D1 database ID must be its UUID.');
 if(sha256(database.database_id.toLowerCase())===oldDatabaseHash)fail('This database ID belongs to the previous application. Bind a fresh myts-v7-rebuild-data database; preserve the existing database.');
 if(deployment&&database.database_id===placeholder)fail('Replace the rebuild database placeholder with its D1 database ID before deployment.');
 if(deployment&&database.database_id!==preservedDatabase)fail('This in-place release must preserve database 60f77502-33d4-41d6-80d4-1c5577ebba76. Do not switch databases.');
 if(config.vars?.MYTS_UPGRADE_MODE!==undefined&&!['normal','maintenance'].includes(config.vars.MYTS_UPGRADE_MODE))fail('MYTS_UPGRADE_MODE must be normal or maintenance.');
 if(config.vars&&Object.keys(config.vars).some(key=>/key|token|password|credential|secret/i.test(key)))fail('Keep owner and provider secrets out of the deployment configuration.');
 return database;
}

// Static declarations begin a source line; JSDoc's '* import ...' examples
// must not become runtime dependencies of unmodified vendored modules.
const imports=text=>[...text.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/gm),...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(match=>match[1]);
async function moduleClosure(entries){const files=new Set(),pending=[...entries];while(pending.length){const name=pending.pop(),absolute=path.resolve(root,name);if(!absolute.startsWith(root+path.sep))fail('A module leaves the review project.');const key=relative(absolute);if(files.has(key))continue;if(key.startsWith('src/')&&!sourceDirectories.has(key.split('/')[1]))fail('The fresh application imports an obsolete source module: '+key);await stat(absolute);files.add(key);if(key.endsWith('.js')||key.endsWith('.mjs'))for(const specifier of imports(await readFile(absolute,'utf8'))){if(specifier.startsWith('.'))pending.push(relative(path.resolve(path.dirname(absolute),specifier)));else if(specifier!=='cloudflare:workers'&&!specifier.startsWith('node:'))fail('An unlisted runtime dependency is required: '+specifier);}}return files;}

export function scanSecretText(name,text){const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{35,}|sk-[A-Za-z0-9_-]{30,})\b/,/["'](?:ADMIN_KEY|CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_KEY|access_token|refresh_token)["']\s*:\s*["'][^"'\s]{16,}["']/];if(patterns.some(pattern=>pattern.test(text)))fail('Potential embedded credential in '+name+'. Remove it before packaging.');}

const contractDocs=['acceptance-baseline','analysis-reads-contract','coaching-contract','data-files-contract','domain-contract','feature-reads-contract','frontend-contract','matching-contract','provider-access','reporting-contract','security-contract','sync-contract','team-features-contract','tracking-capture-contract','verification','schema-comparison','deployment-verification','owner-initialization','schema-upgrade'];
export async function requiredFiles({include=[]}={}){const worker=await moduleClosure(['worker.js']),browser=await moduleClosure(['web/app/entry.js']),tooling=await moduleClosure(['scripts/release-check.mjs']);const result=new Set([...worker,...browser,...tooling,'package.json','package-lock.json',configFile,'README.md','docs/fresh-deployment.md','web/app/index.html','web/ui-original/original.css','web/assets/report-font.ttf','web/assets/report-font.LICENSE','src/security/vendor/noble-hashes-1.7.1/LICENSE','src/security/vendor/noble-hashes-1.7.1/SOURCE.json','src/security/vendor/noble-hashes-1.7.1/README.md',...contractDocs.map(name=>'docs/'+name+'.md')]);for(const item of include){const resolved=path.resolve(root,item);if(!resolved.startsWith(root+path.sep)||!/^docs\/[A-Za-z0-9._/-]+\.(?:md|json)$/.test(relative(resolved)))fail('Additional release files must be named review documents inside docs/.');result.add(relative(resolved));}return [...result].sort();}

export async function schemaIdentityV731(){
 const entry=await readFile(path.join(root,'worker.js'),'utf8');if(!entry.includes("import {SCHEMA,SEED} from './src/application/installation-schema.js';"))fail('The Worker must use the reviewed shared installation schema.');
 const model=new PredecessorInstallation({}, {schema:V731_SCHEMA,seed:V731_SEED}),schema=installationSchema([V731_SCHEMA]);
 return {fingerprint:await model.fingerprint,domainVersion:DOMAIN_SCHEMA_VERSION,tables:new Set(schema.filter(sql=>/^CREATE TABLE/i.test(sql)).map(sql=>sql.match(/^CREATE TABLE IF NOT EXISTS\s+(\w+)/i)[1])),schema,objects:model.targetObjects,expansion:model.expansion,planHash:await model.planHash};
}

export function validateRemoteDatabaseV731(names,setup,domain,identity,details){
 const actual=names.filter(name=>name!=='d1_migrations'&&!name.startsWith('_cf_')&&!name.startsWith('sqlite_'));
 if(!actual.length)return {state:'empty'};
 if(!details||!Array.isArray(details.objects))fail('Physical schema metadata is required to validate this preserved installation.');
 if(details&&setup?.schema_fingerprint===V714_FINGERPRINT){
  if(setup.state!=='ready'||setup.next_index!==V714_CURSOR||!setup.started_at||!setup.completed_at||domain?.schema_version!==1)fail('The 7.1.4 installation is incomplete. Preserve it and review the upgrade preconditions.');
  const journal=details.journal;
  if(!journal){if(!equalObjects(details.objects,schemaObjects(V714_OBJECTS.map(row=>row.sql))))fail('The 7.1.4 physical schema differs from the reviewed manifest. No upgrade is authorized.');return {state:'upgrade_required',fingerprint:V714_FINGERPRINT,target:identity.fingerprint};}
  if(journal.epoch!==INSTALLATION_EPOCH||journal.from_fingerprint!==V714_FINGERPRINT||journal.to_fingerprint!==identity.fingerprint||journal.plan_hash!==identity.planHash||journal.original_started_at!==setup.started_at||journal.original_completed_at!==setup.completed_at||journal.original_cursor!==V714_CURSOR||journal.writer_mode!==null||journal.permit_guard!==null||!['sealing','expanding','transfers','roots','memberships','receipts','rosters','events','validating'].includes(journal.phase))fail('The upgrade journal belongs to another plan or is incomplete.');
  let expected=identity.objects;
  if(['sealing','expanding'].includes(journal.phase)){
   const steps=journal.phase==='sealing'?sealStatements:identity.expansion;if(!/^\d+$/.test(journal.cursor)||Number(journal.cursor)>steps.length)fail('The upgrade cursor is invalid.');
   expected=schemaObjects([...V714_OBJECTS.map(row=>row.sql),...journalStatements,...(journal.phase==='sealing'?sealStatements.slice(0,Number(journal.cursor)):[...sealStatements,...identity.expansion.slice(0,Number(journal.cursor))])]);
  }else if(journal.phase==='transfers')expected=transferObjects(identity.objects,journal.cursor);
  if(!equalObjects(details.objects,expected))fail('The partial upgrade does not match its reviewed journal.');
  return {state:'upgrading',phase:journal.phase,fingerprint:V714_FINGERPRINT,target:identity.fingerprint};
 }
 const ready=setup?.state==='ready',missingReadyTable=ready&&[...identity.tables].some(name=>!actual.includes(name));
 if(!actual.includes('setup_state')||!setup||setup.schema_fingerprint!==identity.fingerprint||!['initializing','ready'].includes(setup.state)||(domain&&domain.schema_version!==identity.domainVersion)||(ready&&!domain)||missingReadyTable||actual.some(name=>name!=='setup_state'&&!identity.tables.has(name)))fail('The selected remote database belongs to another build or is incomplete. Preserve the selected database and review its installation identity.');
 if(details){
  if(!ready)fail('The production target must be fully ready. Fresh initialization is supported locally, not as recovery for this preserved database.');
  const expected=ready?identity.objects:schemaObjects([V714_OBJECTS.find(row=>row.name==='setup_state').sql,...identity.schema.slice(0,setup.next_index)]);
  if(!Number.isInteger(setup.next_index)||setup.next_index<0||setup.next_index>identity.schema.length||(ready&&setup.next_index!==identity.schema.length)||!equalObjects(details.objects,expected))fail('The target physical schema is incomplete or differs from the reviewed manifest.');
  if(ready){const journal=details.journal;if(!journal||journal.epoch!==INSTALLATION_EPOCH||journal.to_fingerprint!==identity.fingerprint||journal.phase!=='complete'||journal.writer_mode!==null||journal.permit_guard!==null||journal.from_fingerprint!==V714_FINGERPRINT||journal.plan_hash!==identity.planHash||journal.original_cursor!==V714_CURSOR||journal.original_started_at!==setup.started_at||journal.original_completed_at!==setup.completed_at)fail('The target installation journal does not prove the preserved 7.1.4 transition.');}
 }
 return {state:setup.state,fingerprint:identity.fingerprint};
}

export async function schemaIdentity(){
 const entry=await readFile(path.join(root,'worker.js'),'utf8');if(!entry.includes("import {SCHEMA,SEED} from './src/application/installation-schema.js';"))fail('The Worker must use the reviewed shared installation schema.');
 const model=new InstallationUpgrade({}, {schema:SCHEMA,seed:SEED}),schema=installationSchema([SCHEMA]);
 return {fingerprint:await model.fingerprint,domainVersion:DOMAIN_SCHEMA_VERSION,tables:new Set(schema.filter(sql=>/^CREATE TABLE/i.test(sql)).map(sql=>sql.match(/^CREATE TABLE IF NOT EXISTS\s+(\w+)/i)[1])),schema,objects:model.targetObjects,expansion:model.expansion,planHash:await model.planHash,baseFingerprint:V731_FINGERPRINT,basePlanHash:V731_PLAN_HASH,predecessor:await schemaIdentityV731()};
}
const baseReceiptFields=['epoch','from_fingerprint','to_fingerprint','plan_hash','phase','cursor','started_at','completed_at','original_started_at','original_completed_at','original_cursor','writer_mode','writer_epoch','permit_guard'];
export function validateRemoteDatabase(names,setup,domain,identity,details){
 const actual=names.filter(name=>name!=='d1_migrations'&&!name.startsWith('_cf_')&&!name.startsWith('sqlite_'));
 if(!actual.length)return {state:'empty'};
 if(!details||!Array.isArray(details.objects))fail('Physical schema metadata is required to validate this preserved installation.');
 if(setup?.state==='initializing')fail('The production target must be fully ready; fresh initialization is not recovery for the preserved database.');
 const metadataNames=details.objects.filter(row=>row.type==='table').map(row=>row.name);
 if(actual.length!==metadataNames.length||actual.some(name=>!metadataNames.includes(name)))fail('The selected remote database belongs to another build or is incomplete.');
 if(!setup||!actual.includes('setup_state'))fail('The selected remote database belongs to another build or is incomplete.');
 if(setup.state!=='ready')fail('The production target must be fully ready; fresh initialization is not recovery for the preserved database.');
 if(!domain||domain.schema_version!==identity.domainVersion)fail('The selected remote database is incomplete.');
 if(setup.schema_fingerprint===V714_FINGERPRINT){
  if(details.extension)fail('The old714 transition cannot contain a team-game extension.');
  const prior=validateRemoteDatabaseV731(names,setup,domain,identity.predecessor,details);
  return {...prior,route:'predecessor731',predecessorTarget:V731_FINGERPRINT,target:identity.fingerprint};
 }
 if(setup.schema_fingerprint===identity.fingerprint){
  if([...identity.tables].some(name=>!actual.includes(name)))fail('The target physical schema is incomplete.');
  fail('A fresh-origin target cannot prove the preserved 7.1.4 transition and exact731 base receipt. No production replacement is authorized.');
 }
 if(setup.schema_fingerprint!==V731_FINGERPRINT||setup.next_index!==V731_CURSOR||!setup.started_at||!setup.completed_at)fail('The selected remote database belongs to another build or is incomplete; this extension requires exact completed731.');
 const journal=details.journal;
 if(!journal||journal.epoch!=='team-connections-v1'||journal.from_fingerprint!==V714_FINGERPRINT||journal.to_fingerprint!==V731_FINGERPRINT||journal.plan_hash!==V731_PLAN_HASH||journal.phase!=='complete'||journal.cursor!==''||!journal.started_at||!journal.completed_at||journal.original_cursor!==V714_CURSOR||journal.original_started_at!==setup.started_at||journal.original_completed_at!==setup.completed_at||journal.writer_mode!==null||journal.writer_epoch!==null||journal.permit_guard!==null)fail('The completed731 base does not prove the preserved 7.1.4 transition.');
 const extension=details.extension;
 if(!extension){
  if(!equalObjects(details.objects,V731_OBJECTS))fail('The exact731 physical schema differs from its preserved manifest.');
  return {state:'upgrade_required',fingerprint:V731_FINGERPRINT,target:identity.fingerprint,baseFingerprint:V731_FINGERPRINT};
 }
 const receipt=Object.fromEntries(baseReceiptFields.map(key=>[key,journal[key]??null]));
 if(extension.origin!=='preserved731'||extension.epoch!==TEAM_GAME_EPOCH||extension.record_version!==1||extension.base_fingerprint!==V731_FINGERPRINT||extension.base_plan_hash!==V731_PLAN_HASH||extension.target_fingerprint!==identity.fingerprint||extension.plan_hash!==identity.planHash||extension.base_setup_started_at!==setup.started_at||extension.base_setup_completed_at!==setup.completed_at||extension.base_cursor!==V731_CURSOR||extension.base_journal_hash!==sha256(JSON.stringify(receipt))||extension.writer_mode!==null||extension.writer_epoch!==null||extension.permit_guard!==null)fail('The extension journal belongs to another plan or does not preserve the exact731 receipt.');
 if(!['expanding','validating','complete'].includes(extension.phase)||!Number.isInteger(extension.cursor)||extension.cursor<0||extension.cursor>identity.expansion.length||(extension.phase!=='expanding'&&extension.cursor!==identity.expansion.length)||(extension.phase==='complete')!==!!extension.completed_at)fail('The extension phase or cursor is invalid.');
 const expected=teamGameExpectedObjects(identity.expansion,extension.cursor);
 if(!equalObjects(details.objects,expected))fail('The extension physical schema is incomplete or differs from the exact reviewed prefix.');
 return {state:extension.phase==='complete'?'ready':'upgrading',phase:extension.phase,fingerprint:extension.phase==='complete'?identity.fingerprint:V731_FINGERPRINT,target:identity.fingerprint,baseFingerprint:V731_FINGERPRINT};
}

function remoteQuery(sql){const command=spawnSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB','--config',configFile,'--remote','--json','--command',sql],{cwd:root,encoding:'utf8',env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:4*1024*1024});if(command.status!==0)fail('Remote database inspection failed. No deployment is authorized; verify the build token has D1 Read permission in the target account.');let parsed;try{parsed=JSON.parse(command.stdout);}catch{fail('Remote inspection returned an unreadable response. No deployment is authorized.');}if(!Array.isArray(parsed)||!parsed.length||parsed.some(result=>!result||result.success!==true||!Array.isArray(result.results)))fail('Remote database inspection did not complete. No deployment is authorized.');return parsed.flatMap(result=>result.results);}
async function inspectRemote(identity){const objects=remoteQuery("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY type,name"),names=objects.filter(row=>row.type==='table').map(row=>row.name);if(!names.length)return validateRemoteDatabase(names,null,null,identity,{objects,journal:null,extension:null});if(!names.includes('setup_state'))return validateRemoteDatabase(names,null,null,identity,{objects,journal:null,extension:null});const setup=remoteQuery('SELECT schema_fingerprint,next_index,state,started_at,completed_at FROM setup_state WHERE id=1')[0],domain=names.includes('domain_installation')?remoteQuery('SELECT schema_version FROM domain_installation WHERE id=1')[0]:null,journal=names.includes('installation_upgrade')?remoteQuery('SELECT '+baseReceiptFields.join(',')+' FROM installation_upgrade WHERE id=1')[0]:null,extension=names.includes('installation_team_games_upgrade')?remoteQuery('SELECT * FROM installation_team_games_upgrade WHERE id=1')[0]:null;return validateRemoteDatabase(names,setup,domain,identity,{objects,journal,extension});}

export async function stageRelease(destination,files){const target=path.resolve(destination);if(target===root||root.startsWith(target+path.sep))fail('Use a separate staging directory.');await mkdir(target,{recursive:true});if((await readdir(target)).length)fail('The staging directory must be empty. Use a new directory so no unlisted files can be retained.');const manifest={service:'myTS',version:VERSION,review:true,files:[]};for(const name of files){const source=path.join(root,name),data=await readFile(source);if(!name.endsWith('.ttf'))scanSecretText(name,data.toString('utf8'));const output=path.join(target,name);await mkdir(path.dirname(output),{recursive:true});await copyFile(source,output);manifest.files.push({path:name,bytes:data.length,sha256:sha256(data)});}await writeFile(path.join(target,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;}

export async function zipRelease(destination,files,output){if(!output.endsWith('.zip'))fail('The release archive must have a .zip filename.');let offset=0;const parts=[],entries=[];for(const name of [...files,'release-manifest.json'].sort()){const data=new Uint8Array(await readFile(path.join(destination,name))),entry=zipEntry(name,data,offset);parts.push(entry.data);entries.push(entry.entry);offset+=entry.data.length;}const directory=zipDirectory(entries),zip=concat([...parts,directory,zipEnd(entries.length,directory.length,offset)]);if(zip.length>32*1024*1024)fail('The required-only release ZIP exceeds its package capacity.');await mkdir(path.dirname(path.resolve(output)),{recursive:true});await writeFile(output,zip);return {bytes:zip.length,sha256:sha256(zip)};}

async function main(){const args=process.argv.slice(2),deployment=args.includes('--deploy'),stageIndex=args.indexOf('--stage'),zipIndex=args.indexOf('--zip'),include=[];for(let i=0;i<args.length;i++)if(args[i]==='--include')include.push(args[++i]);const config=parseJSONC(await readFile(path.join(root,configFile),'utf8'));validateConfiguration(config,{deployment});const packageJSON=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')),lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));if(packageJSON.version!==VERSION||lock.version!==VERSION||lock.packages?.['']?.version!==VERSION||packageJSON.devDependencies?.wrangler!=='4.149.0'||lock.packages?.['']?.devDependencies?.wrangler!=='4.149.0'||lock.packages?.['node_modules/wrangler']?.version!=='4.149.0')fail('Visible version or exact pinned dependency lock is inconsistent.');const files=await requiredFiles({include});for(const name of files){const data=await readFile(path.join(root,name));if(!name.endsWith('.ttf'))scanSecretText(name,data.toString('utf8'));}const identity=await schemaIdentity();console.log(`myTS ${VERSION}: ${files.length} required files checked; dependency lock and fresh schema match.`);if(deployment){const result=await inspectRemote(identity);if(result.state==='empty')fail('The preserved production database is unexpectedly empty. No deployment or fresh initialization is authorized.');console.log(`Remote rebuild database inspected: ${result.state}. Deployment guard passed.`);}if(stageIndex>=0){if(!args[stageIndex+1])fail('Provide a staging directory.');const destination=args[stageIndex+1];await stageRelease(destination,files);console.log('Required-only release staged.');if(zipIndex>=0){if(!args[zipIndex+1])fail('Provide the output ZIP path.');const zip=await zipRelease(destination,files,args[zipIndex+1]);console.log(`Release ZIP: ${zip.bytes} bytes; SHA-256 ${zip.sha256}.`);}}else if(zipIndex>=0)fail('ZIP creation requires an explicit staging directory.');}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
