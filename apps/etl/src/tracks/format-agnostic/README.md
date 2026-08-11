# Track B — format-agnostic

```
any document (HTML | PDF)
        │
        ▼
  docling/     → docling.md          Docling conversion; no MediLedger logic
        │
        ▼
  chunk/       → chunks.json         semantic / recursive chunking  [NOT BUILT]
        │
        ▼
  5-extract-specs/                   LLM → BillingSpec[]           [NOT BUILT]
        │
        ▼
  src/shared/spec-schema.ts          the same IR track A produces
```

## Status

- `docling/` — **built and measured.** Lossless on the specialist manual.
- `chunk/` — not built. This is the next step.
- `5-extract-specs/` — not built. Blocked on chunking.

## Run

```bash
npm run b:setup          # once: uv venv + docling (Python 3.12)
npm run b:md             # → docling/docling.md
npm run b:compare-text   # conservation check vs $('#contenu').text()
```

## What is measured so far

| axis | result |
|---|---|
| text conservation | **PASS** — 0 words genuinely lost |
| act codes | **PASS** — 5,239 / 5,239 |
| dropped passages | none |
| section identity | **90 Markdown headings for 393 RAMQ sections** |

Two artifacts of the comparison worth knowing, both real findings rather than
bugs in the diff:

1. **RAMQ's HTML runs words together** where inline tags meet
   (`THÉRAPEUTIQUESEN`, `cabinetR`, `torticoliscongénital`). Docling separates
   them correctly, so a naive diff scores 23 "losses" that are the *source*
   being malformed. `compare_text.py` classifies these before reporting.
2. **Docling emits U+E000** (Unicode Private Use Area) where the source had a
   `<br>` inside a heading or cell — 47 occurrences. It is a line-break marker,
   not content. **Anything consuming `docling.md` downstream must strip PUA**,
   or `RÈGLE 32.  VISITES` will tokenize wrongly.

## Why chunking, not RAG

The obvious next move looks like a RAG pipeline. It is not, and the distinction
matters: RAG is a **query-time** architecture whose job is to *skip* irrelevant
passages. Step 5 is a **one-time exhaustive compilation** — every article must
become a `BillingSpec`, so there is nothing to rank and nothing to skip.
Retrieving top-k would silently drop articles with no way to know which,
contradicting the traceability guarantee.

What is genuinely wanted from a RAG toolkit is its **chunker**: chonkie's
`RecursiveChunker` (Markdown-aware) or `SemanticChunker`, applied exhaustively to
every chunk. Same library, no embedding search, no top-k.

(RAG *does* fit MediLedger later — at runtime, answering "can I bill 09127 with
15363?" against the finished IR. That consumes the IR; it does not build it.)

## The risk chunking introduces

Track A's step 5 sees a named section. A semantic chunk has no name, and RAMQ
articles cross-reference heavily ("voir la Règle d'application no 29"). A chunk
boundary between a rule and its `AVIS` yields a spec with missing conditions —
and with no eval harness, **that would not be detected**.

So chunking must be measured on boundary integrity before it feeds step 5:
do act codes stay with their `AVIS`/`NOTE` blocks? Do `RÈGLE` / `ANNEXE` markers
land at boundaries? Those are checkable without ground truth.
