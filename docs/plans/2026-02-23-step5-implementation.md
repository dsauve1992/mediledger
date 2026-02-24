# Step 5 Redesign: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the existing `5-group-and-structure-document/` and `6-structurize-logic/` with a single `5-extract-specs/` step that extracts fully-formed, Zod-validated `BillingSpec` objects (with embedded logic AST) from the Step 4 output, plus a post-pass that canonicalizes CONTEXT variable names.

**Architecture:** One LLM call per RÈGLE section → array of `BillingSpec` per article → Zod validation → all results (success + errors) written to `specs.json`. A second script (`normalize-variables.ts`) deduplicates CONTEXT variable names across all specs via one LLM call, writing `variable-registry.json` and `specs-normalized.json`. The orchestrator (`cheerio-scraper.ts`) is updated to call the new step instead of the old two.

**Tech Stack:** TypeScript, `ts-node`, LangChain (`@langchain/openai`), Zod 4, `dotenv`, OpenAI (`gpt-4o`, temperature 0). No new packages needed — all already in `apps/etl/package.json`.

---

## Task 1: Create the Zod schema file

**Files:**
- Create: `apps/etl/src/5-extract-specs/spec-schema.ts`

This file defines all types. No LLM, no I/O — pure schema.

**Step 1: Create the file**

```typescript
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
```

**Step 2: Verify it compiles**

```bash
cd apps/etl && npx ts-node --transpile-only -e "import './src/5-extract-specs/spec-schema'"
```

Expected: no output (clean exit).

**Step 3: Commit**

```bash
git add apps/etl/src/5-extract-specs/spec-schema.ts
git commit -m "feat(etl): add BillingSpec Zod schema for step 5 redesign"
```

---

## Task 2: Write the system prompt

**Files:**
- Create: `apps/etl/src/5-extract-specs/prompt.ts`

This file exports a single `SYSTEM_PROMPT` string. No imports, no runtime logic.

**Step 1: Create the file**

```typescript
// apps/etl/src/5-extract-specs/prompt.ts

export const SYSTEM_PROMPT = `
You are an expert in RAMQ (Quebec medical billing) documentation and structured information extraction.

Your task: given a raw RAMQ section (JSON with fields: id, name, content[]), extract every billing article as a separate BillingSpec object. Return a JSON array of BillingSpec objects and nothing else — no markdown, no commentary, no trailing commas.

## What is an "article"?
A numbered sub-article of a RÈGLE (e.g., "5.1", "5.7") or any identifiable standalone rule block. If a section has no article numbers, treat the whole section as one spec with articleId "unknown".

## BillingSpec schema (TypeScript types):

type RuleType = 'constraint' | 'tariff' | 'administrative' | 'informational' | 'abrogated'

type BillingSpec = {
  articleId: string        // e.g. "5.7" — extract from text; use "unknown" if absent. NEVER invent.
  sectionId: string        // RAMQ anchor ID (provided in input as "id")
  sectionName: string      // Name of the section (provided in input as "name")
  rawText: string          // VERBATIM copy of the source paragraph(s). Do NOT paraphrase.
  ruleType: RuleType
  summary: string          // 1-sentence plain-language summary in the original language
  conditions: string[]     // Natural language billing conditions (NOT avis, NOT code numbers)
  referencedCodes: string[] // 5-digit billing codes mentioned (e.g. ["16111", "00035"])
  crossRefs: string[]      // References to other rules/annexes (e.g. ["Règle 21", "Annexe 8"])
  avis: string[]           // Exact text of AVIS notices (lines starting with "AVIS :")
  logic: LogicNode | null  // null unless ruleType === 'constraint'
  reasoning: string        // Brief explanation of logic derivation (or why logic is null)
}

## ruleType assignment rules:
- "constraint": imposes a limit, eligibility condition, or quantification (MAX, MIN, AGE, TIME, IN_SET, etc.)
- "tariff": defines an amount or maps billing codes to prices
- "administrative": process/form instructions (e.g. "Inscrire le numéro du professionnel référent")
- "informational": purely informational cross-references, general context, no actionable rule
- "abrogated": text contains "EST ABROGE" or equivalent explicit abrogation notice

## logic field rules:
- Set logic: null when ruleType is "tariff", "administrative", "informational", or "abrogated"
- Only populate logic when ruleType === "constraint"
- Use the LogicNode AST below

## LogicNode AST (discriminated union on "op"):

Composite nodes (contain children):
  { op: "AND", children: LogicNode[] }
  { op: "OR",  children: LogicNode[] }
  { op: "NOT", children: LogicNode[] }

Leaf nodes:
  { op: "MAX_COUNT", limit: number, period?: "day"|"week"|"month"|"year"|"hospitalization"|"visit"|"session"|"minute"|"hour"|"30 minutes"|"15 minutes", scope?: "patient"|"physician"|"facility" }
  { op: "MIN_DURATION", value: number, unit: "minute"|"hour"|"day" }
  { op: "CONTEXT", variable: string, value: boolean|string|number|string[] }
  { op: "IN_SET", variable: string, values: string[] }   // use when rule applies to "one of N" named values
  { op: "REQUIRES_CODE", code: string }
  { op: "EXCLUDES_CODE", code: string }
  { op: "AGE", min?: number, max?: number, unit?: "year"|"month"|"day" }
  { op: "TIME_WINDOW", start?: string, end?: string }    // HH:MM format

## LogicNode examples:

"Maximum de 2 visites par jour par patient entre 07:00 et 19:00":
{ "op": "AND", "children": [
  { "op": "MAX_COUNT", "limit": 2, "period": "day", "scope": "patient" },
  { "op": "TIME_WINDOW", "start": "07:00", "end": "19:00" }
]}

"Payable seulement si le patient est hospitalisé":
{ "op": "CONTEXT", "variable": "is_hospitalized", "value": true }

"Seul le médecin spécialiste en cardiologie, en endocrinologie, en gériatrie, en médecine interne":
{ "op": "IN_SET", "variable": "specialty", "values": ["cardiologie", "endocrinologie", "gériatrie", "médecine interne"] }

"La visite de départ n'est payable que si le patient est hospitalisé plus de 72 heures":
{ "op": "MIN_DURATION", "value": 72, "unit": "hour" }

## Critical rules:
1. rawText = verbatim copy of the source text for this article. Never paraphrase.
2. articleId = extracted from text (e.g. "5.7"). Use "unknown" if no number found. Never invent.
3. AVIS lines (starting with "AVIS :") → avis[] only. Not conditions[].
4. 5-digit billing codes → referencedCodes[]. Not embedded in conditions[].
5. "CE PARAGRAPHE EST ABROGE" or similar → ruleType: "abrogated", logic: null.
6. Empty arrays are fine ([]). Do not omit required fields.
7. Return ONLY a JSON array. No markdown fences, no explanation text.
`;
```

**Step 2: Verify it compiles**

```bash
cd apps/etl && npx ts-node --transpile-only -e "import './src/5-extract-specs/prompt'"
```

Expected: clean exit.

**Step 3: Commit**

```bash
git add apps/etl/src/5-extract-specs/prompt.ts
git commit -m "feat(etl): add system prompt for single-pass spec extraction"
```

---

## Task 3: Write the main extraction index

**Files:**
- Create: `apps/etl/src/5-extract-specs/index.ts`

**Step 1: Create the file**

```typescript
// apps/etl/src/5-extract-specs/index.ts
import * as fs from 'fs';
import * as path from 'path';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BillingSpecArraySchema, BillingSpec, SpecResult } from './spec-schema';
import { SYSTEM_PROMPT } from './prompt';

interface Section {
    id: string;
    parentId: string | null;
    name: string;
    content: (string | object)[];
}

const INPUT_PATH = path.resolve(process.cwd(), 'modified-content.json');
const OUTPUT_PATH = path.resolve(process.cwd(), 'specs.json');

function extractJson(raw: string): string {
    // Strip markdown fences if present
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    // Fall back to first [...] block
    const arr = raw.match(/\[[\s\S]*\]/);
    if (arr) return arr[0];
    throw new Error('No JSON array found in LLM response');
}

async function processSection(
    model: ChatOpenAI,
    section: Section
): Promise<SpecResult[]> {
    const sectionId = section.id ?? '';
    const sectionName = section.name ?? '';

    if (!section.content || section.content.length === 0) {
        return [];
    }

    let rawLLMResponse = '';
    try {
        const response = await model.invoke([
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(JSON.stringify(section)),
        ]);

        rawLLMResponse = response.content as string;
        const jsonStr = extractJson(rawLLMResponse);
        const parsed = JSON.parse(jsonStr);

        const validation = BillingSpecArraySchema.safeParse(parsed);
        if (!validation.success) {
            return [{
                status: 'validation_error',
                sectionId,
                sectionName,
                rawLLMResponse,
                zodError: validation.error,
            }];
        }

        return validation.data.map(spec => ({ status: 'success' as const, ...spec }));

    } catch (err: any) {
        return [{
            status: 'error',
            sectionId,
            sectionName,
            errorMessage: err?.message ?? String(err),
        }];
    }
}

export async function extractSpecs(): Promise<SpecResult[]> {
    if (!fs.existsSync(INPUT_PATH)) {
        throw new Error(`Input file not found: ${INPUT_PATH}`);
    }

    // Cache: skip if output already exists
    if (fs.existsSync(OUTPUT_PATH)) {
        console.log(`✅ specs.json already exists, loading from cache`);
        return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    }

    const sections: Section[] = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));

    const model = new ChatOpenAI({
        model: 'gpt-4o',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
    });

    const results: SpecResult[] = [];
    let successCount = 0;
    let validationErrorCount = 0;
    let errorCount = 0;

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        console.log(`[${i + 1}/${sections.length}] ${section.name}`);

        const sectionResults = await processSection(model, section);
        results.push(...sectionResults);

        for (const r of sectionResults) {
            if (r.status === 'success') successCount++;
            else if (r.status === 'validation_error') validationErrorCount++;
            else errorCount++;
        }

        // Rate limiting: 1s delay between calls
        if (i < sections.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

    console.log(`\n✅ Done: ${successCount} specs, ${validationErrorCount} validation errors, ${errorCount} errors`);
    console.log(`📄 Output: ${OUTPUT_PATH}`);

    return results;
}
```

**Step 2: Verify it compiles**

```bash
cd apps/etl && npx ts-node --transpile-only -e "import './src/5-extract-specs/index'"
```

Expected: clean exit (no runtime, just type-check).

**Step 3: Commit**

```bash
git add apps/etl/src/5-extract-specs/index.ts
git commit -m "feat(etl): add step 5 main extraction loop with Zod validation"
```

---

## Task 4: Write the variable normalization post-pass

**Files:**
- Create: `apps/etl/src/5-extract-specs/normalize-variables.ts`

**Step 1: Create the file**

```typescript
// apps/etl/src/5-extract-specs/normalize-variables.ts
import * as fs from 'fs';
import * as path from 'path';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { SpecResult, LogicNode } from './spec-schema';

const SPECS_PATH = path.resolve(process.cwd(), 'specs.json');
const REGISTRY_PATH = path.resolve(process.cwd(), 'variable-registry.json');
const NORMALIZED_PATH = path.resolve(process.cwd(), 'specs-normalized.json');

/** Recursively collect all variable names from CONTEXT and IN_SET nodes */
function collectVariables(node: LogicNode, acc: Set<string>): void {
    if (!node || typeof node !== 'object') return;
    if ('op' in node) {
        if ((node.op === 'CONTEXT' || node.op === 'IN_SET') && 'variable' in node) {
            acc.add((node as any).variable);
        }
        if ('children' in node && Array.isArray((node as any).children)) {
            for (const child of (node as any).children) {
                collectVariables(child, acc);
            }
        }
    }
}

/** Recursively rewrite variable names using the registry */
function applyRegistry(node: any, registry: Record<string, string>): any {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(n => applyRegistry(n, registry));
    const result: any = {};
    for (const [k, v] of Object.entries(node)) {
        if (k === 'variable' && typeof v === 'string') {
            result[k] = registry[v] ?? v;
        } else if (typeof v === 'object' && v !== null) {
            result[k] = applyRegistry(v, registry);
        } else {
            result[k] = v;
        }
    }
    return result;
}

async function buildRegistry(
    variables: string[],
    model: ChatOpenAI
): Promise<Record<string, string>> {
    const prompt = `You are a medical billing ontology expert.
Below is a list of variable names extracted from RAMQ billing rules by an LLM.
They represent the same concepts but may have different names (e.g., "is_hospitalized", "patient_hospitalized", "hospitalized").

Your task: group semantically equivalent variables and assign one canonical snake_case name per group.
Return ONLY a JSON object mapping each original name to its canonical name. No explanation, no markdown.

Variables:
${JSON.stringify(variables, null, 2)}

Output format:
{ "original_name": "canonical_name", ... }`;

    const response = await model.invoke([
        new SystemMessage('You are a medical billing ontology expert. Respond with JSON only.'),
        new HumanMessage(prompt),
    ]);

    const raw = response.content as string;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in normalization response');
    return JSON.parse(jsonMatch[0]);
}

export async function normalizeVariables(): Promise<void> {
    if (!fs.existsSync(SPECS_PATH)) {
        throw new Error(`specs.json not found — run extractSpecs first`);
    }

    if (fs.existsSync(NORMALIZED_PATH) && fs.existsSync(REGISTRY_PATH)) {
        console.log('✅ Normalized specs already exist, skipping');
        return;
    }

    const results: SpecResult[] = JSON.parse(fs.readFileSync(SPECS_PATH, 'utf-8'));

    // Collect all variable names from successful specs
    const variables = new Set<string>();
    for (const result of results) {
        if (result.status === 'success' && result.logic) {
            collectVariables(result.logic as LogicNode, variables);
        }
    }

    const variableList = Array.from(variables);
    console.log(`Found ${variableList.length} unique CONTEXT/IN_SET variables`);

    if (variableList.length === 0) {
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify({}, null, 2));
        fs.writeFileSync(NORMALIZED_PATH, JSON.stringify(results, null, 2));
        return;
    }

    const model = new ChatOpenAI({
        model: 'gpt-4o',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
    });

    const registry = await buildRegistry(variableList, model);
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
    console.log(`📄 variable-registry.json written`);

    // Apply registry to all specs
    const normalized = results.map(result => {
        if (result.status !== 'success' || !result.logic) return result;
        return { ...result, logic: applyRegistry(result.logic, registry) };
    });

    fs.writeFileSync(NORMALIZED_PATH, JSON.stringify(normalized, null, 2));
    console.log(`📄 specs-normalized.json written`);
}
```

**Step 2: Verify it compiles**

```bash
cd apps/etl && npx ts-node --transpile-only -e "import './src/5-extract-specs/normalize-variables'"
```

Expected: clean exit.

**Step 3: Commit**

```bash
git add apps/etl/src/5-extract-specs/normalize-variables.ts
git commit -m "feat(etl): add variable normalization post-pass for CONTEXT canonicalization"
```

---

## Task 5: Wire into the orchestrator

**Files:**
- Modify: `apps/etl/src/cheerio-scraper.ts`

The orchestrator currently calls Steps 1–4 then stops. Wire in the new step 5 after Step 4.

**Step 1: Read the current orchestrator** (already read above — lines 1–96)

**Step 2: Add the import at the top**

At line 8, after the existing imports, add:

```typescript
import { extractSpecs } from "./5-extract-specs";
import { normalizeVariables } from "./5-extract-specs/normalize-variables";
```

**Step 3: Add the step 5 call**

In `parseDocument()`, after the line `compareString(sectionWithContentText, sanitizedVersionText, true)` (line 71), the function currently ends. The `sanitizedVersion` is in scope.

Add after the `compareString` call on line 71:

```typescript
    // Write Step 4 output (moved from inline to explicit for step 5 to consume)
    const modifiedContentPath = path.resolve(__dirname, '..', 'modified-content.json');
    if (!fs.existsSync(modifiedContentPath)) {
        fs.writeFileSync(modifiedContentPath, JSON.stringify(sanitizedVersion, null, 2));
    }
```

Then in `main()`, after `parseDocument($)` on line 33, add:

```typescript
    await extractSpecs();
    await normalizeVariables();
```

Also add `import * as fs from 'fs'; import * as path from 'path';` at the top if not present.

**Step 4: Check if modified-content.json is already written by Step 4**

```bash
head -5 /apps/etl/modified-content.json 2>/dev/null || echo "check step 4 output path"
```

Look at `apps/etl/src/4-sanitize-html/index.ts` to confirm the output path:

```bash
cd apps/etl && grep -n 'writeFileSync\|outputFile\|modified-content' src/4-sanitize-html/index.ts
```

If Step 4 already writes `modified-content.json`, the explicit write in the orchestrator is not needed — skip it.

**Step 5: Verify the orchestrator compiles**

```bash
cd apps/etl && npx ts-node --transpile-only src/cheerio-scraper.ts
```

Expected: clean exit (no actual run, just type check).

**Step 6: Commit**

```bash
git add apps/etl/src/cheerio-scraper.ts
git commit -m "feat(etl): wire step 5 extract-specs into orchestrator"
```

---

## Task 6: Delete the old steps

**Files:**
- Delete: `apps/etl/src/5-group-and-structure-document/` (entire directory)
- Delete: `apps/etl/src/6-structurize-logic/` (entire directory)
- Delete old output files: `apps/etl/structured-content.json`, `apps/etl/structured-logic.json`

**Step 1: Verify nothing in the orchestrator imports from the old steps**

```bash
cd apps/etl && grep -rn '5-group-and-structure\|6-structurize' src/
```

Expected: no matches after the orchestrator has been updated in Task 5.

**Step 2: Delete the directories**

```bash
rm -rf apps/etl/src/5-group-and-structure-document apps/etl/src/6-structurize-logic
```

**Step 3: Remove old output files from git tracking (keep locally if desired)**

```bash
git rm --cached apps/etl/structured-content.json apps/etl/structured-logic.json 2>/dev/null || true
```

Add them to `.gitignore` alongside other output files:

```bash
echo "apps/etl/structured-content.json" >> .gitignore
echo "apps/etl/structured-logic.json" >> .gitignore
echo "apps/etl/specs.json" >> .gitignore
echo "apps/etl/specs-normalized.json" >> .gitignore
echo "apps/etl/variable-registry.json" >> .gitignore
```

**Step 4: Verify the project still compiles**

```bash
cd apps/etl && npx ts-node --transpile-only src/cheerio-scraper.ts
```

Expected: clean exit.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(etl): remove old steps 5 and 6, add output files to .gitignore"
```

---

## Task 7: Smoke-test with a single section

Before running the full pipeline (which costs money and time), test against one section.

**Step 1: Create a minimal test input**

```bash
cd apps/etl && node -e "
const data = JSON.parse(require('fs').readFileSync('modified-content.json', 'utf-8'));
// Find REGLE 5 — it's a complex section with many subarticles
const regle5 = data.find(s => s.name && s.name.includes('REGLE 5'));
require('fs').writeFileSync('/tmp/test-section.json', JSON.stringify([regle5], null, 2));
console.log('Written test section:', regle5?.name);
"
```

**Step 2: Create a one-off test runner**

```bash
cat > /tmp/test-extract.ts << 'EOF'
import * as dotenv from 'dotenv';
dotenv.config({ path: './apps/etl/.env' });
import * as fs from 'fs';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BillingSpecArraySchema } from './apps/etl/src/5-extract-specs/spec-schema';
import { SYSTEM_PROMPT } from './apps/etl/src/5-extract-specs/prompt';

async function main() {
    const section = JSON.parse(fs.readFileSync('/tmp/test-section.json', 'utf-8'))[0];
    const model = new ChatOpenAI({ model: 'gpt-4o', temperature: 0, apiKey: process.env.OPENAI_API_KEY });

    console.log('Sending section:', section.name);
    const response = await model.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(JSON.stringify(section)),
    ]);

    const raw = response.content as string;
    const arr = raw.match(/\[[\s\S]*\]/);
    if (!arr) { console.error('No JSON array'); process.exit(1); }

    const parsed = JSON.parse(arr[0]);
    const result = BillingSpecArraySchema.safeParse(parsed);

    if (result.success) {
        console.log(`✅ Validated ${result.data.length} specs`);
        console.log(JSON.stringify(result.data.slice(0, 2), null, 2));
    } else {
        console.error('❌ Validation failed:', JSON.stringify(result.error.issues.slice(0, 3), null, 2));
        console.log('Raw LLM output (first 500 chars):', raw.slice(0, 500));
    }
}
main().catch(console.error);
EOF
npx ts-node /tmp/test-extract.ts
```

**What to look for:**
- `✅ Validated N specs` where N matches the number of sub-articles in RÈGLE 5 (~8)
- Spot check: does `articleId` look like "5.1", "5.7" etc.?
- Does `rawText` contain verbatim source text?
- Does `logic` appear for constraint-type articles?
- If validation fails: read the Zod error. Likely the prompt needs an example added for the failing case.

**Step 3: If validation passes, commit nothing (test file was temporary)**

If validation fails, fix the prompt in `prompt.ts` and repeat. Commit the prompt fix:

```bash
git add apps/etl/src/5-extract-specs/prompt.ts
git commit -m "fix(etl): refine prompt based on smoke test validation errors"
```

---

## Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Update the ETL pipeline table to reflect the new step structure. Replace the old Step 5 and Step 6 rows:

| Step | Directory | Output File | Description |
|------|-----------|-------------|-------------|
| 5 | `5-extract-specs/` | `specs.json` | LLM: section → array of BillingSpec (with embedded AST). Post-pass writes `specs-normalized.json` + `variable-registry.json` |

Remove the Step 6 row entirely.

Also update the "Current Status" section to reflect that Step 6 is removed and Step 5 is being rebuilt.

**Commit:**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect step 5 redesign (removed step 6)"
```

---

## Execution Notes

- Run Tasks 1–4 first (no API calls, pure code)
- Task 5 (orchestrator wiring) requires reading the actual Step 4 output path to avoid double-writing
- Task 6 (delete old steps) — verify no imports remain before deleting
- Task 7 (smoke test) requires `OPENAI_API_KEY` in `apps/etl/.env` and will make one real API call
- Full pipeline run (`npm run etl`) is expensive (~100+ LLM calls) — only run after smoke test passes
