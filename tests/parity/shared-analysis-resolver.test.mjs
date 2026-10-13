import test from 'node:test';
import assert from 'node:assert/strict';
import * as intervals from '../../src/analysis/resolver/intervals.js';
import * as allocation from '../../src/analysis/resolver/allocation.js';
import * as lineup from '../../src/analysis/resolver/lineup.js';
import * as resolver from '../../src/analysis/resolver/resolve.js';
import { intervalCases } from './resolver-intervals-cases.js';
import { runAllocationCases } from './resolver-allocation-cases.js';
import { runLineupCases } from './resolver-lineup-cases.js';
import { runSharedResolverCases } from './shared-analysis-resolver-cases.js';

for (const c of intervalCases(intervals)) test(c.name,()=>c.run(assert));
test('allocation: 36 grouped cases including 2000 seeded invariants',()=>{
 assert.equal(runAllocationCases({...allocation,assert}).length,36);
});
test('lineup: 8 grouped precedence and identity cases',()=>{
 assert.equal(runLineupCases({api:lineup,assert}).length,8);
});
test('shared resolver: 47 grouped original and precedence cases, 200 seeded events',()=>{
 assert.equal(runSharedResolverCases({...resolver,assert}).length,47);
});
