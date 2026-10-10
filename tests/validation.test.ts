import assert from "node:assert/strict";
import test from "node:test";
import { initialStudy } from "../lib/default-study";
import { studyDefinitionSchema } from "../lib/validation";

test("study validation enforces symbol separation, bounds, and milestone ordering", () => {
  const samePair = structuredClone(initialStudy);
  samePair.benchmark = "SOXX";
  assert.equal(studyDefinitionSchema.safeParse(samePair).success, false);

  const tooLong = structuredClone(initialStudy);
  tooLong.postDays = 81;
  assert.equal(studyDefinitionSchema.safeParse(tooLong).success, false);

  const earlyMilestone = structuredClone(initialStudy);
  earlyMilestone.currentEvent.milestones[0].date = "2026-10-06";
  assert.equal(studyDefinitionSchema.safeParse(earlyMilestone).success, false);

  const futureMilestone = structuredClone(initialStudy);
  futureMilestone.currentEvent.milestones[0].date = "2026-10-10";
  assert.equal(studyDefinitionSchema.safeParse(futureMilestone).success, false);
});
