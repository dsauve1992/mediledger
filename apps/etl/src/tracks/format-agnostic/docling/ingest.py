"""Docling ingester for RAMQ documents — experimental alternative to ETL steps 1-4.

Emits the same shape as `modified-content.json` so the output is directly
comparable (see compare.py) and, in principle, consumable by step 5:

    [{ "id": str|None, "parentId": str|None, "name": str,
       "content": [ str | {code, description, amount_facility, ...} ] }]

Sectioning strategy: Docling gives us a flat item stream with heading levels,
not RAMQ's nav-derived anchor tree. We reconstruct sections by cutting the
stream at each heading and tracking a heading-level stack for parentId. This is
the fundamental difference from steps 1-3, which key off `#<anchorId>`.

Usage:
    python ingest.py <input.html|input.pdf> [-o docling-content.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

from docling.document_converter import DocumentConverter
from docling_core.types.doc import (
    DocItemLabel,
    SectionHeaderItem,
    TableItem,
    TextItem,
    TitleItem,
)

# --- Domain parsing (mirrors 4-sanitize-html/index.ts:56-70) -----------------
# A RAMQ tariff row: 5-digit act code, description, then 1-3 amounts.
# French formatting: decimal comma, thin/nbsp thousands separators ("1 043,25").
_FLOAT = r"(?:\d{1,3}(?:[   ]\d{3})+|\d+)[.,]\d+"
_TARIFF_ROW = re.compile(
    rf"^\s*(\d{{5}})\s+(.+?)\s+({_FLOAT})(?:\s+({_FLOAT}))?(?:\s+(\d+))?\s*$",
    re.UNICODE,
)


def _to_number(raw: str | None) -> float | None:
    if raw is None:
        return None
    return float(raw.replace(" ", "").replace(" ", "").replace(" ", "").replace(",", "."))


def parse_tariff_row(text: str) -> dict[str, Any] | None:
    """Parse one tariff line into a typed dict, or None if it isn't one."""
    m = _TARIFF_ROW.match(text.replace(" ", " ").strip())
    if not m:
        return None
    code, description, facility, cabinet, r2 = m.groups()
    out: dict[str, Any] = {
        "code": code,
        "description": description.strip(),
        "amount_facility": _to_number(facility),
    }
    if cabinet is not None:
        out["amount_cabinet"] = _to_number(cabinet)
    if r2 is not None:
        out["amount_r2"] = int(r2)
    return out


def normalize_whitespace(s: str) -> str:
    return re.sub(r"[ \t  ]+", " ", s).strip()


# --- Table handling ---------------------------------------------------------

def table_to_blocks(item: TableItem, doc) -> list[Any]:
    """Turn a Docling table into tariff dicts where possible, else text rows.

    Docling exposes tables as a grid; we join each row's cells with spaces and
    run the same tariff regex step 4 uses. This is the direct analogue of
    step 4's `tbody > tr` walk.
    """
    blocks: list[Any] = []
    try:
        grid = item.data.grid
    except Exception:
        grid = None

    if not grid:
        text = normalize_whitespace(item.text or "")
        return [text] if text else []

    seen_spans: set[int] = set()
    for row in grid:
        cells: list[str] = []
        for cell in row:
            # Row/col spans repeat the same cell object across the grid.
            cid = id(cell)
            if cid in seen_spans:
                continue
            seen_spans.add(cid)
            txt = normalize_whitespace(getattr(cell, "text", "") or "")
            if txt:
                cells.append(txt)
        if not cells:
            continue
        line = normalize_whitespace(" ".join(cells))
        parsed = parse_tariff_row(line)
        blocks.append(parsed if parsed else line)
    return blocks


# --- Section reconstruction -------------------------------------------------

_HEADING_LABELS = {DocItemLabel.SECTION_HEADER, DocItemLabel.TITLE}


def build_sections(doc) -> list[dict[str, Any]]:
    """Cut the flat Docling item stream into sections at each heading.

    Maintains a (level -> heading name) stack so each section gets a parentId,
    matching the parentId semantics of steps 1-3 (which get it free from nav).
    """
    sections: list[dict[str, Any]] = []
    # Preamble bucket for content before the first heading.
    current: dict[str, Any] = {"id": None, "parentId": None, "name": "", "content": []}
    stack: list[tuple[int, str]] = []  # (level, name)
    seq = 0

    for item, _level in doc.iterate_items():
        label = getattr(item, "label", None)

        if isinstance(item, (SectionHeaderItem, TitleItem)) or label in _HEADING_LABELS:
            name = normalize_whitespace(getattr(item, "text", "") or "")
            if not name:
                continue
            if current["content"] or current["name"]:
                sections.append(current)

            heading_level = 0 if isinstance(item, TitleItem) else int(getattr(item, "level", 1) or 1)
            while stack and stack[-1][0] >= heading_level:
                stack.pop()
            parent_id = stack[-1][1] if stack else None
            stack.append((heading_level, name))

            seq += 1
            current = {
                # Docling has no RAMQ anchor IDs — we can only synthesize.
                "id": f"docling-{seq}",
                "parentId": parent_id,
                "name": name,
                "content": [],
                "_level": heading_level,
            }
            continue

        if isinstance(item, TableItem):
            current["content"].extend(table_to_blocks(item, doc))
            continue

        if isinstance(item, TextItem):
            txt = normalize_whitespace(item.text or "")
            if txt:
                parsed = parse_tariff_row(txt)
                current["content"].append(parsed if parsed else txt)

    if current["content"] or current["name"]:
        sections.append(current)
    return sections


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path, help="source .html or .pdf")
    ap.add_argument("-o", "--output", type=Path, default=Path("docling-content.json"))
    args = ap.parse_args()

    if not args.input.exists():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    print(f"→ converting {args.input.name} ({args.input.stat().st_size / 1e6:.1f} MB)")
    t0 = time.perf_counter()
    result = DocumentConverter().convert(str(args.input))
    convert_s = time.perf_counter() - t0
    print(f"  converted in {convert_s:.1f}s")

    doc = result.document
    sections = build_sections(doc)

    n_tariff = sum(1 for s in sections for c in s["content"] if isinstance(c, dict))
    n_text = sum(1 for s in sections for c in s["content"] if isinstance(c, str))

    args.output.write_text(
        json.dumps(sections, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    meta = {
        "source": str(args.input),
        "convert_seconds": round(convert_s, 2),
        "sections": len(sections),
        "tariff_blocks": n_tariff,
        "text_blocks": n_text,
    }
    meta_path = args.output.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"✅ {len(sections)} sections, {n_tariff} tariff blocks, {n_text} text blocks")
    print(f"📄 {args.output}  (+ {meta_path.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
