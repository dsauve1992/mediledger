"""Convert a document with Docling and cache the `DoclingDocument` as JSON.

    input.html  ──convert──►  DoclingDocument  ──model_dump_json──►  docling.doc.json

This is the sibling of `to_md.py`, and it exists because Markdown is the wrong
target for this document while the document model is the right one:

    docling.md                            docling.doc.json
    ────────────────────────────────      ──────────────────────────────
    91 headings a parser can see          335 section_header items
    314 tables (merged at export)         1,300 tables
    1 amount corrupted (`89, 90`)         0 of 6,570 corrupted
    749 blank layout cells in one         empty cells simply do not
      section, as literal `| |` noise       appear in the cell stream

Nothing is inferred here — this stage is a cache, not an ingester. The one hop
is Docling's own `convert()`; the JSON is `DoclingDocument.model_dump_json()`
verbatim, so anything downstream reads Docling's model rather than our reading
of it.

Caching matters because conversion is ~27 s and the stages built on top of it
are iterated on constantly. Reloading the cache is ~1.4 s. Pass `--force` to
reconvert.

Usage:
    python to_json.py <input.html|input.pdf> [--out docling.doc.json] [--force]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from docling.document_converter import DocumentConverter
from docling_core.types.doc import DoclingDocument

DEFAULT_OUTPUT = Path("docling.doc.json")


def load_cached(path: Path) -> DoclingDocument:
    """Reload a cached document. ~1.4 s, against ~27 s to reconvert."""
    return DoclingDocument.model_validate_json(path.read_text(encoding="utf-8"))


def convert(input_path: Path) -> DoclingDocument:
    return DocumentConverter().convert(str(input_path)).document


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    ap.add_argument("--force", action="store_true",
                    help="reconvert even if the cache exists")
    args = ap.parse_args()

    if not args.input.exists():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    if args.out.exists() and not args.force:
        print(f"→ {args.out} exists ({args.out.stat().st_size / 1e6:.1f} MB); "
              f"use --force to reconvert")
        return 0

    print(f"→ converting {args.input.name} "
          f"({args.input.stat().st_size / 1e6:.1f} MB) → document model")
    t0 = time.perf_counter()
    doc = convert(args.input)
    print(f"  converted in {time.perf_counter() - t0:.1f}s")

    t0 = time.perf_counter()
    args.out.write_text(doc.model_dump_json(), encoding="utf-8")
    print(f"  wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB) "
          f"in {time.perf_counter() - t0:.1f}s")

    # Report what the cache contains, so a bad conversion is visible here rather
    # than three stages downstream.
    labels: dict[str, int] = {}
    for item in doc.texts:
        labels[str(item.label)] = labels.get(str(item.label), 0) + 1
    print(f"  texts: " + ", ".join(f"{k}={v}" for k, v in
                                   sorted(labels.items(), key=lambda kv: -kv[1])))
    print(f"  tables: {len(doc.tables)}   groups: {len(doc.groups)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
