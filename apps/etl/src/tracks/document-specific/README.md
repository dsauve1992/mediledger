# Track A — document-specific

The original pipeline. Deterministic, fast (~5 s for steps 1-4), and lossless on
the specialist fee-for-service manual.

```
src/manuel-specialistes-remuneration-acte.html
        │
        ▼
  1-extract-structure-from-menu/   → menu.json                (RAMQ #menuGauche #nav → 393 sections)
        │
        ▼
  2-equalize-section-headers/      → modified-raw-content.html (hoist anchors to #contenu children)
        │
        ▼
  3-group-content-by-section/      → sectionsWithContent.json  (cut at each known anchor)
        │
        ▼
  4-sanitize-html/                 → modified-content.json     (text + typed tariff rows)
        │
        ▼
  5-extract-specs/                 → specs.json → specs-normalized.json + variable-registry.json
```

## Run

```bash
npm run start:cheerio    # steps 1-4 + conservation checks, then step 5
# or individually:
npm run a:step1 … a:step4
npm run a:step5
npm run a:step5:normalize
```

Every step caches by output-file existence — delete the artifact to force a
re-run. Steps 1-4 need no API key; step 5 needs `ANTHROPIC_API_KEY` in
`apps/etl/.env`.

## What makes it good

`cheerio-scraper.ts` asserts a **conservation invariant** after each of steps
1-3: the whole `$('#contenu').text()` must survive, whitespace-stripped
(`compareString`). That is a verifiable, deterministic guarantee — the reason
this track is trustworthy despite the coupling below.

Step 4 additionally produces **typed** tariff rows —
`{code, description, amount_facility, amount_cabinet?, amount_r2?}` — 5,662 of
them, parsed with a French-locale regex (decimal comma, thin-space thousands).
That regex is RAMQ *domain* knowledge and is reusable regardless of input format;
it is currently trapped inside an HTML-table walker
(`4-sanitize-html/index.ts:56-70`).

## What makes it brittle

It is coupled to this document in four distinct ways, in increasing order of cost
to fix:

1. **Artifact paths** — each step hardcodes `path.resolve(process.cwd(), '<name>.json')`
   *and* uses file existence as its cache. Two documents in one cwd collide and
   silently serve each other's output. Cosmetic; a `RunContext` fixes it.
2. **DOM selectors** — `#menuGauche`, `#nav`, `#contenu`, `#<anchorId>`. These
   are the RAMQ *web template*, not this manual, so they likely hold for the GP
   manual. A config object fixes it.
3. **The structural assumption** — steps 1-3 assume *a nav tree whose hrefs are
   anchors into a flat content body*. No config value rescues this for a PDF
   infolettre: no nav, no anchor ids, no `#contenu`. This is what track B exists
   to solve.
4. **Anchor ids as identity** — `sectionId` is RAMQ's own anchor id. It is not in
   the accord-cadre, not in a PDF, and **not stable across regenerations of the
   page**. If RAMQ reissues the HTML with shifted ids, `specs.json` loses its
   links and no invariant catches it.

## Note

`5-extract-specs/` imports the IR from `src/shared/spec-schema.ts` — shared with
track B deliberately, so both tracks remain comparable. Do not fork it.

Four dense sections (NEUROLOGIE, OBSTETRIQUE, PROSTATE, VAGIN) still fail step-5
extraction even with the 32k + streaming retry. That is an output-token ceiling,
unrelated to ingestion.
