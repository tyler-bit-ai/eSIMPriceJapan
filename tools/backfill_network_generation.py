from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.extractors.heuristics import extract_network_generation
from app.models import NetworkGeneration
from app.output.writers import PRODUCT_CSV_FIELDNAMES
from tools.analyze_network_generation import collect_sources

GEN_5G_RE = re.compile(r"(?:5\s*G|５\s*G|5G|５G)", re.IGNORECASE)
GEN_4G_RE = re.compile(r"(?:4\s*G|４\s*G|4G|４G|LTE|ＬＴＥ)", re.IGNORECASE)
NEGATIVE_5G_RE = re.compile(r"(?:5\s*G|５\s*G)\s*(?:非対応|不可|未対応|not\s+supported|no)", re.IGNORECASE)
NOISY_CONTEXT_RE = re.compile(
    r"(?:関連商品|類似商品|おすすめ|recommend|review|レビュー|カスタマーレビュー|ranking|ランキング|search_result|"
    r"fallback_only_network_generation_signal|no_lte_4g_or_5g_keyword_matched)",
    re.IGNORECASE,
)
MEDIUM_EVIDENCE_KEYS = {
    "network_type",
    "carrier_support_local",
    "carrier_support_kr",
    "option_candidates",
    "representative_option",
    "network_generation_product_info",
    "network_generation_transmission_speed",
}


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            items.append(json.loads(line))
    return items


def dump_jsonl(path: Path, items: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for item in items:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")


def csv_cell(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return ""
    return value


def dump_csv(path: Path, items: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=PRODUCT_CSV_FIELDNAMES)
        writer.writeheader()
        for item in items:
            writer.writerow({field: csv_cell(item.get(field)) for field in PRODUCT_CSV_FIELDNAMES})


def flatten_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(flatten_values(item))
        return out
    if isinstance(value, dict):
        out: list[str] = []
        for item in value.values():
            out.extend(flatten_values(item))
        return out
    return [str(value)]


def _clean_medium_texts(item: dict[str, Any]) -> list[str]:
    evidence = item.get("evidence") or {}
    if not isinstance(evidence, dict):
        return []

    texts: list[str] = []
    title = str(item.get("title") or "")
    if title:
        texts.append(f"title: {title}")

    for key, raw_values in evidence.items():
        if key == "network_generation" or key not in MEDIUM_EVIDENCE_KEYS:
            continue
        for text in flatten_values(raw_values):
            if not text or NOISY_CONTEXT_RE.search(text):
                continue
            texts.append(f"{key}: {text}")
    return texts


def infer_generation_from_existing_evidence(item: dict[str, Any]) -> tuple[str, str, list[str]]:
    confirmed = str(item.get("network_generation") or NetworkGeneration.unknown.value)
    confirmed_evidence = (item.get("evidence") or {}).get("network_generation", [])
    if confirmed != NetworkGeneration.unknown.value:
        return confirmed, "high", flatten_values(confirmed_evidence)[:3]

    texts = _clean_medium_texts(item)
    five_g_hits = [text[:180] for text in texts if GEN_5G_RE.search(text)]
    negative_5g_hits = [text[:180] for text in texts if NEGATIVE_5G_RE.search(text)]
    four_g_hits = [text[:180] for text in texts if GEN_4G_RE.search(text)]

    if five_g_hits and negative_5g_hits:
        return NetworkGeneration.unknown.value, "low", five_g_hits[:1] + negative_5g_hits[:1] + ["medium_conflict"]
    if five_g_hits:
        return NetworkGeneration.five_g_capable.value, "medium", five_g_hits[:3]
    if negative_5g_hits:
        return NetworkGeneration.lte_4g_only.value, "medium", negative_5g_hits[:3]
    if four_g_hits:
        return NetworkGeneration.lte_4g_only.value, "medium", four_g_hits[:3]
    return NetworkGeneration.unknown.value, "low", ["no_medium_generation_signal"]


def backfill_item(item: dict[str, Any], overwrite: bool) -> bool:
    before = (
        item.get("network_generation"),
        item.get("network_generation_inferred"),
        item.get("network_generation_confidence"),
    )

    if overwrite or not item.get("network_generation"):
        sources = collect_sources(item)
        generation, evidence = extract_network_generation(sources.strong, sources.fallback)
        item["network_generation"] = generation.value

        raw_evidence = item.get("evidence")
        if not isinstance(raw_evidence, dict):
            raw_evidence = {}
            item["evidence"] = raw_evidence
        raw_evidence["network_generation"] = evidence

    inferred, confidence, inferred_evidence = infer_generation_from_existing_evidence(item)
    item["network_generation_inferred"] = inferred
    item["network_generation_confidence"] = confidence

    raw_evidence = item.get("evidence")
    if not isinstance(raw_evidence, dict):
        raw_evidence = {}
        item["evidence"] = raw_evidence
    raw_evidence["network_generation_inferred"] = inferred_evidence

    after = (
        item.get("network_generation"),
        item.get("network_generation_inferred"),
        item.get("network_generation_confidence"),
    )
    return before != after


def iter_targets(root: Path, include_runs: bool) -> list[Path]:
    data_dir = root / "dashboard" / "data"
    paths: list[Path] = []
    paths.extend((data_dir / "sites").glob("*/*/latest.jsonl"))
    if include_runs:
        paths.extend((data_dir / "runs").glob("*.jsonl"))
    return sorted(set(paths))


def backfill_file(path: Path, overwrite: bool, dry_run: bool) -> dict[str, Any]:
    items = load_jsonl(path)
    changed = 0
    counts = {"5g_capable": 0, "lte_4g_only": 0, "unknown": 0}
    inferred_counts = {"5g_capable": 0, "lte_4g_only": 0, "unknown": 0}
    confidence_counts: dict[str, int] = {}
    for item in items:
        if backfill_item(item, overwrite=overwrite):
            changed += 1
        counts[str(item.get("network_generation") or "unknown")] = (
            counts.get(str(item.get("network_generation") or "unknown"), 0) + 1
        )
        inferred_counts[str(item.get("network_generation_inferred") or "unknown")] = (
            inferred_counts.get(str(item.get("network_generation_inferred") or "unknown"), 0) + 1
        )
        confidence = str(item.get("network_generation_confidence") or "unknown")
        confidence_counts[confidence] = confidence_counts.get(confidence, 0) + 1

    csv_path = path.with_suffix(".csv")
    if not dry_run and changed:
        dump_jsonl(path, items)
        if csv_path.exists():
            dump_csv(csv_path, items)

    known_total = counts["5g_capable"] + counts["lte_4g_only"]
    return {
        "path": str(path.relative_to(ROOT)),
        "csv": str(csv_path.relative_to(ROOT)) if csv_path.exists() else None,
        "total": len(items),
        "changed": changed,
        "counts": counts,
        "inferred_counts": inferred_counts,
        "confidence_counts": confidence_counts,
        "known_5g_share": round((counts["5g_capable"] / known_total) * 100) if known_total else 0,
        "known_lte_share": round((counts["lte_4g_only"] / known_total) * 100) if known_total else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill network_generation into existing dashboard JSONL/CSV data.")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--runs", action="store_true", help="Also update dashboard/data/runs/*.jsonl.")
    parser.add_argument("--overwrite", action="store_true", help="Recompute existing network_generation values.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("docs/network-generation-backfill-summary.json"),
    )
    args = parser.parse_args()

    root = args.root.resolve()
    results = [
        backfill_file(path, overwrite=args.overwrite, dry_run=args.dry_run)
        for path in iter_targets(root, include_runs=args.runs)
    ]
    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "dry_run": args.dry_run,
        "overwrite": args.overwrite,
        "include_runs": args.runs,
        "files": results,
    }

    output = json.dumps(summary, ensure_ascii=False, indent=2)
    if args.summary and not args.dry_run:
        summary_path = (root / args.summary).resolve() if not args.summary.is_absolute() else args.summary
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(output + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
