"""A/B the Docling ingester against ETL steps 1-4 on the same source document.

Compares `docling-content.json` (from ingest.py) against `modified-content.json`
(from step 4) on the axes that matter for the pipeline:

  1. Section count and whether RAMQ anchor IDs survive (traceability).
  2. Tariff-row recovery — how many of step 4's typed {code, amount} objects
     Docling also recovers, and whether the amounts agree.
  3. Text conservation — does Docling's text cover step 4's text? This is the
     analogue of cheerio-scraper.ts's compareString invariant.

Usage:
    python compare.py [--a modified-content.json] [--b docling-content.json]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def load(p: Path) -> list[dict[str, Any]]:
    return json.loads(p.read_text(encoding="utf-8"))


def tariffs(sections: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Index tariff blocks by act code. Later duplicates keep the first seen."""
    out: dict[str, dict[str, Any]] = {}
    for s in sections:
        for c in s.get("content", []):
            if isinstance(c, dict) and "code" in c:
                out.setdefault(str(c["code"]), c)
    return out


def all_text(sections: list[dict[str, Any]]) -> str:
    """Concatenate every scrap of text, including tariff fields, as step 4's
    validation does — so the comparison is on characters, not structure."""
    parts: list[str] = []
    for s in sections:
        if s.get("name"):
            parts.append(str(s["name"]))
        for c in s.get("content", []):
            if isinstance(c, str):
                parts.append(c)
            elif isinstance(c, dict):
                parts.append(str(c.get("code", "")))
                parts.append(str(c.get("description", "")))
    return " ".join(parts)


def squash(s: str) -> str:
    """Strip all whitespace, matching compareString's removeWhitespaces=true."""
    return re.sub(r"\s+", "", s)


def words(s: str) -> set[str]:
    return set(re.findall(r"\w{4,}", s.lower(), flags=re.UNICODE))


def pct(n: int, d: int) -> str:
    return f"{100.0 * n / d:.1f}%" if d else "n/a"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--a", type=Path, default=Path("../modified-content.json"),
                    help="baseline: step 4 output")
    ap.add_argument("--b", type=Path, default=Path("docling-content.json"),
                    help="candidate: docling output")
    args = ap.parse_args()

    for p in (args.a, args.b):
        if not p.exists():
            print(f"Missing: {p}")
            return 1

    a, b = load(args.a), load(args.b)

    print("=" * 66)
    print("  A: steps 1-4 (cheerio)      B: docling")
    print("=" * 66)

    # --- 1. Structure -------------------------------------------------------
    a_ids = [s.get("id") for s in a if s.get("id")]
    b_ids = [s.get("id") for s in b if s.get("id")]
    a_ramq = sum(1 for i in a_ids if str(i).isdigit())
    b_ramq = sum(1 for i in b_ids if str(i).isdigit())

    print("\n── STRUCTURE ──")
    print(f"  sections                  A {len(a):>7}   B {len(b):>7}")
    print(f"  RAMQ anchor IDs kept      A {a_ramq:>7}   B {b_ramq:>7}"
          f"   {'← traceability lost' if b_ramq == 0 else ''}")
    print(f"  sections with a parentId  A {sum(1 for s in a if s.get('parentId')):>7}"
          f"   B {sum(1 for s in b if s.get('parentId')):>7}")

    # Can Docling's section names even be matched back to RAMQ's?
    a_names = {normalize_name(s.get("name", "")) for s in a if s.get("name")}
    b_names = {normalize_name(s.get("name", "")) for s in b if s.get("name")}
    matched = a_names & b_names
    print(f"  section names in common   {len(matched):>7} of A's {len(a_names)}"
          f"  ({pct(len(matched), len(a_names))})")

    # --- 2. Tariff recovery -------------------------------------------------
    ta, tb = tariffs(a), tariffs(b)
    both = set(ta) & set(tb)
    agree = sum(
        1 for c in both
        if _close(ta[c].get("amount_facility"), tb[c].get("amount_facility"))
    )

    print("\n── TARIFF ROWS (the typed {code, amount} objects) ──")
    print(f"  distinct act codes        A {len(ta):>7}   B {len(tb):>7}")
    print(f"  recovered by B            {len(both):>7} of A's {len(ta)}"
          f"  ({pct(len(both), len(ta))})")
    print(f"  amount_facility agrees    {agree:>7} of {len(both)} shared"
          f"  ({pct(agree, len(both))})")
    missed = sorted(set(ta) - set(tb))
    if missed:
        print(f"  missed by B (first 10)    {', '.join(missed[:10])}")
    extra = sorted(set(tb) - set(ta))
    if extra:
        print(f"  only in B (first 10)      {', '.join(extra[:10])}")

    # --- 3. Text conservation ----------------------------------------------
    sa, sb = squash(all_text(a)), squash(all_text(b))
    wa, wb = words(all_text(a)), words(all_text(b))
    covered = wa & wb

    print("\n── TEXT CONSERVATION ──")
    print(f"  chars (whitespace-free)   A {len(sa):>7}   B {len(sb):>7}"
          f"   (B/A {pct(len(sb), len(sa))})")
    print(f"  distinct words (4+ chars) A {len(wa):>7}   B {len(wb):>7}")
    print(f"  A's vocabulary present    {len(covered):>7} of {len(wa)}"
          f"  ({pct(len(covered), len(wa))})")
    lost = sorted(wa - wb)
    if lost:
        print(f"  in A only (first 15)      {', '.join(lost[:15])}")

    print("\n" + "=" * 66)
    return 0


def normalize_name(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().casefold()


def _close(x: Any, y: Any) -> bool:
    if x is None or y is None:
        return x is y
    try:
        return abs(float(x) - float(y)) < 0.005
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    raise SystemExit(main())
