import assert from "node:assert/strict";
import test from "node:test";
import { todayEastern } from "../lib/dates";
import { initialStudy } from "../lib/default-study";
import { studyDefinitionSchema } from "../lib/validation";

test("the initial ARR study contains the approved events and milestones", () => {
  assert.equal(studyDefinitionSchema.parse(initialStudy).name, "Two ARR debates: SOXX vs QQQ");
  assert.equal(initialStudy.instrument, "SOXX");
  assert.equal(initialStudy.benchmark, "QQQ");
  assert.equal(initialStudy.asOf, todayEastern());
  assert.equal(initialStudy.currentEvent.day0, "2026-10-07");
  assert.equal(initialStudy.currentEvent.milestones[0].date, "2026-10-08");
  assert.equal(initialStudy.historicalEvents[0].day0, "2026-08-17");
  assert.deepEqual(initialStudy.historicalEvents[0].milestones.map((item) => item.date), [
    "2026-08-17", "2026-08-18", "2026-08-27", "2026-09-03",
  ]);
  assert.equal(JSON.stringify(initialStudy).includes("2.03"), false);
});

test("Eastern date remains on the prior calendar day before midnight ET", () => {
  assert.equal(todayEastern(new Date("2026-10-10T02:00:00Z")), "2026-10-09");
});
