// apps/etl/src/5-extract-specs/spec-schema.ts
import { z } from 'zod';

// --- Primitives ---
const PeriodSchema = z.enum([
    'day', 'week', 'month', 'year',
    'hospitalization', 'visit', 'session',
    'minute', 'hour', '30 minutes', '15 minutes',
]);

const ScopeSchema = z.enum(['patient', 'physician', 'facility']);

// --- Leaf nodes ---
const MaxCountSchema = z.object({
    op: z.literal('MAX_COUNT'),
    limit: z.number(),
    period: PeriodSchema.optional(),
    scope: ScopeSchema.optional(),
});

const MinDurationSchema = z.object({
    op: z.literal('MIN_DURATION'),
    value: z.number(),
    unit: z.enum(['minute', 'hour', 'day']),
});

const ContextSchema = z.object({
    op: z.literal('CONTEXT'),
    variable: z.string(),
    value: z.union([z.boolean(), z.string(), z.number(), z.array(z.string())]),
});

const InSetSchema = z.object({
    op: z.literal('IN_SET'),
    variable: z.string(),
    values: z.array(z.string()),
});

const RequiresCodeSchema = z.object({
    op: z.literal('REQUIRES_CODE'),
    code: z.string(),
});

const ExcludesCodeSchema = z.object({
    op: z.literal('EXCLUDES_CODE'),
    code: z.string(),
});

const AgeSchema = z.object({
    op: z.literal('AGE'),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.enum(['year', 'month', 'day']).default('year'),
});

const TimeWindowSchema = z.object({
    op: z.literal('TIME_WINDOW'),
    start: z.string().optional(),
    end: z.string().optional(),
});

const LeafSchema = z.discriminatedUnion('op', [
    MaxCountSchema,
    MinDurationSchema,
    ContextSchema,
    InSetSchema,
    RequiresCodeSchema,
    ExcludesCodeSchema,
    AgeSchema,
    TimeWindowSchema,
]);

// --- Composite (recursive) ---
export const LogicNodeSchema: z.ZodType<any> = z.lazy(() =>
    z.union([
        LeafSchema,
        z.object({
            op: z.enum(['AND', 'OR', 'NOT']),
            children: z.array(LogicNodeSchema),
        }),
    ])
);

// --- BillingSpec ---
export const RuleTypeSchema = z.enum([
    'constraint',
    'tariff',
    'administrative',
    'informational',
    'abrogated',
]);

export const BillingSpecSchema = z.object({
    articleId: z.string(),
    sectionId: z.string(),
    sectionName: z.string(),
    rawText: z.string(),
    ruleType: RuleTypeSchema,
    summary: z.string(),
    conditions: z.array(z.string()),
    referencedCodes: z.array(z.string()),
    crossRefs: z.array(z.string()),
    avis: z.array(z.string()),
    logic: LogicNodeSchema.nullable(),
    reasoning: z.string(),
});

export const BillingSpecArraySchema = z.array(BillingSpecSchema);

export type BillingSpec = z.infer<typeof BillingSpecSchema>;
export type LogicNode = z.infer<typeof LogicNodeSchema>;
export type RuleType = z.infer<typeof RuleTypeSchema>;

// --- Output envelope (what goes into specs.json) ---
export type SpecResult =
    | ({ status: 'success' } & BillingSpec)
    | { status: 'validation_error'; sectionId: string; sectionName: string; rawLLMResponse: string; zodError: z.ZodError }
    | { status: 'error'; sectionId: string; sectionName: string; errorMessage: string };
