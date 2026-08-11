# Two extraction tracks

MediLedger currently maintains **two parallel ETL front-ends** that converge on
the same IR (`src/shared/spec-schema.ts`). They are independent: neither imports
the other, and running one never touches the other's artifacts.

They exist because the original pipeline is fast and lossless but only works on
*one document in one format*, and the project's scope (GP manual, *lettres
d'entente*, *infolettres*, Brochure No. 1) requires more than that.

| | `document-specific/` | `format-agnostic/` |
|---|---|---|
| Ingest | cheerio + RAMQ left-nav anchors | Docling → Markdown |
| Sectioning | RAMQ's own nav tree (393 anchors) | chunking (semantic / recursive) |
| Section identity | RAMQ anchor id (`210737`) | derived — TBD |
| Works on | the specialist FFS manual | any HTML or PDF |
| Runtime (steps 1-4) | ~5 s | ~30 s |
| Status | **working, end to end** | experimental |

## The tradeoff under test

`document-specific/` conserves text and every act code, and gets a 393-node
section tree *for free* from RAMQ's nav. But it is coupled to that nav: it
assumes `#menuGauche #nav`, `#contenu`, and the document's own anchor ids. It
cannot read a PDF, and **a regenerated version of the same page with shifted
anchor ids would silently break `specs.json`'s links** — no invariant catches
that today (`compareString` checks text conservation, not id stability).

`format-agnostic/` has no such coupling. Measured on the specialist manual
(docling 2.119.0), its Markdown loses **nothing**: 5,239/5,239 act codes, no
dropped passages, text conservation PASS against the same `$('#contenu').text()`
yardstick the other track uses.

Its open problem is structure, not content. RAMQ marks most section titles as
styled `<p>`/`<b>` rather than `<h*>`, so Docling emits **335 `section_header`
items but only 90 Markdown headings**, and only ~5% of RAMQ's 393 section titles
survive as a Markdown heading. Section boundaries therefore have to come from
chunking, not from markup — which is what the `chunk/` stage is for.

## Why each track owns its own step 5

Track A's step 5 gets a *named* section ("ALLERGIE") per LLM call — free domain
framing. Track B's chunks have no such name and will need a different prompt and
possibly a different input contract. Keeping the extractors separate lets B
diverge without risking regressions in the working pipeline.

What they must **not** diverge on is the output: both emit `BillingSpec[]`
validated by `src/shared/spec-schema.ts`. That shared schema is what keeps the
two tracks comparable — and is the reason a future eval harness can score them
against each other.

## Known gap

`BillingSpec` has `sectionId` + `articleId` but **no `docId`**. With one document
that is fine; with two, `sectionId: "210737"` stops being unique and the
traceability guarantee quietly breaks. This affects both tracks and is cheap to
fix now, expensive to migrate later.

There is also **no eval harness**, so no measurement exists of whether either
track's `logic` AST faithfully represents the French source. Every change to
ingestion or chunking currently moves extraction quality in an unmeasured
direction.
