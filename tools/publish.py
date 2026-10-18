"""Publish a crawl output dir into the static dashboard data (Python port of tools/publish.ps1).

Writes sites/<site>/<country>/latest.{csv,jsonl}, metadata.json, runs/<run_id>.jsonl,
updates index.json (newest run first) and rebuilds history.json for the trend chart.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import statistics
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from app.pipeline.validation import non_travel_reason

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SITE = "amazon_jp"
DEFAULT_COUNTRY = "kr"
# Keep in sync with dashboard/app.js loadTrend (MIN_TREND_N, price field, site|country key).
PRICE_FIELD = "price_jpy"
MIN_TREND_N = 50
LABEL_TZ = ZoneInfo("Asia/Seoul")


def _int_or_none(value):
    return int(value) if value is not None else None


def new_record(site, country, csv, jsonl, metadata, source, crawled_at, published_at, item_count, query, limit):
    return {
        "site": site,
        "country": country,
        "csv": csv,
        "jsonl": jsonl,
        "metadata": metadata,
        "source": source,
        "crawled_at": crawled_at,
        "published_at": published_at,
        "item_count": item_count,
        "query": query,
        "limit": limit,
    }


def normalize_record(value, fallback_site, fallback_country):
    if not isinstance(value, dict):
        return None
    csv_value = str(value.get("csv", "") or "")
    jsonl_value = str(value.get("jsonl", "") or "")
    if not csv_value or not jsonl_value:
        return None
    return new_record(
        str(value.get("site") or fallback_site),
        str(value.get("country") or fallback_country),
        csv_value,
        jsonl_value,
        str(value.get("metadata") or ""),
        str(value.get("source") or ""),
        str(value.get("crawled_at") or ""),
        str(value.get("published_at") or ""),
        _int_or_none(value.get("item_count")),
        str(value.get("query") or ""),
        int(value["limit"]) if value.get("limit") is not None else 0,
    )


def normalize_latest_map(raw):
    latest = {}
    if not isinstance(raw, dict):
        return latest
    if "csv" in raw and "jsonl" in raw:
        record = normalize_record(raw, DEFAULT_SITE, DEFAULT_COUNTRY)
        if record:
            latest[DEFAULT_SITE] = {DEFAULT_COUNTRY: record}
        return latest

    for site, record in raw.items():
        if not isinstance(record, dict):
            continue
        if "csv" in record and "jsonl" in record:
            normalized = normalize_record(record, site, DEFAULT_COUNTRY)
            if normalized:
                latest[site] = {DEFAULT_COUNTRY: normalized}
            continue
        country_map = {}
        for country, country_record in record.items():
            normalized = normalize_record(country_record, site, country)
            if normalized:
                country_map[country] = normalized
        if country_map:
            latest[site] = country_map
    return latest


def normalize_runs(raw, current_run_id):
    runs = []
    if not isinstance(raw, list):
        return runs
    for run in raw:
        if not isinstance(run, dict):
            continue
        if str(run.get("id") or "") == current_run_id:
            continue
        runs.append(
            {
                "id": str(run.get("id") or ""),
                "site": str(run.get("site") or DEFAULT_SITE),
                "country": str(run.get("country") or DEFAULT_COUNTRY),
                "label": str(run.get("label") or ""),
                "source": str(run.get("source") or ""),
                "crawled_at": str(run.get("crawled_at") or ""),
                "published_at": str(run.get("published_at") or ""),
                "item_count": _int_or_none(run.get("item_count")),
                "csv": str(run.get("csv") or ""),
                "jsonl": str(run.get("jsonl") or ""),
                "metadata": str(run.get("metadata") or ""),
                "query": str(run.get("query") or ""),
                "limit": int(run["limit"]) if run.get("limit") is not None else 0,
            }
        )
    return runs


def read_index(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json_atomic(path: Path, value, indent: int | None = 2) -> None:
    tmp = path.with_name(f"{path.stem}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=indent), encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _read_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def date_key(value: str | None) -> str:
    """Same grouping key as dashboard/app.js dateKey()."""
    if not value:
        return "unknown"
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})", value)
    return f"{m[3]}-{m[1]}-{m[2]}" if m else value[:10]


def _price(raw: dict) -> float | None:
    try:
        price = float(raw.get(PRICE_FIELD))
    except (TypeError, ValueError):
        return None
    return price if price > 0 else None


def _trend_key(raw: dict, run: dict) -> str:
    country = str(raw.get("country") or run.get("country") or DEFAULT_COUNTRY).lower()
    site = raw.get("site") or run.get("site") or DEFAULT_SITE
    return f"{site}|{country}"


def _trend_keep(raw: dict, run: dict) -> bool:
    country = str(raw.get("country") or run.get("country") or DEFAULT_COUNTRY).lower()
    return non_travel_reason(raw.get("title") or "", country) is None


def build_history(data_dir: Path, runs: list[dict]) -> dict:
    """Per-date median price for the dashboard trend chart (mirrors app.js loadTrend).

    Saves the dashboard from downloading every past run just to draw the trend line.
    """
    by_date: dict[str, dict[str, dict]] = {}
    for run in runs:
        if not run.get("jsonl"):
            continue
        site = run.get("site") or DEFAULT_SITE
        country = run.get("country") or DEFAULT_COUNTRY
        group = by_date.setdefault(date_key(run.get("crawled_at")), {})
        key = f"{site}|{country}"
        prev = group.get(key)
        if not prev or (run.get("crawled_at") or "") > (prev.get("crawled_at") or ""):
            group[key] = run

    history: dict[str, dict[str, list]] = {}
    for day in sorted(by_date):
        prices: dict[str, list[float]] = {}
        for run in by_date[day].values():
            path = data_dir / run["jsonl"]
            if not path.exists():
                continue
            for raw in _read_jsonl(path):
                price = _price(raw)
                if price is None or not _trend_keep(raw, run):
                    continue
                prices.setdefault(_trend_key(raw, run), []).append(price)
        for key, values in prices.items():
            if len(values) >= MIN_TREND_N:
                median = statistics.median(values)
                history.setdefault(key, {})[day] = [int(median) if median == int(median) else median, len(values)]
    return {key: history[key] for key in sorted(history)}


def write_history(data_dir: Path) -> Path:
    index = read_index(data_dir / "index.json")
    path = data_dir / "history.json"
    write_json_atomic(path, build_history(data_dir, index.get("runs") or []), indent=None)
    return path


def publish(
    out_dir: Path,
    data_dir: Path,
    site: str,
    country: str,
    query: str = "",
    limit: int = 0,
    now: datetime | None = None,
) -> dict:
    results_csv = out_dir / "results.csv"
    results_jsonl = out_dir / "results.jsonl"
    for path in (results_csv, results_jsonl):
        if not path.exists():
            raise FileNotFoundError(f"{path.name} not found in {out_dir}")

    runs_dir = data_dir / "runs"
    country_dir = data_dir / "sites" / site / country
    runs_dir.mkdir(parents=True, exist_ok=True)
    country_dir.mkdir(parents=True, exist_ok=True)

    out_name = re.sub(r"[^a-zA-Z0-9._-]", "_", out_dir.name)
    crawled = datetime.fromtimestamp(results_jsonl.stat().st_mtime, tz=timezone.utc)
    crawled_at = _iso_z(crawled)
    published_at = _iso_z(now or datetime.now(timezone.utc))
    run_id = f"{crawled.strftime('%Y%m%dT%H%M%SZ')}_{site}_{country}_{out_name}"
    line_count = sum(1 for line in results_jsonl.read_text(encoding="utf-8-sig").splitlines() if line.strip())

    # Runs keep only jsonl: the dashboard never reads a run's csv, and dropping it halves repo growth.
    run_jsonl = f"runs/{run_id}.jsonl"
    shutil.copyfile(results_jsonl, data_dir / run_jsonl)
    shutil.copyfile(results_csv, country_dir / "latest.csv")
    shutil.copyfile(results_jsonl, country_dir / "latest.jsonl")

    source = _rel(results_jsonl)
    metadata_rel = f"sites/{site}/{country}/metadata.json"
    write_json_atomic(
        data_dir / metadata_rel,
        {
            "site": site,
            "country": country,
            "query": query,
            "limit": limit,
            "source": source,
            "crawled_at": crawled_at,
            "published_at": published_at,
            "item_count": line_count,
        },
    )

    index_path = data_dir / "index.json"
    existing = read_index(index_path)
    latest = normalize_latest_map(existing.get("latest"))
    runs = normalize_runs(existing.get("runs"), run_id)
    latest.setdefault(site, {})[country] = new_record(
        site,
        country,
        f"sites/{site}/{country}/latest.csv",
        f"sites/{site}/{country}/latest.jsonl",
        metadata_rel,
        source,
        crawled_at,
        published_at,
        line_count,
        query,
        limit,
    )
    label_time = crawled.astimezone(LABEL_TZ).strftime("%Y-%m-%d %H:%M")
    new_run = {
        "id": run_id,
        "site": site,
        "country": country,
        "label": f"{label_time} | {site} | {country} | {out_name} | {line_count} items",
        "source": source,
        "crawled_at": crawled_at,
        "published_at": published_at,
        "item_count": line_count,
        "csv": "",
        "jsonl": run_jsonl,
        "metadata": metadata_rel,
        "query": query,
        "limit": limit,
    }
    write_json_atomic(index_path, {"latest": latest, "runs": [new_run] + runs})
    write_history(data_dir)
    return new_run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, help="crawl output dir with results.{jsonl,csv}")
    parser.add_argument("--data-dir", type=Path, default=REPO_ROOT / "dashboard" / "data")
    parser.add_argument("--site", default=DEFAULT_SITE)
    parser.add_argument("--country", default=DEFAULT_COUNTRY)
    parser.add_argument("--query", default="")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--history-only", action="store_true", help="only rebuild history.json")
    args = parser.parse_args(argv)

    if args.history_only:
        print(f"Updated history -> {write_history(args.data_dir)}")
        return 0
    if not args.out_dir:
        parser.error("--out-dir is required")
    run = publish(args.out_dir, args.data_dir, args.site, args.country, args.query, args.limit)
    print(f"Saved run -> {run['id']} ({run['item_count']} items)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
