"""Dump a document to Markdown via Docling, with no MediLedger logic applied.

Deliberately dumber than ingest.py: no sectioning heuristic, no tariff regex,
no synthesized IDs. Just Docling's own `export_to_markdown()`, so what you read
is what Docling actually produces — useful for eyeballing whether the structure
is there at all before deciding how to consume it.

Also writes the raw DoclingDocument JSON, which is the real API surface any
future ingester would build on.

Usage:
    python to_markdown.py <input.html|input.pdf> [-o docling.md]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

from docling.document_converter import DocumentConverter


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=Path("docling.md"))
    ap.add_argument("--json", action="store_true",
                    help="also dump the DoclingDocument as JSON")
    args = ap.parse_args()

    if not args.input.exists():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    print(f"→ converting {args.input.name} "
          f"({args.input.stat().st_size / 1e6:.1f} MB)")
    t0 = time.perf_counter()
    doc = DocumentConverter().convert(str(args.input)).document
    print(f"  converted in {time.perf_counter() - t0:.1f}s")

    md = doc.export_to_markdown()
    args.output.write_text(md, encoding="utf-8")

    # What item types did Docling actually find? This is the honest inventory.
    labels: Counter[str] = Counter()
    heading_levels: Counter[int] = Counter()
    for item, _ in doc.iterate_items():
        label = getattr(item, "label", None)
        labels[str(getattr(label, "value", label))] += 1
        if str(getattr(label, "value", label)) == "section_header":
            heading_levels[int(getattr(item, "level", 0) or 0)] += 1

    print(f"\n✅ {args.output}  ({len(md) / 1e6:.2f} MB, "
          f"{md.count(chr(10)) + 1} lines)")
    print(f"   markdown headings: {sum(1 for l in md.splitlines() if l.startswith('#'))}")
    print(f"   markdown tables:   {sum(1 for l in md.splitlines() if l.lstrip().startswith('|'))} rows")
    print("\n   Docling item inventory:")
    for label, n in labels.most_common():
        print(f"     {label:<22} {n:>7}")
    if heading_levels:
        print("   section_header levels: "
              + ", ".join(f"L{k}={v}" for k, v in sorted(heading_levels.items())))

    if args.json:
        jpath = args.output.with_suffix(".doc.json")
        jpath.write_text(
            json.dumps(doc.export_to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\n📄 {jpath.name} ({jpath.stat().st_size / 1e6:.1f} MB)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
