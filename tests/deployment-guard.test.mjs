import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {requiredFiles, stageRelease, schemaIdentity} from '../scripts/release-check.mjs';
import {V731_OBJECTS} from '../src/application/schema-v731.js';
import {preservedFixture} from './team-game-release-fixture.mjs';

const fakeWrangler = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MYTS_GUARD_TRACE, JSON.stringify(args) + '\\n');
if (args[0] === 'd1' && args[1] === 'execute' && args[2] === 'DB'
    && args.includes('--remote') && args.includes('--json')) {
  switch (process.env.MYTS_GUARD_SCENARIO) {
    case 'known-old':
    case 'initializing-target': {
      const loaded=JSON.parse(fs.readFileSync(process.env.MYTS_GUARD_DATABASE_FIXTURE,'utf8'));
      const fixture=process.env.MYTS_GUARD_SCENARIO==='initializing-target'?loaded.target:loaded;
      const sql=args[args.indexOf('--command')+1];
      const results=sql.includes('FROM sqlite_master')?fixture.objects:sql.includes('FROM setup_state')?[fixture.setup]:sql.includes('FROM domain_installation')?[{schema_version:1}]:sql.includes('FROM installation_upgrade')?[fixture.journal]:null;
      if(!results){process.exitCode=87;break;}
      process.stdout.write(JSON.stringify([{success:true,results}]));
      break;
    }
    case 'empty':
      process.stdout.write(JSON.stringify([{success:true, results:[]}]));
      break;
    case 'query-failure':
      process.stderr.write('Fixture remote D1 query failed.\\n');
      process.exitCode = 2;
      break;
    case 'unreadable-json':
      process.stdout.write('This fixture response is not JSON.');
      break;
    case 'foreign-schema':
      process.stdout.write(JSON.stringify([{success:true, results:[{type:'table',name:'installation',sql:'CREATE TABLE installation(id INTEGER)'}]}]));
      break;
    case 'empty-envelope':
      process.stdout.write('[]');
      break;
    case 'missing-success':
      process.stdout.write(JSON.stringify([{results:[]}]));
      break;
    case 'missing-results':
      process.stdout.write(JSON.stringify([{success:true}]));
      break;
    default:
      process.stderr.write('Unexpected fixture scenario.\\n');
      process.exitCode = 86;
  }
} else if (args[0] === 'deploy' && args[1] === '--config' && args[2] === 'wrangler.jsonc'
           && args.length === 3) {
  fs.writeFileSync(process.env.MYTS_GUARD_DEPLOY_SENTINEL, 'deploy reached\\n');
} else {
  process.stderr.write('Unexpected Wrangler fixture invocation.\\n');
  process.exitCode = 86;
}
`;

async function runPipeline(scenario, check, amendConfig) {
  const fixture = await mkdtemp(path.join(tmpdir(), 'myts-deployment-guard-'));
  try {
    // Copy the actual release and its actual npm deploy script. Only the
    // isolated Wrangler CLI is substituted; there is no cloud authentication
    // or network access, and no application/runtime module is modified.
    await stageRelease(fixture, await requiredFiles());
    if (amendConfig) {
      const configPath = path.join(fixture, 'wrangler.jsonc');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      amendConfig(config);
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    }
    const bin = path.join(fixture, 'node_modules/wrangler/bin');
    const npmBin = path.join(fixture, 'node_modules/.bin');
    await mkdir(bin, {recursive:true});
    await mkdir(npmBin, {recursive:true});
    await writeFile(path.join(fixture, 'node_modules/wrangler/package.json'),
      JSON.stringify({name:'wrangler', version:'4.149.0', type:'commonjs'}));
    await writeFile(path.join(bin, 'wrangler.js'), fakeWrangler, {mode:0o755});
    await symlink('../wrangler/bin/wrangler.js', path.join(npmBin, 'wrangler'));
    const trace = path.join(fixture, 'guard-trace.jsonl');
    const sentinel = path.join(fixture, 'deploy-sentinel.txt');
    const databaseFixture=path.join(fixture,'guard-database.json');
    const identity=await schemaIdentity();
    const preserved=preservedFixture(identity);await writeFile(databaseFixture,JSON.stringify({target:{objects:[V731_OBJECTS.find(row=>row.name==='setup_state')],setup:{schema_fingerprint:identity.fingerprint,next_index:0,state:'initializing',started_at:preserved.setup.started_at,completed_at:null}},objects:V731_OBJECTS,setup:preserved.setup,journal:preserved.journal}));
    const result = spawnSync('npm', ['run', 'deploy'], {
      cwd:fixture,
      encoding:'utf8',
      timeout:30000,
      maxBuffer:1024 * 1024,
      env:{
        ...process.env,
        MYTS_GUARD_SCENARIO:scenario,
        MYTS_GUARD_TRACE:trace,
        MYTS_GUARD_DEPLOY_SENTINEL:sentinel,
        MYTS_GUARD_DATABASE_FIXTURE:databaseFixture,
        // An explicit guard must fail closed independently of Node's
        // unhandled-rejection policy. The original missing await could warn,
        // exit successfully, and allow the shell's && to reach deploy.
        NODE_OPTIONS:scenario === 'empty'
          ? '--unhandled-rejections=strict'
          : '--unhandled-rejections=warn',
      },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    const traceText = await readFile(trace, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const calls = traceText.trim() ? traceText.trim().split('\n').map(JSON.parse) : [];
    const deployed = await readFile(sentinel, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    await check({result, output:result.stdout + result.stderr, calls, deployed});
  } finally {
    await rm(fixture, {recursive:true, force:true});
  }
}

test('actual npm deploy awaits the exact preserved731 physical schema and714 receipt before deploying', async () => {
  await runPipeline('known-old', ({result, output, calls, deployed}) => {
    assert.equal(result.status, 0, output);
    assert.match(output, /Remote rebuild database inspected: upgrade_required\. Deployment guard passed\./);
    assert.doesNotMatch(output, /inspected: undefined/);
    assert.equal(calls.length, 5);
    assert.equal(calls[0][0], 'd1');
    assert.deepEqual(calls[4], ['deploy', '--config', 'wrangler.jsonc']);
    assert.equal(deployed, 'deploy reached\n');
  });
});

for (const [label, amendConfig] of [
  ['missing', config => { delete config.limits; }],
  ['insufficient', config => { config.limits.cpu_ms = 10; }],
  ['unreviewed increase', config => { config.limits.cpu_ms = 300000; }],
]) {
  test(`actual npm deploy rejects ${label} owner CPU budget before any remote query or publishing`, async () => {
    await runPipeline('empty', ({result, output, calls, deployed}) => {
      assert.notEqual(result.status, 0, output);
      assert.match(output, /limits\.cpu_ms to 30000 explicitly/);
      assert.doesNotMatch(output, /Deployment guard passed/);
      assert.deepEqual(calls, []);
      assert.equal(deployed, null);
    }, amendConfig);
  });
}

for (const [scenario, message] of [
  ['empty', /production database is unexpectedly empty/],
  ['initializing-target', /production target must be fully ready/],
  ['query-failure', /Remote database inspection failed/],
  ['unreadable-json', /Remote inspection returned an unreadable response/],
  ['foreign-schema', /selected remote database belongs to another build/],
  ['empty-envelope', /Remote database inspection did not complete/],
  ['missing-success', /Remote database inspection did not complete/],
  ['missing-results', /Remote database inspection did not complete/],
]) {
  test(`actual npm deploy stops before deployment on ${scenario}, even with warning-only rejections`, async () => {
    await runPipeline(scenario, ({result, output, calls, deployed}) => {
      assert.notEqual(result.status, 0, output);
      assert.match(output, message);
      assert.doesNotMatch(output, /Deployment guard passed|inspected: undefined|UnhandledPromiseRejectionWarning/);
      assert.equal(calls.length, scenario==='initializing-target'?2:1);
      assert.equal(calls[0][0], 'd1');
      assert.equal(deployed, null);
    });
  });
}
