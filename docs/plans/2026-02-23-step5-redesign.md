# Step 5 Redesign: Single-Pass Billing Spec Extraction

**Date:** 2026-02-23
**Status:** Approved
**Replaces:** Steps 5 (`5-group-and-structure-document/`) and 6 (`6-structurize-logic/`)

---

## Problem

The existing Steps 5 and 6 had critical gaps for a system whose goal is auditable, versionable billing rule specifications:

- **Step 5:** No Zod validation — LLM output was trusted wholesale. Hallucinated codes and malformed structures passed through silently. Silent failures returned empty `rules: []` with no error log.
- **Step 6:** Zod schema couldn't represent array CONTEXT values (e.g., list of specialties), causing 2.4% validation failures. `CONTEXT` variable names were free-form strings invented per-call by the LLM — semantically unstable across runs. Source text was not preserved alongside extracted rules, making auditing impossible.
- **Both:** No traceability from spec back to source paragraph.

---

## Design

### Pipeline

```
modified-content.json  (Step 4 output)
  → [Step 5: extract-specs]
  → specs.json
  → [Post-pass: normalize-variables]
  → specs-normalized.json + variable-registry.json
```

Steps 5 and 6 are **collapsed into a single step**: `5-extract-specs/`. The old `6-structurize-logic/` directory is removed.

The normalization pass is a lightweight second script (`normalize-variables.ts`) within the same step directory.

### Granularity

One `BillingSpec` per RAMQ article (e.g. "5.7"). One LLM call per RÈGLE section, producing an array of specs for all articles in that section.

### BillingSpec Schema

```typescript
type RuleType =
  | 'constraint'      // Imposes a limit, condition, or eligibility requirement
  | 'tariff'          // Defines an amount or code-based pricing
  | 'administrative'  // Process/form instructions with no billing logic
  | 'informational'   // Cross-references, general context, no actionable rule
  | 'abrogated'       // Rule has been explicitly cancelled/removed

type BillingSpec = {
  // Identity & traceability
  articleId: string      // e.g. "5.7" — from source text or "unknown"
  sectionId: string      // RAMQ anchor ID (e.g. "126667")
  sectionName: string    // e.g. "REGLE 5.VISITES"
  rawText: string        // Verbatim copy of the source paragraph(s)

  // Classification
  ruleType: RuleType

  // Structured content
  summary: string        // 1-sentence plain-language summary
  conditions: string[]   // Natural language conditions
  referencedCodes: string[]  // 5-digit RAMQ billing codes mentioned
  crossRefs: string[]    // References to other rules/annexes
  avis: string[]         // AVIS administrative notices

  // Logic AST — null when ruleType is not 'constraint'
  logic: LogicNode | null
  reasoning: string      // LLM's explanation of logic derivation
}
```

### LogicNode AST

Same discriminated union as the former Step 6, with two additions:

1. `CONTEXT.value` accepts `string | boolean | number | string[]` (was scalar only)
2. New `IN_SET` operator:
   ```typescript
   { op: 'IN_SET', variable: string, values: string[] }
   ```
   Used when a rule applies to "one of N" values (e.g. list of specialties).

Full union:
```typescript
type LogicNode =
  | { op: 'AND' | 'OR' | 'NOT', children: LogicNode[] }
  | { op: 'MAX_COUNT', limit: number, period: Period, scope?: Scope }
  | { op: 'MIN_DURATION', value: number, unit: 'minute' | 'hour' | 'day' }
  | { op: 'CONTEXT', variable: string, value: string | boolean | number | string[] }
  | { op: 'IN_SET', variable: string, values: string[] }
  | { op: 'REQUIRES_CODE' | 'EXCLUDES_CODE', code: string }
  | { op: 'AGE', min?: number, max?: number, unit: 'year' | 'month' | 'day' }
  | { op: 'TIME_WINDOW', start?: string, end?: string }
```

### LLM Prompt Strategy

- **Model:** `gpt-4o` (or latest available), temperature 0
- **System prompt:** Explains task, full schema with TypeScript types, one concrete example per `ruleType` and per `LogicNode` operator
- **Human message:** Full section JSON `{ id, name, content[] }` from Step 4

**Critical rules baked into prompt:**
- `articleId` extracted from text (e.g. "5.7") or `"unknown"` — never invented
- `rawText` is verbatim source text — no paraphrasing
- `ruleType: "abrogated"` when text contains "EST ABROGE" or equivalent
- `logic: null` for all non-constraint rule types
- AVIS lines → `avis[]`, not `conditions[]`
- 5-digit billing codes → `referencedCodes[]`, not embedded in conditions

### Validation

Zod schema (`BillingSpecSchema`) validates every field of every spec in the returned array. Uses `safeParse()` — never throws.

Output entries:
```typescript
// Success
{ status: 'success', ...BillingSpec }

// Validation failure (schema violated)
{ status: 'validation_error', sectionId, sectionName, rawLLMResponse, zodError }

// Hard error (network, parse failure)
{ status: 'error', sectionId, sectionName, errorMessage }
```

All three statuses are written to `specs.json` — no silent failures, no data loss.

### Variable Normalization Pass

After all sections are processed, `normalize-variables.ts`:

1. Reads `specs.json`
2. Collects all unique `variable` strings from `CONTEXT` and `IN_SET` nodes across all specs
3. Uses one LLM call with a deduplication prompt to group semantically equivalent variable names and assign a canonical name per group
4. Writes `variable-registry.json`: `{ [original: string]: canonical: string }`
5. Rewrites all specs with canonical variable names → `specs-normalized.json`

This makes the AST semantically stable across pipeline runs.

---

## File Structure

```
apps/etl/src/
  5-extract-specs/
    index.ts              # Main extraction loop
    prompt.ts             # System prompt string
    spec-schema.ts        # Zod schemas: BillingSpecSchema, LogicNodeSchema
    normalize-variables.ts # Post-pass variable canonicalization
```

Old directories to remove:
- `5-group-and-structure-document/`
- `6-structurize-logic/`

Output files:
- `apps/etl/specs.json`
- `apps/etl/specs-normalized.json`
- `apps/etl/variable-registry.json`

---

## What This Fixes

| Problem | Fix |
|---------|-----|
| No validation in Step 5 | Full Zod validation on every spec |
| Silent failures | All errors preserved with status field |
| Array CONTEXT values broke schema | `CONTEXT.value` extended + `IN_SET` operator added |
| Free-form variable names (semantic instability) | Normalization pass with LLM deduplication |
| No source traceability | `rawText` + `sectionId` on every spec |
| Two-pass cost (5 + 6) | Collapsed to one LLM call per section |
| No rule type classification | `ruleType` field on every spec |
