"""Stage 1 — emit a `DoclingDocument` as a flat reading-order token stream.

    docling.doc.json  ──iterate_items──►  tokens.jsonl

This is the format-agnostic seam. Everything upstream of this file knows about
Docling; everything downstream reads `tokens.jsonl` and knows nothing about
where the document came from. A PDF *lettre d'entente* becomes a track B input
by producing this shape, not by growing a new track.

WHAT A TOKEN IS

One non-empty cell, or one non-table text item, in `iterate_items()` order.
Empty cells are dropped — which is the whole reason this path beats the Markdown
one. RAMQ's manual body is a layout table whose column 0 is empty in 748 of 749
rows of `L - Système digestif`; in Markdown that is 748 literal `| |` noise
cells, and here it simply does not occur.

WHAT IS DELIBERATELY NOT EMITTED

`start_col_offset_idx`. Row identity is kept because "these tokens are on the
same line" is true information. A column index is not information — it is an
inference, and on this document it is the *nearly*-stable kind: act codes sit in
column 1 in 5,923 rows and somewhere else in 4. A consumer that reads column 1
as "the act code" is right 99.93% of the time and silently wrong the rest, which
is how track A's coupling gets rebuilt inside track B with extra steps. The
field is therefore not in the seam at all, so nothing downstream can reach for
it. Provenance is `table` + `row` + `ref`, which locates a cell exactly without
claiming to know what it means.

THE DOCUMENT IS EMITTED TWICE, AND THAT HAS TO BE HANDLED HERE

This is the one thing about the model that is not obvious and that nothing
downstream could recover on its own. Every table region appears in the stream in
two representations, back to back:

    …cells of #/tables/1148…            ← the table view: whole cells, in order
    …the inline runs of those cells…    ← the text view: the SAME content,
                                           fragmented into 'AVIS' / ':' / '…'

`LÈVRES` is a cell at stream index 35,297, in its correct position 16 tokens
before act code 05320 — and *also* a `section_header` text item at index 36,940,
1,600 tokens after the codes it governs. Scoping act codes off the section_header
items alone would therefore attach almost every record to the wrong section.

Measured: 12,740 of 15,095 text items are reachable from some cell's `ref`, i.e.
are that duplicate view — including 2,208 of the 2,221 act-code-shaped text
items and 245 of the 335 section_headers. Only 13 act codes and 90 headings live
outside a table, in genuine prose regions.

Both facts are Docling-shaped, so both are resolved here rather than downstream:

  - `dup: true` marks a text item as the inline-run view of a cell. Nothing is
    dropped — the seam stays lossless — but a consumer reading act records wants
    `dup` filtered out, and after filtering the remaining stream is still in
    correct reading order.
  - `label` / `level` are PROPAGATED ONTO THE CELL when a cell's runs resolve to
    a `section_header`. That is what makes the in-position `LÈVRES` cell
    recognisable as a heading without guessing from bold-and-all-caps.

WHAT IS EMITTED, AND WHY EACH FIELD IS DOCLING'S CLAIM AND NOT OURS

    text     normalized cell / item text (see NORMALIZATION)
    kind     "cell" | "text"
    label    Docling's label — for a text item, its own; for a cell, the label
             of the structural item its runs resolve to (section_header only)
    level    heading level, for section_header items and heading cells
    depth    HEADINGS ONLY: traversal depth in the document model, which is what
             ranks them. `level` cannot: Docling reports 326 of 335 headings as
             level 1. See `heading_depths()` for the measurement and for what
             depth deliberately does not tell you.
    table    self_ref of the containing table, for cells
    row      start_row_offset_idx — "these tokens share a line"
    header   Docling marked this cell as a column header
    dup      this text item is the inline-run view of a cell already emitted
    italic   every formatted run in this cell/item is italic
    bold     every formatted run in this cell/item is bold
    span     [row_span, col_span], only when not 1×1 (67 cells document-wide)
    ref      #/groups/N cell backlink, or the item's own self_ref

`header` and `italic` are the two that earn their place. `header` is how a table
declares its own value semantics in-band (`R = 1` = a dollar tariff, `R = 2` =
a count of *unités de base*), and Docling flags those cells itself — 57 tables
on the specialist manual, in exactly three vocabularies. `italic` is how the
document marks an act family (`Excision`, `Réparation`), which is a real cell
with no label of its own; without the formatting run there is no way to tell it
from a description.

NORMALIZATION

Applied here because it is Docling-shaped, not RAMQ-shaped:

  - PUA U+E000–U+F8FF → space. Docling's line-break marker; 44 text items carry
    it, including inside heading text (`RÈGLE 1.  PAIEMENT`).
  - `html.unescape()`. Currently a no-op — the document model holds 0 entities
    on this file, unlike the Markdown export, where RAMQ's `MMSE &lt; 23/30`
    survives raw. Kept because a differently-produced HTML source may need it.
  - whitespace collapsed to single spaces, ends stripped. Slot declarations
    arrive as `'Établissement \nR = 1'`; the amounts' thousands separator is a
    plain U+0020 (621 occurrences, no NBSP), so this does not touch values.

Usage:
    python emit_tokens.py [--doc docling.doc.json] [--out tokens.jsonl]
                          [--expect-stream N] [--expect-act-codes N]
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Iterator

from docling_core.types.doc import DoclingDocument

from to_json import load_cached

DEFAULT_DOC = Path("docling.doc.json")
DEFAULT_OUT = Path("tokens.jsonl")

PUA = re.compile(r"[-]")
WS = re.compile(r"\s+")

# Used ONLY to report a count for the gate below — never to shape the stream.
# Stage 2 owns typing; see ../ingester/stages/type.ts.
ACT_CODE_SHAPE = re.compile(r"^\d{5}$")


def normalize(s: str) -> str:
    return WS.sub(" ", html.unescape(PUA.sub(" ", s))).strip()


def _leaves(doc: DoclingDocument, node: Any, out: list[Any],
            depth: int = 0) -> None:
    """Collect every leaf item under `node`. Real depth here is 1-2."""
    if depth > 8:  # cheap cycle / deep-nest guard
        return
    children = getattr(node, "children", None) or []
    if not children:
        out.append(node)
        return
    for child in children:
        try:
            resolved = child.resolve(doc)
        except (AttributeError, KeyError, IndexError):
            continue
        _leaves(doc, resolved, out, depth + 1)


def _formatting_flags(runs: list[Any]) -> dict[str, bool]:
    """`italic`/`bold` iff EVERY formatted run agrees.

    All-runs rather than any-run: a description with one emphasised word is not
    an act family, and `italic` is what stage 2 uses to call something a FAMILY.
    """
    formats = [f for f in (getattr(r, "formatting", None) for r in runs)
               if f is not None]
    if not formats:
        return {}
    flags: dict[str, bool] = {}
    if all(getattr(f, "italic", False) for f in formats):
        flags["italic"] = True
    if all(getattr(f, "bold", False) for f in formats):
        flags["bold"] = True
    return flags


def _structural_label(runs: list[Any],
                      depths: dict[str, int] | None = None) -> dict[str, Any]:
    """Propagate a heading label from a cell's runs up onto the cell itself.

    A cell whose content resolves to a `section_header` IS the in-position
    occurrence of that heading — the standalone `section_header` text item for
    the same title arrives ~1,600 tokens later (see the module docstring). This
    is the only reason stage 2 can keep the honest `label == section_header`
    test instead of guessing at bold-and-all-caps.

    `depth` comes from `depths`, keyed by the RUN's self_ref rather than the
    cell's. The cell's own traversal depth is the depth of its table, which is
    the same for every cell in that table and says nothing about the heading.
    """
    for run in runs:
        if str(getattr(run, "label", "")) == "section_header":
            out: dict[str, Any] = {"label": "section_header"}
            level = getattr(run, "level", None)
            if level is not None:
                out["level"] = level
            if depths is not None:
                depth = depths.get(getattr(run, "self_ref", "") or "")
                if depth is not None:
                    out["depth"] = depth
            return out
    return {}


def heading_depths(doc: DoclingDocument) -> dict[str, int]:
    """Traversal depth of every `section_header`, by self_ref.

    THE SIGNAL THAT WAS BEING DISCARDED

    Docling reports 326 of 335 headings as `level: 1`, so the flat `level` field
    cannot rank them: `L - Système digestif` and `LÈVRES` arrive as siblings.
    Reconstructing the tree therefore looked like it had to be naming knowledge,
    and it is what `profiles/*.json` spends most of its lines on.

    But the ranking signal exists in the document model, and `iterate_items()`
    hands it over on every call as the second element of the tuple — which this
    file used to throw away as `_level`. Measured on the specialist manual:

        depth 2   85 headings    A - Préambule général, RÈGLE 1. PAIEMENT
        depth 3    5 headings    ANNEXE 1, CAS COMPLEXES
        depth 5  237 headings    ALLERGIE, LÈVRES, PROCRÉATION ASSISTÉE
        depth 6    8 headings    NÉPHROLOGIE, OPHTALMOLOGIE

    That is two containment tiers, and it agrees with the hand-written profile on
    every heading checked. Verified equal to the parent-chain length, so it is
    the document model's own nesting and not an artifact of traversal order.

    WHAT IT DOES NOT GIVE

    Ranking, never semantics. All 14 `ADDENDUM` headings sit at depth 2, the same
    tier as the letter chapters they belong under, so the addendum→chapter
    relationship stays naming knowledge. Depth says which heading CONTAINS
    another; it cannot say what either one IS.

    This is a document fact — "a heading nested deeper is subordinate to one
    nested shallower" — not a RAMQ fact, which is why it belongs on this side of
    the seam and reduces the profile's coupling rather than adding to it.
    """
    return {
        item.self_ref: level
        for item, level in doc.iterate_items()
        if str(item.label) == "section_header" and item.self_ref
    }


def duplicate_refs(doc: DoclingDocument) -> set[str]:
    """self_refs of the text items that are the inline-run view of some cell.

    12,740 of 15,095 on the specialist manual. See the module docstring: these
    are not extra content, they are the same content a second time, and they
    arrive *after* the act codes they would otherwise scope.
    """
    dup: set[str] = set()
    for table in doc.tables:
        for cell in table.data.table_cells:
            ref = getattr(cell, "ref", None)
            if ref is None:
                continue
            runs: list[Any] = []
            try:
                _leaves(doc, ref.resolve(doc), runs)
            except (AttributeError, KeyError, IndexError):
                continue
            for run in runs:
                self_ref = getattr(run, "self_ref", None)
                if self_ref:
                    dup.add(self_ref)
    return dup


def emit(doc: DoclingDocument) -> Iterator[dict[str, Any]]:
    dup = duplicate_refs(doc)
    depths = heading_depths(doc)
    index = 0
    for item, level in doc.iterate_items():
        if str(item.label) == "table":
            table_ref = item.self_ref
            for cell in item.data.table_cells:
                text = normalize(cell.text or "")
                if not text:
                    continue
                token: dict[str, Any] = {
                    "i": index,
                    "kind": "cell",
                    "text": text,
                    "table": table_ref,
                    "row": cell.start_row_offset_idx,
                }
                if cell.column_header or cell.row_header:
                    token["header"] = True
                if cell.row_span != 1 or cell.col_span != 1:
                    token["span"] = [cell.row_span, cell.col_span]
                # `ref` is an EXTRA field on TableCell, not a declared one: it
                # exists only where the cell's content came from formatted
                # inline runs (7,605 of 28,760 cells). getattr, not cell.ref.
                ref = getattr(cell, "ref", None)
                if ref is not None:
                    token["ref"] = ref.cref
                    runs: list[Any] = []
                    try:
                        _leaves(doc, ref.resolve(doc), runs)
                    except (AttributeError, KeyError, IndexError):
                        runs = []
                    runs = [r for r in runs
                            if (getattr(r, "text", "") or "").strip()]
                    token.update(_structural_label(runs, depths))
                    token.update(_formatting_flags(runs))
                yield token
                index += 1
            continue

        text = normalize(getattr(item, "text", "") or "")
        if not text:
            continue
        token = {
            "i": index,
            "kind": "text",
            "text": text,
            "label": str(item.label),
            "ref": item.self_ref,
        }
        own_level = getattr(item, "level", None)
        if own_level is not None:
            token["level"] = own_level
        # Only on headings. Every cell of a table shares the table's traversal
        # depth, so emitting it on cells would put a number in the seam that looks
        # like structure and is really just "which table am I in" — an invitation
        # to the same positional reasoning `start_col_offset_idx` is kept out for.
        if str(item.label) == "section_header":
            token["depth"] = level
        if item.self_ref in dup:
            token["dup"] = True
        token.update(_formatting_flags([item]))
        yield token
        index += 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--doc", type=Path, default=DEFAULT_DOC)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--expect-stream", type=int, default=None,
                    help="gate: exact stream length (document-specific, so it "
                         "is passed in rather than hardcoded here)")
    ap.add_argument("--expect-act-codes", type=int, default=None,
                    help="gate: exact count of ^\\d{5}$ tokens")
    args = ap.parse_args()

    if not args.doc.exists():
        print(f"Missing {args.doc} — run `npm run b:json` first", file=sys.stderr)
        return 1

    t0 = time.perf_counter()
    doc = load_cached(args.doc)
    print(f"→ loaded {args.doc} in {time.perf_counter() - t0:.1f}s")

    stats: Counter[str] = Counter()
    with args.out.open("w", encoding="utf-8") as fh:
        for token in emit(doc):
            fh.write(json.dumps(token, ensure_ascii=False) + "\n")
            stats[token["kind"]] += 1
            if token["kind"] == "text":
                stats["label:" + token["label"]] += 1
            if token.get("header"):
                stats["header"] += 1
            if token.get("italic"):
                stats["italic"] += 1
            if token.get("dup"):
                stats["dup"] += 1
            if token.get("label") == "section_header":
                stats["heading"] += 1
                if not token.get("dup"):
                    stats["heading_live"] += 1
            if ACT_CODE_SHAPE.match(token["text"]):
                stats["act_code_shaped"] += 1
                if not token.get("dup"):
                    stats["act_code_live"] += 1

    total = stats["cell"] + stats["text"]
    live = total - stats["dup"]
    print(f"  wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")
    print(f"  stream items                 {total:>8}")
    print(f"    cells                      {stats['cell']:>8}")
    print(f"    text items                 {stats['text']:>8}   "
          + ", ".join(f"{k[6:]}={v}" for k, v in sorted(stats.items())
                      if k.startswith("label:")))
    print(f"  inline-run duplicates (dup)  {stats['dup']:>8}")
    print(f"  after dropping duplicates    {live:>8}")
    print(f"  act-code-shaped (^\\d{{5}}$)    {stats['act_code_shaped']:>8}"
          f"   ({stats['act_code_live']} live)")
    print(f"  headings                     {stats['heading']:>8}"
          f"   ({stats['heading_live']} live, in reading-order position)")
    print(f"  slot-declaration cells       {stats['header']:>8}")
    print(f"  fully-italic tokens          {stats['italic']:>8}")

    failures = []
    if args.expect_stream is not None and total != args.expect_stream:
        failures.append(f"stream items: expected {args.expect_stream}, got {total}")
    if (args.expect_act_codes is not None
            and stats["act_code_shaped"] != args.expect_act_codes):
        failures.append(f"act-code-shaped tokens: expected "
                        f"{args.expect_act_codes}, got {stats['act_code_shaped']}")
    for f in failures:
        print(f"  FAIL  {f}", file=sys.stderr)
    if failures:
        return 2
    if args.expect_stream is not None:
        print("  → gates PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
