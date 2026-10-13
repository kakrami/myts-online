import test from "node:test";
import assert from "node:assert/strict";
import { originalCoachCases } from "./original-coach-fixtures.mjs";

for (const { name, run } of originalCoachCases()) {
  test(name, async () => run(assert));
}
