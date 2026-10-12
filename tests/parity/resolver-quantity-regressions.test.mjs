import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMatchAnalysis} from '../../src/analysis/resolver/resolve.js';
import {allocateHalf} from '../../src/analysis/resolver/allocation.js';
import {quantityCases} from './resolver-quantity-regressions.js';
for(const c of quantityCases({resolveMatchAnalysis,allocateHalf}))test(c.name,()=>c.run(assert));
