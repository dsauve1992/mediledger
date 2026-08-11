# Docling ingester (experimental)

An **independent, additive** step that ingests a RAMQ document with
[Docling](https://github.com/docling-project/docling) instead of ETL steps 1–4.

Nothing in `src/1-…` through `src/5-…` is modified or imported. This directory
has its own Python venv and can be deleted without affecting the pipeline.

## Why

Steps 1–4 are deliberately coupled to the specialist manual's HTML: they read
RAMQ's left nav (`#menuGauche #nav`) for the section tree and cut content at
each of the document's own anchor IDs (`#210737`). That coupling is what makes
them lossless and traceable — and also what makes them unable to ingest a PDF
*lettre d'entente* or *infolettre*.

This experiment measures what a general-purpose document converter recovers
from the **same** document, so the eventual multi-ingester seam can be designed
against evidence rather than a guess.

## Run

```bash
# once — creates .venv (Python 3.12; docling has no 3.14 wheels yet)
npm run docling:setup   --workspace=mediledger

# ingest the specialist manual → docling-content.json
npm run docling         --workspace=mediledger

# A/B against step 4's modified-content.json
npm run docling:compare --workspace=mediledger
```

`docling:compare` requires `modified-content.json` to exist — run the normal
pipeline (`npm run step1` … `npm run step4`) first.

Or directly:

```bash
.venv/bin/python ingest.py  ../src/manuel-specialistes-remuneration-acte.html
.venv/bin/python compare.py --a ../modified-content.json --b docling-content.json
```

`ingest.py` also accepts a PDF, which is the real target for phase 2
(LEs, infolettres, Brochure No. 1).

## Output shape

`ingest.py` emits the **same** shape as step 4's `modified-content.json`, so the
diff is apples-to-apples and step 5 could in principle consume it unchanged:

```jsonc
[{ "id": "docling-42", "parentId": "…", "name": "ALLERGIE",
   "content": [ "AVIS : …",
                { "code": "09127", "description": "Visite principale",
                  "amount_facility": 92.80 } ] }]
```

Note `id`. Docling has no access to RAMQ's anchor IDs, so `ingest.py` can only
synthesize sequential ones (`docling-N`) and derive `parentId` from a heading-level
stack. That is the single most important difference from steps 1–3 and the main
thing `compare.py` quantifies.

The tariff regex in `ingest.py` is a deliberate port of
`src/4-sanitize-html/index.ts:56-70` (5-digit code, French decimal comma,
thin-space thousands). Keeping it identical is what makes the tariff-recovery
numbers meaningful — it isolates *sectioning and table extraction* as the
variable under test. If step 4's regex changes, change this one too.

## The simpler test: Markdown vs raw HTML

`ingest.py` conflates two things — Docling's conversion quality *and* the
sectioning heuristic in `build_sections`. To isolate the former:

```bash
.venv/bin/python to_markdown.py ../src/manuel-specialistes-remuneration-acte.html
.venv/bin/python compare_text.py   # docling.md vs $('#contenu').text()
```

`to_markdown.py` applies **no** MediLedger logic — just Docling's own
`export_to_markdown()`, plus an item inventory. `compare_text.py` diffs it
against `$('#contenu').text()`, the exact string `cheerio-scraper.ts:95-103`
feeds to `compareString`. (Diffing the *whole* HTML file instead would mostly
measure nav chrome and Word cruft, not content.)

Note the artifact classification in `compare_text.py`: RAMQ's HTML runs words
together where inline tags meet (`THÉRAPEUTIQUESEN`, `cabinetR`,
`torticoliscongénital`). Those appear "missing" from the Markdown only because
Docling separated them *correctly*. The script checks whether B contains the
pieces before calling anything a loss — without that, the diff reports its own
tokenization as data loss.

### Result on the specialist manual (docling 2.119.0)

| | source `#contenu` | docling.md |
|---|---|---|
| chars (whitespace-free) | 959,662 | 1,052,594 (109.7%) |
| distinct words | 7,330 | 7,333 |
| **content genuinely lost** | — | **none** |
| **5-digit act codes** | 5,239 | **5,239 (100%)** |
| dropped multi-word passages | — | none |
| **ATX headings** | 393 nav sections | **90** |

Text and tariff fidelity are excellent — Docling loses nothing. The 109.7% char
count is *added* material (nav chrome, repeated headers), not duplication of
content.

The failure is structural, and it is decisive: Docling emits **335
`section_header` items but only 90 Markdown headings**, and of RAMQ's 393
sections only **5.1% survive as a Markdown heading** (57.8% appear somewhere in
the text as plain or bold prose). RAMQ marks most section titles as styled `<p>`
/ `<b>`, not `<h*>` — so there is no heading for Docling to find, and Markdown
has nowhere to put the distinction.

**Conclusion:** as a *text and tariff* extractor Docling is essentially lossless
on this document. As a *section* extractor it cannot reconstruct the tree that
steps 1–3 get for free from RAMQ's nav — and Markdown is a lossy target for that
structure regardless. Use `.doc.json` (`to_markdown.py --json`), not Markdown, if
a future ingester is to build on Docling.

## What compare.py reports

| Axis | Question |
|---|---|
| Structure | Do RAMQ anchor IDs survive? Can section names be matched back? |
| Tariff rows | How many of step 4's typed `{code, amount}` objects does Docling recover, and do amounts agree? |
| Text conservation | Does Docling's text cover step 4's? (analogue of `compareString` in `cheerio-scraper.ts`) |

## Status

Experimental. Not wired into `npm run etl`. See the top-level README for where
this fits relative to phase 2.
