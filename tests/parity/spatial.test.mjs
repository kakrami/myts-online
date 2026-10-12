import test from "node:test";
import assert from "node:assert/strict";
import {eventMapSVG,heatmapSVG} from "../../web/ui-original/spatial.js";
import {spatialCases} from "./spatial-cases.js";
for(const fixture of spatialCases)test(fixture.name,()=>fixture.run({eventMapSVG,heatmapSVG},assert));
