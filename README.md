# MediLedger

A rules-as-data toolkit for Quebec medical billing.

Quebec's medical-billing rules live in long French-language manuals, numbered *lettres d'entente*, and dated RAMQ *infolettres*. Every billing vendor in the province re-implements those rules in code. When the rules change — and between Bill 2, Law 25, Law 39, and Bill 19, they are changing constantly — every vendor does the same translation work in parallel, often with subtle divergences.

MediLedger is an attempt to flip that: treat the RAMQ corpus as **input to a compiler**, not as a specification for humans to translate into code. This repo contains the extraction pipeline and the intermediate representation (IR) that comes out of it.

## Status

**v0, pre-release.** Not production-ready. Do not rely on any output for real billing decisions.

What works today:
- Deterministic extraction of structure from the specialist fee-for-service manual (~5 s, no LLM calls).
- LLM-based single-pass extraction of a `BillingSpec` array per RAMQ section, with Zod validation and full source traceability (`rawText`, `sectionId`, `articleId`).
- A discriminated-union `LogicNode` AST covering the operator set needed for most FFS constraints (`MAX_COUNT`, `MIN_DURATION`, `CONTEXT`, `IN_SET`, `REQUIRES_CODE`, `EXCLUDES_CODE`, `AGE`, `TIME_WINDOW`, composite `AND`/`OR`/`NOT`).
- A post-pass that canonicalizes free-form `CONTEXT` / `IN_SET` variable names into a stable registry.

What is **not** here yet:
- An evaluation harness. No ground-truth set, no precision/recall numbers — extraction quality is unmeasured.
- A bitemporal layer (effective dates, amendment lineage). The IR today treats each rule as timeless.
- Support for anything beyond the specialist FFS manual (no GP manual, no capitation, no LEs, no infolettres).
- A runtime claim validator. This repo produces the IR; it does not adjudicate claims.

Read `docs/plans/` for the design history and `apps/etl/src/5-extract-specs/spec-schema.ts` for the canonical IR definition.

## Thesis

Billing software today is built on a **code-translates-rules** paradigm: a domain analyst reads the RAMQ manual, writes a ticket, and an engineer translates it into code. This has three structural problems:

1. **Every vendor re-does the same translation.** There is no shared, machine-readable specification, even though the underlying rules are identical for everyone.
2. **Translation is lossy and non-auditable.** Once a rule becomes code, the connection back to the source paragraph is informal at best.
3. **Reform cycles break the paradigm.** Bill 2's blended compensation model is not a patch on the existing schema — it requires new domain entities (affiliation, panel, practice environment, compensation period). When the legislative cadence accelerates, hand-translation stops scaling.

The **rules-as-data** alternative: publish the rules as structured data with a stable schema, let vendors build executable behaviour on top of that shared substrate, and version the substrate explicitly as the law changes.

This repo is one attempt at that substrate. It is not the substrate — a real one would require industry participation, federation buy-in, and RAMQ acknowledgement. This is a reference implementation meant to prove that the shape is workable.

## Architecture

Sequential ETL, each step's JSON output feeds the next:

| Step | Directory | Output | Description |
|------|-----------|--------|-------------|
| 1 | `1-extract-structure-from-menu/` | `menu.json` | Parse RAMQ HTML table of contents |
| 2 | `2-equalize-section-headers/` | — | Normalize heading levels |
| 3 | `3-group-content-by-section/` | `sectionsWithContent.json` | Group HTML by section |
| 4 | `4-sanitize-html/` | `modified-content.json` | Strip formatting, normalize whitespace |
| 5 | `5-extract-specs/` | `specs.json` → `specs-normalized.json` + `variable-registry.json` | LLM extraction, Zod validation, variable canonicalization |

Steps 1–4 are deterministic and fast. Step 5 calls an LLM once per section, validates each returned spec with Zod, and records errors in status-tagged envelopes rather than crashing. The normalization post-pass deduplicates variable names across the whole corpus.

The canonical IR is defined in [`apps/etl/src/5-extract-specs/spec-schema.ts`](apps/etl/src/5-extract-specs/spec-schema.ts). Read that file first if you want to understand the data model.

## Run the pipeline

Prerequisites: Node.js 20+, an OpenAI API key.

```bash
npm install

# apps/etl/.env
# OPENAI_API_KEY=sk-...

npm run etl
```

Output files land in `apps/etl/` and are gitignored (they are derived artifacts). A full Step 5 run against the specialist manual issues roughly a hundred API calls and takes a few minutes.

## Scope

**In scope.** The IR and its extraction pipeline for **public RAMQ documents**: the specialist and GP FFS manuals, *lettres d'entente*, *infolettres*, Brochure No. 1, and any other publicly published billing-rule material. Act codes, context elements, role codes, and the constraints that connect them.

**Out of scope for v0.** Capitation modelling (Bill 2 blended compensation). Runtime claim validation. EMR integrations. SYRA-RFP transport. Anything that relates to a specific vendor's implementation. Anything that relates to a specific physician's practice.

The public-RAMQ-documents constraint is deliberate. The IR has to be independently reproducible by anyone reading the same source material — and it has to be safe for vendors to adopt without worrying about provenance.

## For billing vendors

If you build or maintain a Quebec medical-billing product, the offer here is simple: a **shared, vendor-neutral IR for the rules you already re-implement internally**. Adopting it doesn't require changing your product — it means having one additional dependency that tracks public rule changes, so your team doesn't have to track them alone.

The IR is small, readable, and Apache-2.0. If the shape doesn't fit your needs, the design conversation is in the open — file an issue or a PR against the schema. The goal is a substrate that is useful enough to be boring, not a competitor to anyone's product.

## Contributing

This is a solo project at v0. PRs and issues are welcome, with two expectations:

1. **Schema changes come with evaluation context.** Once an eval harness exists (imminent), schema PRs should include before/after extraction quality numbers. Until then, attach a few concrete examples showing why the change is needed.
2. **Design discussion happens in issues before code.** The IR is small enough today that any schema change has broad impact — let's talk through it before implementing.

Bug reports and documentation PRs need no prior discussion.

## License

Apache License 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
