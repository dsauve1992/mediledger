"""Compare Docling's Markdown export against the source HTML's `#contenu` text.

This is the direct analogue of `compareString` in cheerio-scraper.ts:95-103:
that function extracts `$('#contenu').text()` and asserts the pipeline conserves
it, whitespace-stripped. Here we ask the same of Docling's Markdown export.

Comparing against `#contenu` rather than the whole file matters — the raw HTML
also contains the left nav, scripts and Word/mso cruft that `#contenu` excludes,
so a whole-file diff would mostly measure chrome, not content.

Reports, in both directions:
  - character volume (whitespace-stripped), to catch bulk loss or duplication
  - vocabulary coverage, to catch *which* content went missing
  - act-code coverage: are all 5-digit RAMQ codes still present, and as many
    times? (distinct-set AND occurrence counts)
  - amount conservation: are all monetary values still present, and as many
    times? This is the payload of a tariff document.
  - amounts corrupted by injected whitespace ("89, 90" for "89,90")
  - unescaped HTML entities (informational — decoded before comparison)
  - the longest source runs absent from the Markdown (real dropped passages)

Encoding differences are normalized on BOTH sides rather than reported as loss:
HTML entities are decoded, and quotes / dashes / NBSP are folded. `&lt;` and `<`
are the same datum; so are "Addendum 7 – Microchirurgie" and "…- Microchirurgie".

One case deliberately resists that treatment. Docling renders the amount
`89,<font …>90</font>` as `89, 90`, and that is NOT a spacing variant: a tariff
parser reading the cell gets two tokens ("89," and "90") instead of one value.
Whitespace-squashing would silently repair it in the comparison while the real
artifact stays broken, so the split-amount check runs on RAW text and fails.

Three of those are newer than the original version of this script, which reported
PASS on a document where Docling corrupts a tariff amount. They exist because the
original had three blind spots:

  1. It never looked at amounts at all — WORD excludes digits and CODE only
     matches 5-digit act codes, so monetary values were tested by nothing.
  2. It compared *sets*, so dropping 500 occurrences of a code while keeping one
     of each still passed. For billing data the count is the data.
  3. squash() strips all whitespace before comparing, making "89,90" and
     "89, 90" identical — so the normalization that makes the text comparison
     robust also blinds it to token-level corruption. The split-amount check
     therefore runs on RAW text.

Exits non-zero when any check fails, so this is usable as a gate.

WHAT THIS SCRIPT CANNOT TELL YOU. Every check here is about *content* — text,
act codes, amounts. All of them pass on this document. The defect that actually
blocks track B is *structural*, and Markdown is precisely the format in which it
becomes invisible: the manual's body is one big layout `<table>`, so headings
land inside table cells and nested `<table class="avis">` advisories flatten
into prose. A content-conservation gate reports PASS on a document whose section
tree has been destroyed. The SECTION IDENTITY section below is the only part
that looks at structure, and on Markdown it can only count ATX headings — the
cell coordinates and heading levels that carried the structure are already gone
by the time this script sees the file. Read a PASS here as "no content was
lost", never as "this output is usable".

Usage:
    python compare_text.py [--html ../src/manuel-....html] [--md docling.md]
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from collections import Counter
from pathlib import Path

try:
    from bs4 import BeautifulSoup  # ships with docling
except ImportError:  # pragma: no cover
    print("BeautifulSoup not available in this venv", file=sys.stderr)
    raise


def contenu_text(html_path: Path) -> str:
    """Extract #contenu's text, mirroring getContenuString() in the TS pipeline."""
    soup = BeautifulSoup(html_path.read_text(encoding="utf-8", errors="replace"),
                         "html.parser")
    node = soup.find(id="contenu")
    if node is None:
        raise SystemExit("No #contenu node found — is this the RAMQ HTML?")
    return node.get_text()


def markdown_text(md_path: Path) -> str:
    """Read the Markdown export verbatim.

    No stripping of pipes, ATX markers or emphasis. Every check in this file is
    tokenizing (words of 4+ letters, 5-digit codes, French decimal amounts), and
    none of those patterns can match a `|`, `#` or `*`. Removing the syntax would
    buy nothing and risk mangling content -- RAMQ descriptions genuinely contain
    `*` and `#`.

    One consequence worth stating: because the manual's body is a single layout
    table, most of this document's payload arrives here as Markdown table rows.
    That is the same data the JSON export would hold in
    `tables[].data.table_cells[]` -- the difference is that Markdown has already
    discarded which cell was which column, so cell-level structure cannot be
    recovered from this string.
    """
    return md_path.read_text(encoding="utf-8", errors="replace")


def clean(s: str) -> str:
    """Normalize Docling's encoding quirks so we compare content, not escaping."""
    # Docling leaves HTML entities encoded (`MMSE &lt; 23/30`) where #contenu's
    # .text() decodes them. Same datum, different encoding -- decode so the
    # comparison measures content rather than escaping. The raw-entity count is
    # still reported separately, because a consumer of the Markdown sees the
    # literal "&lt;" and needs to know to decode it too.
    s = html.unescape(s)
    # Docling emits U+E000 (Unicode Private Use Area) where the source had a
    # <br> inside a heading or cell -- 47 occurrences in the specialist manual.
    # It is a Docling line-break marker, not content, so treat it as whitespace.
    # Anything downstream that consumes the Markdown must strip PUA too.
    return re.sub("[\ue000-\uf8ff]", " ", s)


def squash(s: str) -> str:
    return re.sub(r"\s+", "", s)


def squash_join(s: str) -> str:
    """Squash whitespace AND hyphens, for artifact detection only.

    The source runs words together across a hyphen too
    ("SERVICESMÉDICO-ADMINISTRATIFS"), so the pieces are not contiguous in B
    unless the hyphen is removed as well.
    """
    return re.sub(r"[\s\-\u2010-\u2015]+", "", s).casefold()


# Normalize quote-ish characters before tokenizing. The source mixes ' ` and ’
# (e.g. "l`aromatase"), and Docling may render them differently — without this,
# the diff reports its own tokenization as missing content.
#
# Dashes are folded for the same reason: Docling converts the source's en/em
# dashes (U+2013 ×121, U+2014 ×23) to ASCII "-". That is an encoding choice, not
# data loss — "Addendum 7 – Microchirurgie" and "Addendum 7 - Microchirurgie"
# carry identical information — so folding both sides keeps the character-level
# report honest instead of showing 144 phantom losses.
#
# NBSP and narrow NBSP fold to a plain space: RAMQ uses them as thousands
# separators and before colons, and the two sides disagree on which.
_QUOTES = str.maketrans({
    "`": "'", "’": "'", "‘": "'", "´": "'",
    "–": "-", "—": "-", "‐": "-", "‑": "-", "‒": "-",
    " ": " ", " ": " ", " ": " ",
})


def pre(s: str) -> str:
    return s.translate(_QUOTES)


# Split on apostrophes so "l'aromatase" yields "aromatase" on both sides.
WORD = re.compile(r"[^\W\d_]{4,}", re.UNICODE)
CODE = re.compile(r"\b\d{5}\b")

# Monetary amounts — the payload of a tariff document, and until now tested by
# nothing here: WORD excludes digits and CODE only matches 5-digit act codes.
#
# Deliberately NOT anchored with \b. `\b\d{1,3},\d{2}` matches the "89,90" inside
# "589,90", which manufactures phantom losses. Require a true non-digit boundary
# on both sides instead. Thousands separators may be space, NBSP or narrow NBSP.
AMOUNT = re.compile(r"(?<![\d,])\d{1,3}(?:[   ]\d{3})*,\d{2}(?![\d,])")

# A decimal amount broken by injected whitespace: "89, 90" where the source had
# "89,90". This is what Docling emits when RAMQ wraps part of a number in an
# inline tag — `89,<font …>90</font>` becomes `89, 90`, because the inline
# element reads as a word boundary. squash() cannot see it (it strips all
# whitespace, making the two forms identical), so this must run on raw text.
SPLIT_AMOUNT = re.compile(r"(?<![\d,])(\d{1,3}(?:[   ]\d{3})*),[ \t  ]+(\d{2})(?![\d,])")


# HTML entities left unescaped by Docling's Markdown export. RAMQ writes clinical
# thresholds as `MMSE &lt; 23/30` / `(&gt; 5 médicaments)`; `#contenu`'s .text()
# decodes those to `<` and `>`, but docling.md keeps the raw entity. Any consumer
# reading the Markdown sees the literal string "&lt;" where the document means
# "<" — a corrupted billing condition, invisible to a whitespace-squashed diff.
ENTITY = re.compile(r"&(?:[a-zA-Z][a-zA-Z0-9]{1,10}|#\d{2,5}|#x[0-9a-fA-F]{2,5});")

# ATX headings, wherever they occur — including inside a table row, which is
# where this document's surviving headings often land. Not anchored to ^ for
# that reason; `(#{1,6})` is captured so levels can be tallied.
ATX = re.compile(r"(?:^|\|)\s*(#{1,6})\s+(.+?)\s*(?=\||$)", re.M)

# A Markdown table row. On this document that is most of the file: the manual's
# body is a single layout <table>, so the tariff grid arrives as table rows.
TABLE_ROW = re.compile(r"^\|", re.M)


def words(s: str) -> Counter[str]:
    return Counter(w.lower() for w in WORD.findall(pre(s)))


def nbsp(s: str) -> str:
    """Fold NBSP / narrow NBSP to a plain space so separators compare equal."""
    return s.replace(" ", " ").replace(" ", " ")


def amounts(s: str) -> Counter[str]:
    return Counter(AMOUNT.findall(nbsp(s)))


def codes(s: str) -> Counter[str]:
    return Counter(CODE.findall(s))


def missing_occurrences(a: Counter[str], b: Counter[str]) -> dict[str, tuple[int, int]]:
    """Tokens occurring FEWER times in B than in A.

    Set comparison cannot see this: if B kept one instance of every act code but
    dropped 500 occurrences, `set(a) == set(b)` still holds. For a billing
    document the count is the data.
    """
    return {k: (a[k], b[k]) for k in a if b[k] < a[k]}


def pct(n: int, d: int) -> str:
    return f"{100.0 * n / d:.1f}%" if d else "n/a"


def longest_missing_runs(src: str, dst_words: set[str], top: int = 8) -> list[str]:
    """Find the longest consecutive runs of source words absent from the Markdown.

    Isolated missing words are usually tokenization noise; a long consecutive run
    means a real passage was dropped.
    """
    toks = WORD.findall(src)
    runs: list[list[str]] = []
    cur: list[str] = []
    for t in toks:
        if t.lower() not in dst_words:
            cur.append(t)
        else:
            if len(cur) > 1:
                runs.append(cur)
            cur = []
    if len(cur) > 1:
        runs.append(cur)
    runs.sort(key=len, reverse=True)
    return [" ".join(r) for r in runs[:top]]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--html", type=Path,
                    default=Path("../src/manuel-specialistes-remuneration-acte.html"))
    ap.add_argument("--md", type=Path, default=Path("docling.md"))
    args = ap.parse_args()

    for p in (args.html, args.md):
        if not p.exists():
            print(f"Missing: {p}", file=sys.stderr)
            return 1

    src = contenu_text(args.html)
    # md_raw is the un-normalized text — the split-amount check needs it, since
    # decoding entities and folding PUA would mask injected spacing.
    md_raw = markdown_text(args.md)
    md = clean(md_raw)

    # pre() folds quotes, dashes and NBSP on BOTH sides, so the character-level
    # delta reports genuine differences rather than encoding choices.
    ssrc, smd = squash(pre(src)), squash(pre(md))
    wsrc, wmd = words(src), words(md)
    src_vocab, md_vocab = set(wsrc), set(wmd)

    csrc, cmd = set(CODE.findall(src)), set(CODE.findall(md))

    print("=" * 68)
    print("  A: #contenu text (source HTML)     B: docling.md")
    print("=" * 68)

    print("\n── VOLUME ──")
    print(f"  chars, whitespace-stripped   A {len(ssrc):>8}   B {len(smd):>8}"
          f"   (B/A {pct(len(smd), len(ssrc))})")
    print(f"  word tokens (4+ letters)     A {sum(wsrc.values()):>8}"
          f"   B {sum(wmd.values()):>8}")

    print("\n── VOCABULARY ──")
    kept = src_vocab & md_vocab
    print(f"  distinct words               A {len(src_vocab):>8}   B {len(md_vocab):>8}")
    print(f"  A's words present in B       {len(kept):>8} of {len(src_vocab)}"
          f"   ({pct(len(kept), len(src_vocab))})")
    lost = src_vocab - md_vocab
    if lost:
        # A source "word" like "torticoliscongénital" or "cabinetR" is a
        # concatenation artifact of the HTML (missing space between inline tags).
        # If B contains its pieces, nothing was lost — B split it *better*.
        # Classify rather than blaming Docling for the source's own mangling.
        # Case-fold both sides: the source concatenates across case boundaries
        # too ("THÉRAPEUTIQUESEN", "SERVICESMÉDICO-"), where B's pieces differ
        # in case or hyphenation from the run-together form.
        squashed_md = squash_join(pre(md))
        artifacts = {w for w in lost if squash_join(w) in squashed_md}
        real = lost - artifacts
        print(f"  concatenation artifacts       {len(artifacts):>8}"
              f"   (source ran words together; B's pieces are present)")
        print(f"  genuinely absent from B       {len(real):>8}")
        if real:
            by_freq = sorted(real, key=lambda w: -wsrc[w])
            print("    " + ", ".join(f"{w}({wsrc[w]})" for w in by_freq[:12]))
    added = md_vocab - src_vocab
    if added:
        print(f"  in B only (first 8):          " + ", ".join(sorted(added)[:8]))

    print("\n── RAMQ ACT CODES (5-digit) ──")
    print(f"  distinct codes               A {len(csrc):>8}   B {len(cmd):>8}")
    both = csrc & cmd
    print(f"  A's codes present in B       {len(both):>8} of {len(csrc)}"
          f"   ({pct(len(both), len(csrc))})")
    miss = sorted(csrc - cmd)
    if miss:
        print(f"  missing ({len(miss)}), first 15:      " + ", ".join(miss[:15]))

    # Occurrence counts, not just presence. The distinct-set check above passes
    # as long as one instance of each code survives, even if hundreds are lost.
    kcsrc, kcmd = codes(src), codes(md)
    code_dropped = missing_occurrences(kcsrc, kcmd)
    print(f"  total occurrences            A {sum(kcsrc.values()):>8}"
          f"   B {sum(kcmd.values()):>8}"
          f"   ({sum(kcmd.values()) - sum(kcsrc.values()):+})")
    print(f"  codes with fewer occurrences in B  {len(code_dropped):>3}"
          f"   (occurrences lost: "
          f"{sum(x - y for x, y in code_dropped.values())})")
    if code_dropped:
        for k, (x, y) in sorted(code_dropped.items(),
                                key=lambda kv: kv[1][0] - kv[1][1],
                                reverse=True)[:10]:
            print(f"    {k}: A={x} B={y}")

    # --- Monetary amounts: the payload, previously untested -------------------
    asrc, amd = amounts(src), amounts(md)
    amt_dropped = missing_occurrences(asrc, amd)
    print("\n── MONETARY AMOUNTS (French decimal comma) ──")
    print(f"  distinct amounts             A {len(asrc):>8}   B {len(amd):>8}")
    print(f"  total occurrences            A {sum(asrc.values()):>8}"
          f"   B {sum(amd.values()):>8}"
          f"   ({sum(amd.values()) - sum(asrc.values()):+})")
    print(f"  amounts with fewer occurrences in B  {len(amt_dropped):>3}"
          f"   (occurrences lost: "
          f"{sum(x - y for x, y in amt_dropped.values())})")
    for k, (x, y) in sorted(amt_dropped.items(),
                            key=lambda kv: kv[1][0] - kv[1][1],
                            reverse=True)[:10]:
        print(f"    {k}: A={x} B={y}")

    # --- Amounts corrupted by injected whitespace ----------------------------
    # Runs on RAW text, before squash(). squash() strips all whitespace, so
    # "89,90" and "89, 90" collapse to the same string and this defect is
    # invisible to every other check in this file.
    src_splits = SPLIT_AMOUNT.findall(nbsp(src))
    md_splits = SPLIT_AMOUNT.findall(nbsp(md_raw))
    # Only count a split as damage if the joined value exists in A but the split
    # form does not — otherwise French legal citations ("Articles 28 1, 2, 3, 44
    # 2, 45 2") register as false positives.
    injected = []
    for whole, cents in md_splits:
        joined = f"{whole},{cents}"
        if joined in asrc and (whole, cents) not in src_splits:
            injected.append((f"{whole}, {cents}", joined))
    print("\n── AMOUNTS SPLIT BY INJECTED WHITESPACE ──")
    print(f"  'N, NN' occurrences          A {len(src_splits):>8}"
          f"   B {len(md_splits):>8}")
    print(f"  amounts corrupted in B       {len(injected):>8}")
    for got, want in injected[:10]:
        print(f"    B has {got!r} where A has {want!r}")
    if not injected:
        print("  (none — no amount gained a space after its decimal comma)")

    # --- HTML entities surviving into the export ------------------------------
    ents = Counter(ENTITY.findall(md_raw))
    print("\n── UNESCAPED HTML ENTITIES IN B ── (informational)")
    print(f"  entity occurrences           A {len(ENTITY.findall(src)):>8}"
          f"   B {sum(ents.values()):>8}")
    if ents:
        print("  " + ", ".join(f"{e}×{n}" for e, n in ents.most_common(8)))
        print("  RAMQ writes clinical thresholds as 'MMSE &lt; 23/30'. Decoded"
              " before comparison,")
        print("  so this is not data loss — but any consumer of the Markdown"
              " must html.unescape() too.")
    else:
        print("  (none)")

    print("\n── LONGEST DROPPED PASSAGES ──")
    real_lost = {w for w in (src_vocab - md_vocab)
                 if squash_join(w) not in squash_join(pre(md))}
    runs = longest_missing_runs(pre(src), md_vocab | (src_vocab - real_lost))
    if not runs:
        print("  (none — no multi-word run of A is absent from B)")
    for r in runs:
        n = len(r.split())
        print(f"  [{n:>3} words] {r[:150]}{'…' if len(r) > 150 else ''}")

    # --- Section identity: the axis that actually decides usability ----------
    # This is the one structural check, and on Markdown it is necessarily weak.
    # An ATX heading is all that survives -- which cell a title came from, and
    # what nesting level it had, are gone before this script sees the file. So
    # this reports a floor, not a measurement: headings Markdown kept, not
    # sections Docling found.
    headings = ATX.findall(md_raw)
    levels = Counter(len(h) for h, _ in headings)
    distinct = {re.sub(r"\s+", " ", t).strip().casefold() for _, t in headings}
    # A heading emitted INSIDE a table row is the structural defect made visible:
    # `| | | ## **LÈVRES** |` is a section title trapped in a layout-table cell.
    in_table = len(re.findall(r"^\|.*?#{1,6}\s", md_raw, re.M))
    # Split the two, because only the first kind is a usable heading. A heading
    # at line start is one Markdown structure genuinely recovered; a heading in
    # a table cell is a section title that a Markdown parser will never see as
    # a heading at all. Reporting only the total would flatter the result.
    top_level = len(re.findall(r"^#{1,6}\s", md_raw, re.M))
    print("\n── SECTION IDENTITY ──")
    print(f"  ATX headings, total          {len(headings):>8}"
          f"   ({len(distinct)} distinct)")
    print(f"    at line start (usable)     {top_level:>8}")
    if levels:
        print("  by level: "
              + ", ".join(f"H{k}={v}" for k, v in sorted(levels.items())))
    print(f"  headings inside a table row  {in_table:>8}"
          f"   (section titles trapped in layout-table cells)")
    table_rows = len(TABLE_ROW.findall(md_raw))
    print(f"  markdown table rows          {table_rows:>8}")
    print("  (compare against the 393 RAMQ nav sections steps 1-3 recover)")
    print("  NOTE: Markdown cannot express a heading's nesting level or origin")
    print("  cell. This is a floor on structure recovered, NOT part of the"
          " verdict.")

    text_ok = not real_lost
    codes_ok = not miss
    code_occ_ok = not code_dropped
    amounts_ok = not amt_dropped
    split_ok = not injected
    verdict = "PASS" if (text_ok and codes_ok and code_occ_ok and amounts_ok
                         and split_ok) else "FAIL"
    print(f"\n  Text conservation (compareString-equivalent): "
          f"{'PASS' if text_ok else 'FAIL'}")
    print(f"  Act-code conservation (distinct):             "
          f"{'PASS' if codes_ok else 'FAIL'}")
    print(f"  Act-code conservation (occurrences):          "
          f"{'PASS' if code_occ_ok else 'FAIL'}")
    print(f"  Amount conservation (occurrences):            "
          f"{'PASS' if amounts_ok else 'FAIL'}")
    print(f"  Amounts intact (no injected whitespace):      "
          f"{'PASS' if split_ok else 'FAIL'}")
    print(f"  (HTML entities in B, decoded not lost:         "
          f"{sum(ents.values())})")
    print(f"  → overall: {verdict}")
    print("=" * 68)
    return 0 if verdict == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
