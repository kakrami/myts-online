import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {requiredFiles, stageRelease} from '../scripts/release-check.mjs';

const fakeWrangler = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MYTS_GUARD_TRACE, JSON.stringify(args) + '\\n');
if (args[0] === 'd1' && args[1] === 'execute' && args[2] === 'DB'
    && args.includes('--remote') && args.includes('--json')) {
  switch (process.env.MYTS_GUARD_SCENARIO) {
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
      process.stdout.write(JSON.stringify([{success:true, results:[{name:'installation'}]}]));
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

async function runPipeline(scenario, check) {
  const fixture = await mkdtemp(path.join(tmpdir(), 'myts-deployment-guard-'));
  try {
    // Copy the actual release and its actual npm deploy script. Only the
    // isolated Wrangler CLI is substituted; there is no cloud authentication
    // or network access, and no application/runtime module is modified.
    await stageRelease(fixture, await requiredFiles());
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
    const calls = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
    const deployed = await readFile(sentinel, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    await check({result, output:result.stdout + result.stderr, calls, deployed});
  } finally {
    await rm(fixture, {recursive:true, force:true});
  }
}

test('actual npm deploy awaits an empty remote database inspection before deploying', async () => {
  await runPipeline('empty', ({result, output, calls, deployed}) => {
    assert.equal(result.status, 0, output);
    assert.match(output, /Remote rebuild database inspected: empty\. Deployment guard passed\./);
    assert.doesNotMatch(output, /inspected: undefined/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], 'd1');
    assert.deepEqual(calls[1], ['deploy', '--config', 'wrangler.jsonc']);
    assert.equal(deployed, 'deploy reached\n');
  });
});

for (const [scenario, message] of [
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
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 'd1');
      assert.equal(deployed, null);
    });
  });
}
