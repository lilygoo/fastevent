import { z } from "zod";
import { BENCHMARKS, INSTRUMENTS, RETURN_LENSES } from "@/lib/types";

const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Use a real calendar date.");
const boundedLabel = z.string().trim().min(1).max(160);

export const milestoneSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: boundedLabel,
  date: isoDate,
  active: z.boolean(),
});

export const studyEventSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: boundedLabel,
  day0: isoDate,
  active: z.boolean(),
  milestones: z.array(milestoneSchema).max(20),
});

export const studyDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instrument: z.enum(INSTRUMENTS),
  benchmark: z.enum(BENCHMARKS),
  lens: z.enum(RETURN_LENSES),
  preDays: z.number().int().min(0).max(20),
  postDays: z.number().int().min(5).max(80),
  asOf: isoDate,
  priceMode: z.enum(["eod", "latest"]),
  currentEvent: studyEventSchema,
  historicalEvents: z.array(studyEventSchema).min(1).max(12),
  display: z.object({
    showMedian: z.boolean(),
    showBand: z.boolean(),
    showPre: z.boolean(),
    showMilestones: z.boolean(),
    view: z.enum(["overlay", "range"]),
  }),
}).superRefine((study, context) => {
  if (study.instrument === study.benchmark) {
    context.addIssue({ code: "custom", path: ["benchmark"], message: "Instrument and benchmark must be different." });
  }
  if (study.asOf < study.currentEvent.day0) {
    context.addIssue({ code: "custom", path: ["asOf"], message: "As-of date cannot precede the current Day 0." });
  }
  const validateMilestones = (event: z.infer<typeof studyEventSchema>, path: (string | number)[]) => {
    event.milestones.forEach((milestone, index) => {
      if (milestone.date < event.day0) {
        context.addIssue({
          code: "custom",
          path: [...path, "milestones", index, "date"],
          message: "Milestone date cannot precede its event Day 0.",
        });
      }
      if (milestone.date > study.asOf) {
        context.addIssue({
          code: "custom",
          path: [...path, "milestones", index, "date"],
          message: "Milestone date cannot follow the study as-of date.",
        });
      }
    });
  };
  validateMilestones(study.currentEvent, ["currentEvent"]);
  study.historicalEvents.forEach((event, index) => {
    if (event.day0 >= study.currentEvent.day0) {
      context.addIssue({
        code: "custom",
        path: ["historicalEvents", index, "day0"],
        message: "Historical Day 0 must precede the current Day 0.",
      });
    }
    validateMilestones(event, ["historicalEvents", index]);
  });
  const ids = [study.currentEvent.id, ...study.historicalEvents.map((event) => event.id)];
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["historicalEvents"], message: "Event IDs must be unique." });
  }
});

export const runRequestSchema = z.object({
  definition: studyDefinitionSchema,
  checkBeta: z.boolean().default(false),
  includeLatest: z.boolean().default(false),
  studyId: z.string().uuid().optional(),
  studyRevision: z.number().int().positive().optional(),
}).superRefine((request, context) => {
  if (Boolean(request.studyId) !== Boolean(request.studyRevision)) {
    context.addIssue({ code: "custom", path: ["studyId"], message: "Study ID and revision must be supplied together." });
  }
});

export const createStudySchema = z.object({ definition: studyDefinitionSchema });
export const updateStudySchema = z.object({
  definition: studyDefinitionSchema,
  revision: z.number().int().positive(),
});
export const deleteStudySchema = z.object({ revision: z.number().int().positive() });

export const quoteRequestSchema = z.object({
  symbols: z.array(z.enum(INSTRUMENTS)).min(1).max(2),
});
