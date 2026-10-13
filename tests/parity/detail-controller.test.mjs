import test from 'node:test';
import assert from 'node:assert/strict';
import {createDetailFeatures} from '../../web/app/detail-features.js';
import {runDetailCases} from './detail-controller-cases.js';
test('detail controller Coach access and asynchronous context fences',async t=>{
 await runDetailCases({createDetailFeatures,assert,onCase:(name,run)=>t.test(name,run)});
});
