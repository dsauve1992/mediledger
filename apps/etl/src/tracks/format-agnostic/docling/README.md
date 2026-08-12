# Docling ingester (experimental)

Converts a RAMQ document with
[Docling](https://github.com/docling-project/docling) and verifies that nothing
was lost in the process.

The module is deliberately thin: **no MediLedger logic at all**. `to_md.py`
exports Docling's own `DoclingDocument` via `export_to_markdown()` and nothing
else, so what lands in `docling.md` is exactly what Docling produces.
`compare_text.py` then answers the question this stage was built to answer — is
any content missing?

It answers it, and the answer is *almost none*. But content conservation turned
out not to be the question that decides this track; see **The real problem**
below.

Nothing in track A (`../../document-specific/`) is modified or imported. This
directory has its own Python venv and can be deleted without affecting the
pipeline.

## Why

Track A's steps 1–4 are deliberately coupled to the specialist manual's HTML:
they read RAMQ's left nav (`#menuGauche #nav`) for the section tree and cut
content at each of the document's own anchor IDs (`#210737`). That coupling is
what makes them lossless and traceable — and also what makes them unable to
ingest a PDF *lettre d'entente* or *infolettre*.

This experiment measures what a general-purpose document converter recovers from
the **same** document, so the eventual multi-ingester seam can be designed
against evidence rather than a guess.

## Run

```bash
# once — creates .venv (Python 3.12; docling has no 3.14 wheels yet)
npm run b:setup        --workspace=mediledger

# convert the specialist manual → docling.md
npm run b:md           --workspace=mediledger

# verify no content was lost
npm run b:compare-text --workspace=mediledger
```

Or directly:

```bash
.venv/bin/python to_md.py ../../../manuel-specialistes-remuneration-acte.html
.venv/bin/python compare_text.py --html ../../../manuel-specialistes-remuneration-acte.html
```

`to_md.py` also accepts a PDF, which is the real target for phase 2 (LEs,
infolettres, Brochure No. 1).

## What `compare_text.py` checks

It diffs `docling.md` against `$('#contenu').text()` — the exact string
`cheerio-scraper.ts:95-103` feeds to `compareString`. Comparing against
`#contenu` rather than the whole HTML file matters: the raw file also carries the
left nav, scripts and Word/mso cruft that `#contenu` excludes, so a whole-file
diff would mostly measure chrome, not content.

Five gates, each independently PASS/FAIL; the script exits non-zero if any fails,
so it is usable as a CI gate:

| Gate | Question |
|---|---|
| Text conservation | Is any of A's vocabulary genuinely absent from B? |
| Act codes (distinct) | Does every 5-digit act code survive? |
| Act codes (occurrences) | Does each survive **as many times**? |
| Amount conservation | Does every monetary value survive, as many times? |
| Amounts intact | Did any amount gain a space after its decimal comma? |

The last three exist because a set-based, whitespace-squashing comparison has
three blind spots that matter for billing data:

1. Amounts were tested by nothing — the word regex excludes digits and the code
   regex only matches 5-digit act codes.
2. Set comparison passes if B keeps one instance of a code and drops 500. For a
   tariff document the count *is* the data.
3. Squashing whitespace makes `89,90` and `89, 90` identical. Docling emits the
   latter where RAMQ wraps part of a number in an inline tag
   (`89,<font …>90</font>`), and a parser reading that cell gets two tokens
   instead of one value. **That check therefore runs on raw text.**

### Normalization, and what is *not* counted as loss

Encoding differences are normalized on **both** sides rather than reported as
loss: HTML entities are decoded, en/em dashes fold to ASCII `-`, quote variants
fold to `'`, NBSP and narrow NBSP fold to a plain space, and Docling's U+E000
line-break marker is treated as whitespace. `&lt;` and `<` are the same datum; so
are `Addendum 7 – Microchirurgie` and `…- Microchirurgie`.

Note also the concatenation-artifact classification. RAMQ's HTML runs words
together where inline tags meet (`THÉRAPEUTIQUESEN`, `cabinetR`,
`torticoliscongénital`). Those appear "missing" from the Markdown only because
Docling separated them *correctly*. The script checks whether B contains the
pieces before calling anything a loss — without that, the diff reports its own
tokenization as data loss.

Anything downstream that consumes Docling's output must apply the same treatment:
`html.unescape()` it and strip the PUA range.

## Result on the specialist manual (docling 2.119.0)

| | source `#contenu` | docling.md | gate |
|---|---|---|---|
| chars (whitespace-free) | 959,662 | 1,152,185 (120.1%) | — |
| distinct words | 7,330 | 7,332 | — |
| **content genuinely lost** | — | **none** | PASS |
| **5-digit act codes** (distinct) | 5,239 | **5,239 (100%)** | PASS |
| act-code occurrences | 8,340 | 8,340 (+0) | PASS |
| amount occurrences | 6,590 | 6,589 (**−1**) | **FAIL** |
| amounts split by whitespace | — | **1** (`89, 90`) | **FAIL** |
| dropped multi-word passages | — | none | — |
| ATX headings, usable | 393 nav sections | **91** | not gated |
| ATX headings, trapped in a table cell | — | **236** | not gated |

Text and tariff fidelity are near-perfect — no content is lost, and every act
code survives with its exact occurrence count. The 120.1% char count is *added*
material (nav chrome, repeated headers, table pipes), not duplication.

Two gates fail, on a single defect: RAMQ writes one amount as
`89,<font …>90</font>`, and the inline tag reads as a word boundary, so Docling
emits `89, 90`. One amount out of 6,590 — but it is a *silently wrong tariff*,
which is the failure mode this project exists to prevent, so it is gated rather
than tolerated.

## The real problem

The gates above all measure *content*, and content is not what decides this
track. The structural result is:

- **91** headings survive where a Markdown parser can see them
- **236** more are trapped *inside table cells* — e.g. `| | | ## **LÈVRES** |`
- against RAMQ's **393** nav sections

RAMQ's manual body is **one giant `<table>` used for page layout**, 1990s-style.
Its columns carry fixed positional meaning (col 1 = act code, col 2 =
description/AVIS/NOTE, col 3-4 = amounts), and `<table class="avis">` advisories
are *nested tables inside a `<td>`*. Markdown has no nested tables and no notion
of a heading inside a cell, so all of that collapses into flat pipe-rows.

This is not a Docling bug and not source corruption — the source structure is
highly regular. **Markdown is simply too lossy a target to hold it.** The cell
coordinates and heading levels that carried the structure are discarded at
export, before anything downstream gets a chance to read them.

**Conclusion:** as a *text and tariff* extractor Docling is essentially lossless
on this document. As a *section* extractor, Markdown output cannot reconstruct
the tree track A gets for free from RAMQ's nav. Do not build an ingester on
`docling.md`.

## Where this is going

Markdown is the current artifact because it is what is built, not because it is
the right one. Two questions stand between here and a usable track B, and the
first is open:

1. **What should the ingester's output actually be?** Whatever it is, it has to
   preserve what Markdown drops — which cell a value came from, and what nesting
   level a heading had. That is a design decision, not yet made.
2. **How is the layout table interpreted?** The positional column semantics
   above are RAMQ *domain* knowledge, and they are expressible as a small
   data-shaped *profile* rather than a parser. That would keep the ingester
   format-agnostic while letting each document family bring its own layout
   description — so a new document costs a profile, not a new track.

## Status

Experimental. Not wired into `npm run etl`. See the top-level README for where
this fits relative to phase 2.
