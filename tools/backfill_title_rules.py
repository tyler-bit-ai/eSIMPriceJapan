"""Re-apply title-based rules to published dashboard data (pages are not re-fetched).

- usage validity, re-extracted from the title plus stored validity evidence
  (Qoo10 skipped: its validity comes from the selected option, not free text)
- network_type "local" on a plan led by another country -> unknown (see scope_network_type)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.extractors.heuristics import extract_validity_split
from app.pipeline.validation import foreign_lead
from tools.backfill_network_generation import dump_csv, dump_jsonl, iter_targets, load_jsonl


def backfill_item(item: dict) -> bool:
    return bool(scope_network(item) | backfill_validity(item))


def scope_network(item: dict) -> bool:
    lead = foreign_lead(item.get("title"), item.get("country"))
    if item.get("network_type") != "local" or not lead:
        return False
    item["network_type"] = "unknown"
    ev = item.setdefault("evidence", {})
    ev["network_type"] = [*ev.get("network_type", []), f"local_claim_refers_to:{lead}"]
    return True


def backfill_validity(item: dict) -> bool:
    if item.get("site") == "qoo10_jp" or not item.get("title"):
        return False
    ev = item.get("evidence") or {}
    texts = [item["title"], *ev.get("usage_validity", []), *ev.get("activation_validity", [])]
    split = extract_validity_split(texts)
    # Usage only: stored evidence is cut at 180 chars, so activation often can't be re-derived.
    if not split.usage_validity or split.usage_validity == item.get("usage_validity"):
        return False
    item["usage_validity"] = split.usage_validity
    item["validity"] = split.usage_validity
    ev["usage_validity"] = split.usage_evidence
    item["evidence"] = ev
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", action="store_true", help="Also update dashboard/data/runs/*.jsonl.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    total = 0
    for path in iter_targets(ROOT, include_runs=args.runs):
        items = load_jsonl(path)
        changed = sum(backfill_item(item) for item in items)
        total += changed
        if changed and not args.dry_run:
            dump_jsonl(path, items)
            if path.with_suffix(".csv").exists():
                dump_csv(path.with_suffix(".csv"), items)
        if changed:
            print(f"{path.relative_to(ROOT)}: {changed}/{len(items)} changed")
    print(f"total changed: {total}{' (dry run)' if args.dry_run else ''}")


if __name__ == "__main__":
    main()
