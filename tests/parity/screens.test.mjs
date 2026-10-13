import test from "node:test";
import assert from "node:assert/strict";
import * as screens from "../../web/ui-original/screens.js";
import {runScreensCases} from "./screens-cases.js";
test("preserved screens render the actual returned data and original controls",()=>{
 assert.equal(runScreensCases({screens,assert}).length,5);
});
