# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (monorepo root)
npm install

# Run the full ETL pipeline
npm run etl

# Run ETL from the app directory directly
cd apps/etl && npm run start:cheerio

# Build TypeScript
cd apps/etl && npm run build

# Dev mode with watch (legacy scraper)
cd apps/etl && npm run dev
```

**Environment:** Requires a `.env` file in `apps/etl/` with `OPENAI_API_KEY` set before running LLM steps (5+).

No test runner is configured — `npm test` exits with an error by design.

## Architecture

MediLedger is a monorepo that converts RAMQ (Quebec medical billing) HTML documentation into machine-readable billing logic (JSON ASTs), ultimately targeting auto-generated TypeScript billing validation code.

### Monorepo Layout

```
apps/etl/        # The active ETL pipeline (current focus)
packages/        # Reserved for future shared packages (e.g., @mediledger/core)
```

### ETL Pipeline (`apps/etl/src/`)

The pipeline is sequential — each step's JSON output feeds the next. Steps are organized as numbered directories:

| Step | Directory | Output File | Description |
|------|-----------|-------------|-------------|
| 1 | `1-extract-structure-from-menu/` | `menu.json` | Parse RAMQ HTML table of contents |
| 2 | `2-equalize-section-headers/` | — | Normalize heading levels |
| 3 | `3-group-content-by-section/` | `sectionsWithContent.json` | Group HTML by section |
| 4 | `4-sanitize-html/` | `modified-content.json` | Strip formatting, normalize whitespace |
| 5 | `5-group-and-structure-document/` | `structured-content.json` | LLM converts HTML → structured rule objects |
| 6 | `6-structurize-logic/` | `structured-logic.json` | LLM converts rules → JSON logic trees (AST) |

**Entry point:** `cheerio-scraper.ts` orchestrates all steps sequentially.

**Phase 1 (Steps 1–4):** Deterministic, no external APIs, fast (~5s total).
**Phase 2 (Steps 5–6):** LLM-powered, slow (~20 min for Step 6 alone due to ~3,000 OpenAI API calls).

### Logic Schema (AST)

The core data structure is a discriminated union AST in `6-structurize-logic/logic-schema.ts`:

```typescript
type LogicNode =
  | { op: 'AND' | 'OR' | 'NOT', children: LogicNode[] }       // Composite
  | { op: 'MAX_COUNT', limit: number, period: string, scope: string }
  | { op: 'MIN_DURATION', value: number, unit: string }
  | { op: 'CONTEXT', variable: string, value: any }
  | { op: 'REQUIRES_CODE' | 'EXCLUDES_CODE', code: string }
  | { op: 'AGE', min?: number, max?: number, unit: string }
  | { op: 'TIME_WINDOW', start?: string, end?: string }
```

Each output rule includes `ruleId`, nullable `logic` (null for informational rules), and `reasoning`.

### LLM Integration Pattern

Steps 5 and 6 use LangChain + OpenAI with temperature 0 for deterministic extraction. Zod schemas validate every LLM response. Validation failures are recorded as `{ status: "validation_error", rawLogic: ... }` rather than crashing — preserving all output for debugging.

### Key Design Principles

- **Traceable:** Every rule links back to its RAMQ source document, section, and URL
- **Human-in-the-loop:** LLM extracts, Zod validates schema, then human experts approve before production
- **Versioned:** All rule changes tracked for rollback
- **Explainable:** Each billing decision must reference the rule that caused it

## Current Status

Phase 1 (Foundation) is complete. Active work is on Step 6 (improving validation rate, targeting 95%+). Future steps (7–10) include deduplication, conflict detection, tariff extraction, and TypeScript code generation.
