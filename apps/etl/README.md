# MediLedger ETL Pipeline

**Transform RAMQ Documentation into Structured Billing Logic**

This application is the heart of MediLedger: a **multi-stage ETL pipeline** that extracts medical billing rules from Quebec's RAMQ documentation and transforms them into machine-readable, deterministic logic trees.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Pipeline Architecture](#pipeline-architecture)
- [Step-by-Step Guide](#step-by-step-guide)
- [Output Files](#output-files)
- [Configuration](#configuration)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

---

## Overview

### What Does This ETL Do?

This pipeline converts **unstructured RAMQ documentation** (HTML/PDF) into **structured billing rules** (JSON logic trees) that can be used to:

1. ✅ Validate medical acts before billing
2. 💰 Pre-calculate billable amounts
3. ⚠️ Detect billing conflicts and errors
4. 📊 Generate compliance reports
5. 🤖 Auto-generate billing code (future)

### Technology Stack

- **Language:** TypeScript
- **Runtime:** Node.js (v18+)
- **Web Scraping:** Cheerio
- **AI/LLM:** LangChain + OpenAI (ChatGPT)
- **Validation:** Zod
- **Build:** TypeScript Compiler (tsc)

---

## Quick Start

### Prerequisites

```bash
# Ensure you have Node.js installed
node --version  # Should be v18 or higher

# Install dependencies from the root of the monorepo
cd /path/to/MediLedger
npm install
```

### Environment Setup

```bash
cd apps/etl

# Create .env file
cat > .env << EOF
OPENAI_API_KEY=sk-your-api-key-here
EOF
```

### Run the Pipeline

```bash
# From the monorepo root
npm run etl

# Or from apps/etl
npm run start:cheerio
```

---

## Pipeline Architecture

### Sequential Processing

The ETL pipeline is a **directed acyclic graph (DAG)** of transformations:

```
┌─────────────────────────────────────────────────────────────────┐
│  INPUT: RAMQ HTML Documentation                                │
│  manuel-specialistes-remuneration-acte.html                     │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Extract Structure from Menu                           │
│  Output: menu.json                                              │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Equalize Section Headers                              │
│  Output: Normalized HTML with consistent headers               │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Group Content by Section                              │
│  Output: sectionsWithContent.json                               │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: Sanitize HTML                                          │
│  Output: modified-content.json                                  │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: Group and Structure Document           🤖 LLM START   │
│  Output: structured-content.json                                │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6: Structurize Logic                      🤖 LLM         │
│  Output: structured-logic.json                                  │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  FUTURE STEPS: Code Generation, Validation, etc.                │
└─────────────────────────────────────────────────────────────────┘
```

### Processing Phases

| Phase | Steps | Type | Description |
|-------|-------|------|-------------|
| **Extraction** | 1-4 | Traditional | Parse, normalize, clean HTML |
| **Transformation** | 5-6 | AI-Powered | Convert to structured rules with LLM |
| **Generation** | 7+ | Future | Generate TypeScript code |

---

## Step-by-Step Guide

### Step 1: Extract Structure from Menu

**Purpose:** Parse the document's table of contents to understand structure

**Input:** `manuel-specialistes-remuneration-acte.html`  
**Output:** `menu.json`

**What it does:**
- Identifies all sections (Règle 1, Règle 2, etc.)
- Extracts the hierarchical structure
- Maps section IDs to titles

**Code:**
```typescript
// Location: src/1-extract-structure-from-menu/menu-items.ts
// Exports: menuItems array
```

**Example output:**
```json
[
  {
    "id": "regle-1",
    "title": "Règle 1 - Conditions générales",
    "level": 1,
    "children": [...]
  }
]
```

---

### Step 2: Equalize Section Headers

**Purpose:** Normalize header levels for consistent parsing

**Input:** Raw HTML with inconsistent headers  
**Output:** HTML with standardized `<h1>`, `<h2>`, `<h3>` structure

**What it does:**
- Converts all header variants to standard HTML headers
- Ensures consistent heading hierarchy
- Fixes broken or malformed headers

**Common issues fixed:**
- `<p class="heading">` → `<h2>`
- Multiple `<h1>` tags → Single `<h1>` with proper `<h2>` children
- Inconsistent spacing and formatting

---

### Step 3: Group Content by Section

**Purpose:** Associate content blocks with their parent sections

**Input:** Normalized HTML  
**Output:** `sectionsWithContent.json`

**What it does:**
- Traverses the DOM tree
- Groups all content between headers
- Creates section objects with associated content

**Example output:**
```json
[
  {
    "sectionId": "regle-5-7",
    "title": "5.7 - Contrôles à l'hôpital",
    "content": "<p>Maximum de 2 visites par jour...</p>"
  }
]
```

---

### Step 4: Sanitize HTML

**Purpose:** Clean and normalize HTML for easier processing

**Input:** Grouped content with raw HTML  
**Output:** `modified-content.json` with clean HTML

**What it does:**
- Removes unnecessary attributes (`style`, `class`, etc.)
- Normalizes whitespace
- Converts special characters to UTF-8
- Removes empty tags
- Fixes malformed HTML

**Utilities used:**
- `normalize-whitespace.ts` - Whitespace normalization
- `cheerio.utils.ts` - HTML manipulation helpers

---

### Step 5: Group and Structure Document

**Purpose:** Convert cleaned HTML into semantic rule objects

**Input:** `modified-content.json`  
**Output:** `structured-content.json`

**What it does:**
- Parses each section into a rule object
- Extracts fields:
  - `ruleId` - Unique identifier (e.g., "5.7")
  - `title` - Rule title
  - `conditions` - Text describing when the rule applies
  - `amounts` - Billing amounts (if present)
  - `subrules` - Nested sub-rules
  - `notes` - Additional notes or "avis"
  - `exceptions` - Exceptions to the rule

**Example output:**
```json
{
  "ruleId": "5.7",
  "title": "Contrôles à l'hôpital",
  "conditions": "Maximum de 2 visites de contrôle par patient par jour d'hospitalisation entre 07:00 et 19:00.",
  "subrules": [
    {
      "ruleId": "5.7.1",
      "conditions": "Cette limitation ne s'applique pas en pédiatrie, biochimie médicale..."
    }
  ]
}
```

---

### Step 6: Structurize Logic 🤖

**Purpose:** Convert natural language rules into deterministic logic trees using AI

**Input:** `structured-content.json`  
**Output:** `structured-logic.json`

**Technology:** 
- LangChain for LLM orchestration
- OpenAI GPT-4 for logic extraction
- Zod for output validation

#### How It Works

1. **Chunking:** Process rules in batches (to manage API costs)
2. **Prompting:** Send each rule to LLM with system prompt
3. **Parsing:** LLM returns JSON logic tree
4. **Validation:** Zod schema validates the structure
5. **Error Handling:** Invalid rules are marked with validation errors

#### System Prompt

See [`prompt.ts`](src/6-structurize-logic/prompt.ts) for the complete prompt.

**Key instructions to LLM:**
- Extract computable conditions only (ignore administrative text)
- Use predefined operators (`AND`, `OR`, `MAX_COUNT`, etc.)
- Return `null` if no logic found
- Provide reasoning for each extraction

#### Logic Schema

See [`logic-schema.ts`](src/6-structurize-logic/logic-schema.ts) for the complete Zod schema.

**Supported operators:**

| Operator | Schema | Use Case |
|----------|--------|----------|
| `AND` | `{ op: 'AND', children: [...] }` | All conditions must be true |
| `OR` | `{ op: 'OR', children: [...] }` | Any condition must be true |
| `NOT` | `{ op: 'NOT', children: [...] }` | Inverts child condition |
| `MAX_COUNT` | `{ op: 'MAX_COUNT', limit: 2, period: 'day', scope: 'patient' }` | Frequency limits |
| `MIN_DURATION` | `{ op: 'MIN_DURATION', value: 30, unit: 'minute' }` | Duration requirements |
| `CONTEXT` | `{ op: 'CONTEXT', variable: 'is_hospitalized', value: true }` | Contextual conditions |
| `REQUIRES_CODE` | `{ op: 'REQUIRES_CODE', code: '09403' }` | Billing code dependencies |
| `EXCLUDES_CODE` | `{ op: 'EXCLUDES_CODE', code: 'psychotherapie' }` | Billing code exclusions |
| `AGE` | `{ op: 'AGE', min: 0, max: 18, unit: 'year' }` | Age restrictions |
| `TIME_WINDOW` | `{ op: 'TIME_WINDOW', start: '07:00', end: '19:00' }` | Time-based constraints |

#### Example Transformation

**Input (Natural Language):**
```json
{
  "ruleId": "5.7",
  "conditions": "Maximum de 2 visites de contrôle par patient par jour d'hospitalisation entre 07:00 et 19:00, sauf en pédiatrie, médecine interne, biochimie médicale, génétique, obstétrique-gynécologie, aux soins intensifs et en néonatologie."
}
```

**Output (Logic Tree):**
```json
{
  "status": "success",
  "ruleId": "5.7",
  "logic": {
    "op": "AND",
    "children": [
      {
        "op": "MAX_COUNT",
        "limit": 2,
        "period": "day",
        "scope": "patient"
      },
      {
        "op": "TIME_WINDOW",
        "start": "07:00",
        "end": "19:00"
      },
      {
        "op": "CONTEXT",
        "variable": "is_hospitalized",
        "value": true
      },
      {
        "op": "NOT",
        "children": [
          {
            "op": "OR",
            "children": [
              { "op": "CONTEXT", "variable": "specialty", "value": "pediatrics" },
              { "op": "CONTEXT", "variable": "specialty", "value": "internal_medicine" },
              { "op": "CONTEXT", "variable": "is_icu", "value": true }
            ]
          }
        ]
      }
    ]
  },
  "reasoning": "The rule limits visits to 2 per day per hospitalized patient between 07:00 and 19:00, with exceptions for specific specialties."
}
```

#### Validation and Error Handling

When the LLM output doesn't match the schema:

```json
{
  "status": "validation_error",
  "ruleId": "5.2",
  "rawLogic": { ... },  // What the LLM returned
  "error": {
    "name": "ZodError",
    "message": "..."    // Detailed validation error
  }
}
```

**Types of validation errors:**
- Invalid operator name
- Missing required fields (`children`, `limit`, etc.)
- Wrong value type (e.g., array instead of boolean)
- Invalid discriminated union structure

#### Running Step 6

```bash
cd apps/etl
npm run start:cheerio  # Runs the entire pipeline including Step 6

# Or run Step 6 in isolation (if you modify the index.ts)
ts-node src/6-structurize-logic/index.ts
```

---

## Output Files

### Intermediate Files

| File | Size | Lines | Description |
|------|------|-------|-------------|
| `menu.json` | ~58 KB | ~1,500 | Document structure |
| `sectionsWithContent.json` | ~5.6 MB | ~140,000 | Content grouped by section |
| `modified-content.json` | ~1.8 MB | ~45,000 | Cleaned HTML content |
| `structured-content.json` | ~2.1 MB | ~53,000 | Structured rule objects |

### Final Output

**`structured-logic.json`** (1.2 MB, 33,000 lines)

This is the **primary output** of the pipeline. It contains:

```json
[
  {
    "status": "success",           // or "validation_error"
    "ruleId": "5.7",
    "logic": { ... },               // JSON logic tree (or null)
    "reasoning": "..."              // LLM's explanation
  },
  // ... ~3,000 more rules
]
```

**Statistics (as of latest run):**
- **Total rules processed:** ~3,000
- **Rules with logic:** ~1,800
- **Rules without logic:** ~1,000 (informational/administrative)
- **Validation errors:** ~200 (being fixed)

---

## Configuration

### Environment Variables

Create a `.env` file in `apps/etl/`:

```bash
# Required
OPENAI_API_KEY=sk-your-api-key-here

# Optional (defaults shown)
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_TEMPERATURE=0.1
CHUNK_SIZE=10
```

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required) | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4-turbo-preview` | Model to use for logic extraction |
| `OPENAI_TEMPERATURE` | `0.1` | Lower = more deterministic |
| `CHUNK_SIZE` | `10` | Number of rules to process per batch |

---

## Development

### Project Structure

```
apps/etl/
├── src/
│   ├── 1-extract-structure-from-menu/
│   │   └── menu-items.ts                 # Document menu structure
│   ├── 2-equalize-section-headers/
│   │   └── (implementation files)
│   ├── 3-group-content-by-section/
│   │   └── (implementation files)
│   ├── 4-sanitize-html/
│   │   └── (implementation files)
│   ├── 5-group-and-structure-document/
│   │   └── (implementation files)
│   ├── 6-structurize-logic/
│   │   ├── index.ts                      # Main logic extraction
│   │   ├── logic-schema.ts               # Zod schema (AST)
│   │   └── prompt.ts                     # LLM system prompts
│   ├── cheerio-scraper.ts                # Web scraper
│   ├── cheerio.utils.ts                  # Cheerio helpers
│   ├── normalize-whitespace.ts           # Text normalization
│   ├── validation.ts                     # Validation utilities
│   └── test-cases.ts                     # Test examples
├── menu.json
├── sectionsWithContent.json
├── modified-content.json
├── structured-content.json
├── structured-logic.json                 # ← Final output
├── package.json
└── tsconfig.json
```

### Adding a New ETL Step

To add **Step 7** (for example):

1. **Create directory:**
   ```bash
   mkdir src/7-your-new-step
   ```

2. **Create `index.ts`:**
   ```typescript
   import previousStepOutput from '../../structured-logic.json';
   
   export async function step7() {
     // Your transformation logic
     const result = previousStepOutput.map(rule => {
       // Transform each rule
       return transformedRule;
     });
     
     return result;
   }
   ```

3. **Update main entry point** (if needed)

4. **Write output:**
   ```typescript
   import fs from 'fs';
   
   fs.writeFileSync('output-step-7.json', JSON.stringify(result, null, 2));
   ```

### Testing

```bash
# Run TypeScript compiler to check for errors
npm run build

# Test individual steps
ts-node src/6-structurize-logic/index.ts

# Validate output format
ts-node src/validation.ts
```

### Debugging

**Enable verbose logging:**
```typescript
// In index.ts
console.log('Processing rule:', rule.ruleId);
console.log('LLM output:', JSON.stringify(llmOutput, null, 2));
```

**Check validation errors:**
```bash
# Count validation errors
cat structured-logic.json | jq '[.[] | select(.status == "validation_error")] | length'

# View first validation error
cat structured-logic.json | jq '.[] | select(.status == "validation_error") | {ruleId, error}' | head -n 20
```

---

## Troubleshooting

### Common Issues

#### 1. **OpenAI API Rate Limits**

**Symptom:** `RateLimitError: You've exceeded your quota`

**Solution:**
- Reduce `CHUNK_SIZE` in `.env`
- Add delays between API calls
- Upgrade your OpenAI plan

#### 2. **Zod Validation Errors**

**Symptom:** Many rules with `status: "validation_error"`

**Solution:**
- Review LLM output in `rawLogic` field
- Improve system prompt in `prompt.ts`
- Extend schema in `logic-schema.ts` if needed

#### 3. **Out of Memory**

**Symptom:** `JavaScript heap out of memory`

**Solution:**
```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm run start:cheerio
```

#### 4. **Missing Dependencies**

**Symptom:** `Cannot find module 'cheerio'`

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

---

## Performance

### Current Benchmarks

| Step | Processing Time | Memory Usage |
|------|----------------|--------------|
| Steps 1-4 | ~5 seconds | ~500 MB |
| Step 5 | ~30 seconds | ~800 MB |
| Step 6 | ~20 minutes* | ~1.2 GB |

_*Step 6 time depends on OpenAI API speed and CHUNK_SIZE_

### Optimization Tips

- **Batch processing:** Increase `CHUNK_SIZE` (but watch rate limits)
- **Caching:** Save intermediate results to avoid re-processing
- **Parallel processing:** Run multiple API calls concurrently (with caution)

---

## Next Steps

After completing Step 6, the next priorities are:

1. **Improve validation rate** - Fix validation errors in Step 6 output
2. **Add Step 7** - Deduplicate and merge related rules
3. **Add Step 8** - Resolve cross-references (e.g., "see Annexe 23")
4. **Add Step 9** - Extract tariff amounts
5. **Code generation** - Auto-generate TypeScript from logic trees

---

## Contributing

See the main [MediLedger README](../../README.md#contributing) for contribution guidelines.

### ETL-Specific Guidelines

- Each step should be **idempotent** (same input → same output)
- Always write output to a JSON file for inspection
- Include a `reasoning` or `description` field for debugging
- Add comments explaining complex transformations
- Validate output with Zod schemas when possible

---

## License

[To be determined]

---

**Questions?** Open an issue or contact the project maintainers.
