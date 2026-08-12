"""Dump a document to Markdown via Docling, with no MediLedger logic applied.

One hop, done by Docling itself:

    input.html  ──convert──►  DoclingDocument  ──export_to_markdown──►  docling.md

Markdown is lossy for this document in a way that matters. RAMQ's manual body is
one giant `<table>` used for page layout, so of the headings Docling emits only
91 land where a Markdown parser can see them — 236 more are trapped *inside*
table cells (`| | | ## **LÈVRES** |`), against RAMQ's 393 nav sections. Nested
`<table class="avis">` advisories flatten into prose for the same reason.

This file deliberately does the honest thing rather than the aspirational one:
it emits what it actually emits. See the README for where that leaves track B.

Deliberately minimal otherwise: no sectioning heuristic, no tariff regex, no
synthesized IDs.

Usage:
    python to_md.py <input.html|input.pdf>
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from docling.document_converter import DocumentConverter

MARKDOWN_OUTPUT = Path("docling.md")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path)
    args = ap.parse_args()

    if not args.input.exists():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    converter = DocumentConverter()

    print(f"→ converting {args.input.name} "
          f"({args.input.stat().st_size / 1e6:.1f} MB) → markdown")
    t0 = time.perf_counter()
    doc = converter.convert(str(args.input)).document
    print(f"  converted in {time.perf_counter() - t0:.1f}s")

    MARKDOWN_OUTPUT.write_text(doc.export_to_markdown(), encoding="utf-8")
    print(f"  wrote {MARKDOWN_OUTPUT} "
          f"({MARKDOWN_OUTPUT.stat().st_size / 1e6:.1f} MB)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
