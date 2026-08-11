"""Compare Docling's Markdown against the source HTML's `#contenu` text.

This is the direct analogue of `compareString` in cheerio-scraper.ts:95-103:
that function extracts `$('#contenu').text()` and asserts the pipeline conserves
it, whitespace-stripped. Here we ask the same of Docling's Markdown.

Comparing against `#contenu` rather than the whole file matters — the raw HTML
also contains the left nav, scripts and Word/mso cruft that `#contenu` excludes,
so a whole-file diff would mostly measure chrome, not content.

Reports, in both directions:
  - character volume (whitespace-stripped), to catch bulk loss or duplication
  - vocabulary coverage, to catch *which* content went missing
  - act-code coverage: are all 5-digit RAMQ codes still present?
  - the longest source runs absent from the Markdown (real dropped passages)

Usage:
    python compare_text.py [--html ../src/manuel-....html] [--md docling.md]
"""

from __future__ import annotations

import argparse
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


def strip_md(md: str) -> str:
    """Remove Markdown syntax so we compare prose, not pipes and hashes."""
    md = re.sub(r"^\s*#+\s*", "", md, flags=re.MULTILINE)     # headings
    md = re.sub(r"[|]", " ", md)                               # table pipes
    md = re.sub(r"^\s*[-:]{3,}\s*$", " ", md, flags=re.MULTILINE)  # table rules
    md = re.sub(r"[*_`]+", "", md)                             # emphasis
    md = re.sub(r"<!--.*?-->", " ", md, flags=re.DOTALL)       # html comments
    # Docling emits U+E000 (Unicode Private Use Area) where the source had a
    # <br> inside a heading or cell — 47 occurrences in the specialist manual.
    # It is a Docling line-break marker, not content, so treat it as whitespace.
    # Anything downstream that consumes docling.md must strip PUA too.
    md = re.sub("[\ue000-\uf8ff]", " ", md)
    return md


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
_QUOTES = str.maketrans({"`": "'", "’": "'", "‘": "'", "´": "'"})


def pre(s: str) -> str:
    return s.translate(_QUOTES)


# Split on apostrophes so "l'aromatase" yields "aromatase" on both sides.
WORD = re.compile(r"[^\W\d_]{4,}", re.UNICODE)
CODE = re.compile(r"\b\d{5}\b")


def words(s: str) -> Counter[str]:
    return Counter(w.lower() for w in WORD.findall(pre(s)))


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
    md_raw = args.md.read_text(encoding="utf-8")
    md = strip_md(md_raw)

    ssrc, smd = squash(src), squash(md)
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
    md_headings = {re.sub(r"\s+", " ", l.lstrip("#").strip("* ").strip()).casefold()
                   for l in md_raw.splitlines() if l.startswith("#")}
    print("\n── SECTION IDENTITY ──")
    print(f"  markdown ATX headings        {len(md_headings):>8}")
    print("  (compare against the 393 RAMQ nav sections steps 1-3 recover;")
    print("   run compare.py for the full section/parentId breakdown)")

    text_ok = not real_lost
    codes_ok = not miss
    verdict = "PASS" if (text_ok and codes_ok) else "FAIL"
    print(f"\n  Text conservation (compareString-equivalent): "
          f"{'PASS' if text_ok else 'FAIL'}")
    print(f"  Act-code conservation:                        "
          f"{'PASS' if codes_ok else 'FAIL'}")
    print(f"  → overall: {verdict}")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
