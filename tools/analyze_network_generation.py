from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.extractors.heuristics import extract_network_generation


FIVE_G_RE = re.compile(r"(?:5\s*G|５\s*G)", re.IGNORECASE)
FOUR_G_LTE_RE = re.compile(r"(?:4\s*G|４\s*G|LTE|ＬＴＥ)", re.IGNORECASE)
DIRECT_5G_RE = re.compile(
    r"(?:5\s*G|５\s*G)\s*(?:対応|利用可|サポート|support|available)|"
    r"(?:4\s*G|４\s*G)\s*/\s*(?:5\s*G|５\s*G)|"
    r"(?:5\s*G|５\s*G)\s*/\s*(?:4\s*G|４\s*G)",
    re.IGNORECASE,
)
DIRECT_4G_RE = re.compile(
    r"(?:4\s*G|４\s*G)\s*/\s*(?:LTE|ＬＴＥ)|"
    r"(?:LTE|ＬＴＥ)\s*/\s*(?:4\s*G|４\s*G)|"
    r"(?:4\s*G|４\s*G|LTE|ＬＴＥ)\s*(?:対応|利用可|サポート|support|available)",
    re.IGNORECASE,
)
NEGATIVE_5G_RE = re.compile(
    r"(?:5\s*G|５\s*G)\s*(?:非対応|不可|未対応|not\s+supported|no)",
    re.IGNORECASE,
)

STRONG_EVIDENCE_KEYS = {
    "title",
    "network_generation_product_info",
    "network_generation_transmission_speed",
    "representative_option",
    "option_candidates",
}
FALLBACK_EVIDENCE_KEYS = {
    "network_type",
    "carrier_support_kr",
    "carrier_support_local",
    "usage_validity",
    "activation_validity",
    "data_amount",
    "monthly_sold_count",
    "review_count",
    "bestseller_rank",
}


@dataclass
class TextSources:
    strong: list[str]
    fallback: list[str]


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return items


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


def collect_sources(item: dict[str, Any]) -> TextSources:
    strong: list[str] = []
    fallback: list[str] = []
    for key in ("title", "seller", "brand"):
        value = item.get(key)
        if value:
            strong.append(f"{key}: {value}")

    evidence = item.get("evidence") or {}
    if not isinstance(evidence, dict):
        return TextSources(strong=strong, fallback=fallback)

    for key, raw_values in evidence.items():
        values = [f"{key}: {text}" for text in flatten_values(raw_values) if text]
        if key in STRONG_EVIDENCE_KEYS:
            strong.extend(values)
        elif key in FALLBACK_EVIDENCE_KEYS:
            fallback.extend(values)
        else:
            fallback.extend(values)

    return TextSources(strong=strong, fallback=fallback)


def has_5g(texts: list[str]) -> bool:
    return any(FIVE_G_RE.search(text) for text in texts)


def has_4g_lte(texts: list[str]) -> bool:
    return any(FOUR_G_LTE_RE.search(text) for text in texts)


def has_direct_5g(texts: list[str]) -> bool:
    return any(DIRECT_5G_RE.search(text) for text in texts)


def has_direct_4g(texts: list[str]) -> bool:
    return any(DIRECT_4G_RE.search(text) or NEGATIVE_5G_RE.search(text) for text in texts)


def classify(item: dict[str, Any]) -> tuple[str, dict[str, bool]]:
    sources = collect_sources(item)
    generation, _ = extract_network_generation(sources.strong, sources.fallback)
    strong_5g = has_direct_5g(sources.strong)
    strong_4g = has_direct_4g(sources.strong)
    fallback_5g = has_5g(sources.fallback)
    fallback_4g = has_4g_lte(sources.fallback)

    return generation.value, {
        "strong_5g": strong_5g,
        "strong_4g_lte": strong_4g,
        "fallback_5g": fallback_5g,
        "fallback_4g_lte": fallback_4g,
        "title_5g": has_5g([str(item.get("title") or "")]),
        "title_4g_lte": has_4g_lte([str(item.get("title") or "")]),
        "conflict": bool(strong_4g and fallback_5g and not strong_5g),
        "fallback_only_signal": bool((fallback_5g or fallback_4g) and not strong_5g and not strong_4g),
    }


def infer_site_country(path: Path, item: dict[str, Any]) -> tuple[str, str]:
    site = str(item.get("site") or "unknown")
    country = str(item.get("country") or "unknown")
    parts = path.parts
    if "sites" in parts:
        idx = parts.index("sites")
        if len(parts) > idx + 2:
            site = parts[idx + 1]
            country = parts[idx + 2]
    return site, country


def iter_input_paths(root: Path) -> list[Path]:
    paths: list[Path] = []
    sites_dir = root / "dashboard" / "data" / "sites"
    runs_dir = root / "dashboard" / "data" / "runs"
    if sites_dir.exists():
        paths.extend(sites_dir.glob("*/*/latest.jsonl"))
    if runs_dir.exists():
        paths.extend(runs_dir.glob("*.jsonl"))
    return sorted(set(paths))


def analyze(root: Path) -> dict[str, Counter[str]]:
    summary: dict[str, Counter[str]] = defaultdict(Counter)
    for path in iter_input_paths(root):
        for item in load_jsonl(path):
            site, country = infer_site_country(path, item)
            key = f"{site}/{country}"
            value, signals = classify(item)
            summary[key]["total"] += 1
            summary[key][value] += 1
            for signal, present in signals.items():
                if present:
                    summary[key][signal] += 1
    return dict(summary)


def format_table(summary: dict[str, Counter[str]]) -> str:
    header = (
        "site/country",
        "total",
        "5g_capable",
        "lte_4g_only",
        "unknown",
        "known_5g_share",
        "known_lte_share",
        "fallback_only",
        "conflict",
    )
    lines = ["\t".join(header)]
    for key in sorted(summary):
        row = summary[key]
        known_total = row["5g_capable"] + row["lte_4g_only"]
        known_5g = round((row["5g_capable"] / known_total) * 100) if known_total else 0
        known_lte = round((row["lte_4g_only"] / known_total) * 100) if known_total else 0
        lines.append(
            "\t".join(
                [
                    key,
                    str(row["total"]),
                    str(row["5g_capable"]),
                    str(row["lte_4g_only"]),
                    str(row["unknown"]),
                    f"{known_5g}%",
                    f"{known_lte}%",
                    str(row["fallback_only_signal"]),
                    str(row["conflict"]),
                ]
            )
        )
    return "\n".join(lines)


def format_markdown(summary: dict[str, Counter[str]]) -> str:
    lines = [
        "# Network Generation Feasibility Report",
        "",
        "This report is generated from collected JSONL files using the source-strength policy in `docs/network-generation-feasibility.md`.",
        "",
        "| Site/Country | Total | 5G capable | LTE/4G only | Unknown | Known 5G share | Known LTE share | Fallback-only signals | Conflicts |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for key in sorted(summary):
        row = summary[key]
        known_total = row["5g_capable"] + row["lte_4g_only"]
        known_5g = round((row["5g_capable"] / known_total) * 100) if known_total else 0
        known_lte = round((row["lte_4g_only"] / known_total) * 100) if known_total else 0
        lines.append(
            "| "
            + " | ".join(
                [
                    key,
                    str(row["total"]),
                    str(row["5g_capable"]),
                    str(row["lte_4g_only"]),
                    str(row["unknown"]),
                    f"{known_5g}%",
                    f"{known_lte}%",
                    str(row["fallback_only_signal"]),
                    str(row["conflict"]),
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- Amazon JP has enough direct generation signals to produce a conservative known-only LTE/5G split for several countries.",
            "- Qoo10 JP remains mostly unknown in current collected data because many product texts use speed words such as `高速` or `超高速` without explicit LTE/5G generation.",
            "- Fallback-only signals and conflicts are not promoted to 5G-capable; they are treated as unknown to avoid related-product contamination.",
            "- Exact market share should be based on newly crawled source-separated records. Existing RAW can show feasibility and rough known-only proportions, not a final market truth.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze LTE/4G/5G signals in collected JSONL data.")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a table.")
    parser.add_argument("--markdown", action="store_true", help="Print a markdown report.")
    parser.add_argument("--out", type=Path, help="Write output to this file.")
    args = parser.parse_args()

    summary = analyze(args.root)
    if args.json:
        output = json.dumps(summary, ensure_ascii=False, indent=2)
    elif args.markdown:
        output = format_markdown(summary)
    else:
        output = format_table(summary)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output, encoding="utf-8")
        return

    print(output)


if __name__ == "__main__":
    main()
