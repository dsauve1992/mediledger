# NEXT STEP — build the chunking stage for track B

Handoff document. Written 2026-08-11 on branch `refactor/two-track-etl`
(HEAD = `753e51d`). Read `apps/etl/src/tracks/README.md` first — it explains why
two tracks exist. This file says what to do next and what not to do.

---

## Where things stand

Track A (`src/tracks/document-specific/`) is the original, working pipeline:
cheerio + RAMQ's left nav → 394 sections → typed tariff rows → LLM extraction.
It is fast (~5 s for steps 1-4), asserts a text-conservation invariant after each
step, and is **coupled to one document in one format**.

Track B (`src/tracks/format-agnostic/`) is new. Only its first stage exists:

```
any document (HTML | PDF)
      │
      ▼
  docling/           → docling.md        ✅ BUILT AND MEASURED
      │
      ▼
  chunk/             → chunks.json       ⬅️  YOUR JOB
      │
      ▼
  5-extract-specs/   → specs.json        ❌ blocked on chunking
      │
      ▼
  src/shared/spec-schema.ts              the IR both tracks must emit
```

### What the docling stage proved

Measured on the specialist manual with docling 2.119.0
(`npm run b:md` then `npm run b:compare-text`):

| axis | result |
|---|---|
| text conservation vs `$('#contenu').text()` | **PASS** — 0 words genuinely lost |
| RAMQ act codes (5-digit) | **PASS** — 5,239 / 5,239 |
| dropped multi-word passages | none |
| **section identity** | **90 markdown headings for 393 RAMQ sections** |

Content fidelity is a solved problem. **Structure is not**, and that is exactly
the gap you are filling: RAMQ marks most section titles as styled `<p>`/`<b>`
rather than `<h*>`, so only ~5% of its 393 section titles survive as a markdown
heading. Boundaries must come from chunking, not from markup.

---

## The task

Build `apps/etl/src/tracks/format-agnostic/chunk/` — a chunking stage over
`docling.md` — plus a measurement script that decides whether its boundaries are
good enough to feed step 5. **Do not wire it into step 5 yet.** Measure first.

Use [chonkie](https://github.com/feyninc/chonkie). Compare two strategies:

- `RecursiveChunker.from_recipe("markdown", lang="en")` — markdown-aware,
  hierarchical (paragraphs → sentences → words). Cheap, deterministic, no model.
- `SemanticChunker` — embedding-based topical boundaries. Requires
  `pip install "chonkie[semantic]"`; default model `minishlab/potion-base-32M`.

Verified API (docs.chonkie.ai, 2026-08-11):

```python
RecursiveChunker(tokenizer="character", chunk_size=2048,
                 rules=RecursiveRules(), min_characters_per_chunk=24)
RecursiveChunker.from_recipe("markdown", lang="en")   # Python only

SemanticChunker(embedding_model="minishlab/potion-base-32M", threshold=0.8,
                chunk_size=2048, similarity_window=3, skip_window=0, ...)

chunks = chunker(text)          # or chunker.chunk(text) / chunker.chunk_batch([...])
# Chunk: .text .start_index .end_index .token_count  (+ .context, .embedding)
```

`chunk_size` is in tokenizer units — with the default `tokenizer="character"`
2048 means *characters*, not tokens. Pass a real tokenizer if you want token
semantics.

### Deliverables

1. `chunk/chunk.py` — run both strategies over `docling.md`, write
   `chunks-recursive.json` / `chunks-semantic.json`. Each chunk should carry at
   minimum `{text, start_index, end_index, token_count}` plus any identity you
   derive (see "Section identity" below).
2. `chunk/measure_chunks.py` — the boundary-integrity report (next section).
3. `chunk/README.md` — results table, same style as `docling/README.md`.
4. `chunk/pyproject.toml` + npm scripts `b:chunk`, `b:measure` in
   `apps/etl/package.json` (follow the existing `b:*` pattern; note they `cd`
   into the docling dir and use `.venv/bin/python`).

Reuse the docling venv (`src/tracks/format-agnostic/docling/.venv`) or make a
sibling one — your call, but say which in the README. Add any new derived
artifacts to `.gitignore` under the track B block.

---

## The measurement that decides this (most important section)

Chunking introduces a **specific, real risk**. Track A's step 5 gets one LLM call
per *named* section — the model sees `"ALLERGIE"` and gets domain framing for
free. A chunk has no name, and RAMQ articles cross-reference heavily
(`"voir la Règle d'application no 29"`). A boundary that falls between a rule and
its `AVIS` produces a `BillingSpec` with silently missing conditions.

There is **no eval harness**, so that would not be detected downstream. Hence the
boundary checks below, all of which work *without ground truth*:

1. **`AVIS` / `NOTE` orphaning.** `docling.md` has 1,198 `AVIS` and 722 `NOTE :`
   markers. An `AVIS` block separated from the act code it qualifies is the
   highest-severity failure. Report: how many chunks start with `AVIS`/`NOTE`
   (orphan), and how many act codes lose a trailing `AVIS` that was adjacent in
   the source.
2. **`RÈGLE` / `ANNEXE` integrity.** These markers *are* in the accord-cadre and
   are format-independent — good candidates for `articleId`. Report how many
   `RÈGLE n` / `ANNEXE n` blocks are split across chunks vs kept whole.
3. **Tariff-table splitting.** Report chunks that begin mid-table (a `|` row with
   no header above it). Docling renders tariffs as markdown tables; a table split
   from its header loses the column meaning (`amount_facility` vs
   `amount_cabinet`).
4. **Act-code conservation.** All 5,239 codes must survive chunking. Any loss is
   a bug in the chunker config, not a tradeoff.
5. **Size distribution vs step 5's budget.** For calibration, track A's section
   sizes are p50 ≈ 1,956 chars, p90 ≈ 9,676, p99 ≈ 22,895, max ≈ 33,125
   (≈ 560 / 2,765 / 6,540 / 9,460 tokens at ~3.5 chars/token). Track A's step 5
   uses `maxTokens: 4096` with a `32768` + streaming retry. Chunks much larger
   than p90 will hit the same ceiling that already breaks four dense sections.
6. **Alignment with the 394 known sections.** `modified-content.json` is ground
   truth *for boundaries* (not for logic). Report what fraction of track A's
   section boundaries coincide with a chunk boundary. This is the single best
   signal that chunking recovers the structure Docling's markdown lost.

Write these as numbers in `chunk/README.md`. If a strategy fails #1 or #4, say so
plainly rather than tuning until it passes.

---

## Section identity — a decision you need to make

Track A's `sectionId` is a RAMQ HTML anchor id (`210737`). That is **not** a good
identity: it is not in the accord-cadre, not in a PDF, and not stable across
regenerations of the page. Track B must derive identity from content. Two options
already discussed with the user, neither yet chosen:

- **Content-derived slug** — hash/slug of the title path
  (`preambule-general/regle-5-visites`). Agnostic, survives id churn and format
  changes. Needs a title path, which is what chunking must recover.
- **LLM-emitted `articleId`** — let step 5 read `RÈGLE 5` / `ANNEXE 24` out of the
  chunk text. Those markers are format-independent and already in the IR schema.

Recommend one in the README with reasons; do not silently pick.

---

## Hard-won gotchas (do not rediscover these)

- **Docling emits U+E000** (Unicode Private Use Area) where the source had a
  `<br>` inside a heading or cell — 47 occurrences in `docling.md`. It is a
  line-break marker, **not content**. Strip it before chunking or tokenizing —
  in Python, `re.sub("[\\ue000-\\uf8ff]", " ", md)` — or `RÈGLE 32. <PUA> VISITES`
  tokenizes as one run-together word. This cost real debugging time; see
  `strip_md()` in `docling/compare_text.py`.
- **RAMQ's own HTML runs words together** where inline tags meet
  (`THÉRAPEUTIQUESEN`, `cabinetR`, `torticoliscongénital`). Docling separates them
  *correctly*. Any diff against source text must classify these as source
  artifacts, not losses — see the `squash_join` helper in
  `docling/compare_text.py`. Without it you will "find" ~23 phantom losses.
- **Python 3.12, not 3.14.** Docling has no 3.14 wheels. The venv is pinned via
  `uv venv --python 3.12`.
- **Do not run two `uv pip install` commands against the same venv.** The second
  blocks on `.venv/.lock` and looks like a hang.
- **`npm run` from `apps/etl/`**, and note the shell cwd resets between tool
  calls — use absolute paths or re-`cd`.
- **Track A caches by output-file existence.** Delete the artifact to force a
  re-run. Two documents in the same cwd will collide.

---

## Constraints

- **Do not modify track A.** It is verified working: from a clean state, steps 1-4
  regenerate all four artifacts byte-identical and all three `compareString`
  checks pass. If you think track A needs a change, raise it — don't do it.
- **Do not change `src/shared/spec-schema.ts`** without flagging it. Both tracks
  emit it; it is what makes them comparable.
- **Do not build a RAG/retrieval pipeline.** This was explicitly considered and
  rejected: RAG is a query-time architecture whose job is to *skip* irrelevant
  passages, but step 5 is a one-time **exhaustive compilation** — every article
  must become a `BillingSpec`. Top-k retrieval would silently drop articles with
  no way to know which, contradicting the project's traceability guarantee. Use
  chonkie's **chunker** only: no embeddings search, no top-k, every chunk
  processed. (RAG does fit later, at *runtime*, querying the finished IR.)
- **Do not commit** derived artifacts (`docling.md`, `chunks-*.json`, `.venv`) or
  secrets. `apps/etl/.env` holds `ANTHROPIC_API_KEY` and is gitignored.

---

## Known gaps, deliberately not in scope here

- **`BillingSpec` has no `docId`** (`src/shared/spec-schema.ts`). With one
  document that is fine; with two, `sectionId: "210737"` stops being unique and
  traceability quietly breaks. Cheap now, a migration later. Flag it; the user
  decides when.
- **No eval harness.** Nothing measures whether a `logic` AST faithfully
  represents its French source paragraph. This is the project's top gap per its
  own README, and every ingestion/chunking change moves quality in an unmeasured
  direction. The boundary checks above are a partial substitute, not a
  replacement.
- **Four dense sections still fail track A's step 5** (NEUROLOGIE, OBSTETRIQUE,
  PROSTATE, VAGIN) even with the 32k + streaming retry. That is an output-token
  ceiling, unrelated to ingestion.
- **Docling on a real RAMQ PDF is untested.** The whole point of track B is PDF
  support (*lettres d'entente*, *infolettres*, Brochure No. 1) and no PDF has
  been run through it yet. `ingest.py` and `to_markdown.py` both accept one.
  Worth doing soon, but chunking is the current blocker.

---

## How to verify you haven't broken anything

```bash
cd apps/etl
npx tsc --noEmit                       # must be clean
npm run b:md && npm run b:compare-text # must still report PASS / PASS
# track A, from a clean state (back the artifacts up first — they are gitignored):
npm run a:step1 && npm run a:step2 && npm run a:step3 && npm run a:step4
# expect 393 menu items, 394 sections, and byte-identical output
```

## Context worth knowing

The user is the founder, building this as an open-source vendor-neutral IR for
Quebec billing rules — the thesis is *rules-as-data*: treat the RAMQ corpus as
input to a compiler rather than a spec for humans to hand-translate. Traceability
(every rule links back to its source document, section, URL) is a load-bearing
guarantee, not a nice-to-have. That is why "lose 2% of sections silently" is not
an acceptable tradeoff here, and why the boundary measurement matters more than
getting chunking shipped fast.

The user prefers options presented rather than decisions made for them on design
questions, and wants concerns raised early rather than discovered late.
