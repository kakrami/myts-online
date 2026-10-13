import {freshHarness} from './fresh-harness.js';

/** Fresh native D1 fixture. Module tests install their required fresh tables. */
export async function harness(options={}) {
  if(options.setup!==false)throw new Error('Use freshHarness.initialize for complete application workflows.');
  return freshHarness();
}
