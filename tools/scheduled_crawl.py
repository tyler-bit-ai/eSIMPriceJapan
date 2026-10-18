"""Crawl every site × country, publish the healthy results and record a run summary.

Used by .github/workflows/scheduled-crawl.yml (self-hosted runner). One target failing
does not stop the others. Exit code: 0 all published, 2 partial, 1 nothing published.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import random
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from app.adapters.base import BLOCKED_EXIT_CODE
from app.adapters.factory import get_supported_sites
from app.countries import COUNTRY_REGISTRY
from tools.publish import REPO_ROOT, publish, read_index

logger = logging.getLogger("scheduled_crawl")

AUTOMATION_DIR = REPO_ROOT / "data" / "automation"
# A crawl that returns far fewer items than the last published one is most likely blocked
# (CAPTCHA, empty search page); publishing it would replace a good latest with a broken one.
MIN_RATIO_OF_PREVIOUS = 0.3
TARGET_TIMEOUT_S = 45 * 60


def default_targets() -> list[tuple[str, str]]:
    countries = [code for code, cfg in COUNTRY_REGISTRY.items() if cfg.crawl_enabled]
    return [(site, country) for site in get_supported_sites() for country in countries]


def parse_only(values: list[str]) -> list[tuple[str, str]]:
    targets = []
    for value in values:
        site, _, country = value.partition(":")
        if not site or not country:
            raise argparse.ArgumentTypeError(f"--only expects site:country, got {value!r}")
        targets.append((site, country))
    return targets


def count_lines(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip())


def previous_count(data_dir: Path, site: str, country: str) -> int | None:
    record = (read_index(data_dir / "index.json").get("latest") or {}).get(site, {}).get(country) or {}
    return record.get("item_count")


def min_items_for(previous: int | None, limit: int) -> int:
    return max(1, math.ceil(min(previous or 0, limit) * MIN_RATIO_OF_PREVIOUS))


def crawl_one(site: str, country: str, out_dir: Path, args: argparse.Namespace) -> tuple[int | None, str]:
    cmd = [
        sys.executable, "-m", "app", "crawl",
        "--site", site, "--country", country,
        "--limit", str(args.limit),
        "--concurrency", str(args.concurrency),
        "--min-delay", str(args.min_delay), "--max-delay", str(args.max_delay),
        "--out", str(out_dir),
    ]
    logger.info("crawl start %s/%s -> %s", site, country, out_dir)
    try:
        completed = subprocess.run(cmd, cwd=REPO_ROOT, timeout=TARGET_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return None, f"timeout after {TARGET_TIMEOUT_S // 60} min"
    if completed.returncode != 0:
        return completed.returncode, f"crawl exit {completed.returncode}"
    return 0, ""


def first_blocked_message(failed_jsonl: Path) -> str:
    if failed_jsonl.exists():
        for line in failed_jsonl.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("error_type") == "SiteBlockedError":
                return row.get("error_message") or "bot check / throttle page"
    return "bot check / throttle page"


def run_targets(targets: list[tuple[str, str]], work_dir: Path, args: argparse.Namespace) -> list[dict]:
    """Run targets in order; once a site blocks us, skip its remaining countries (retrying prolongs the block)."""
    results: list[dict] = []
    blocked_sites: set[str] = set()
    crawled_any = False
    for site, country in targets:
        if site in blocked_sites:
            logger.warning("%s/%s -> skipped: %s blocked earlier in this run", site, country, site)
            results.append({
                "site": site, "country": country, "status": "skipped_site_blocked", "item_count": 0,
                "failed_count": 0, "reason": f"{site} blocked earlier in this run", "duration_s": 0,
            })
            continue
        if crawled_any and args.target_pause_max > 0:
            pause = random.uniform(args.target_pause_min, args.target_pause_max)
            logger.info("pausing %.0fs before %s/%s", pause, site, country)
            time.sleep(pause)
        result = run_target(site, country, work_dir, args)
        crawled_any = True
        if result["status"] == "blocked":
            blocked_sites.add(site)
        results.append(result)
    return results


def run_target(site: str, country: str, work_dir: Path, args: argparse.Namespace) -> dict:
    started = time.monotonic()
    out_dir = work_dir / f"{site}_{country}"
    result = {"site": site, "country": country, "status": "failed", "item_count": 0, "failed_count": 0, "reason": ""}

    code, reason = crawl_one(site, country, out_dir, args)
    result["item_count"] = count_lines(out_dir / "results.jsonl")
    result["failed_count"] = count_lines(out_dir / "failed.jsonl")
    previous = previous_count(args.data_dir, site, country)
    result["previous_count"] = previous
    min_items = args.min_items or min_items_for(previous, args.limit)

    if code == BLOCKED_EXIT_CODE:
        result["status"] = "blocked"
        result["reason"] = first_blocked_message(out_dir / "failed.jsonl")
    elif code != 0:
        result["reason"] = reason
    elif result["item_count"] < min_items:
        result["status"] = "skipped_low_count"
        result["reason"] = f"{result['item_count']} < {min_items} (previous {previous})"
    elif args.no_publish:
        result["status"] = "crawled"
    else:
        try:
            publish(out_dir, args.data_dir, site, country, query="", limit=args.limit)
            result["status"] = "published"
        except Exception as exc:  # keep going with the other targets
            logger.exception("publish failed for %s/%s", site, country)
            result["reason"] = f"publish error: {exc}"

    result["duration_s"] = round(time.monotonic() - started)
    log = logger.info if result["status"] in ("published", "crawled") else logger.warning
    log("%s/%s -> %s %s items %s", site, country, result["status"], result["item_count"], result["reason"])
    return result


def overall_status(results: list[dict]) -> str:
    ok = sum(r["status"] in ("published", "crawled") for r in results)
    if ok == len(results):
        return "success"
    return "partial_success" if ok else "failure"


def write_summary(summary: dict, automation_dir: Path) -> Path:
    automation_dir.mkdir(parents=True, exist_ok=True)
    path = automation_dir / "last_run.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # One line per run, so every scheduled run leaves a commit (keeps the schedule from auto-disabling).
    with (automation_dir / "history.jsonl").open("a", encoding="utf-8") as fh:
        compact = {k: summary[k] for k in ("started_at", "finished_at", "status", "published", "total")}
        fh.write(json.dumps(compact, ensure_ascii=False) + "\n")
    return path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--min-delay", type=float, default=1.0)
    parser.add_argument("--max-delay", type=float, default=2.0)
    parser.add_argument("--target-pause-min", type=float, default=0, help="seconds between site × country crawls")
    parser.add_argument("--target-pause-max", type=float, default=0)
    parser.add_argument("--only", action="append", default=[], help="site:country (repeatable)")
    parser.add_argument("--min-items", type=int, default=0, help="override the publish threshold")
    parser.add_argument("--data-dir", type=Path, default=REPO_ROOT / "dashboard" / "data")
    parser.add_argument("--work-dir", type=Path, default=None)
    parser.add_argument("--automation-dir", type=Path, default=AUTOMATION_DIR)
    parser.add_argument("--no-publish", action="store_true", help="crawl only, leave dashboard data untouched")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    targets = parse_only(args.only) if args.only else default_targets()
    started_at = _now()
    work_dir = args.work_dir or REPO_ROOT / "data" / "crawls" / f"scheduled_{started_at[:10]}"
    logger.info("%s targets, limit=%s, work_dir=%s", len(targets), args.limit, work_dir)

    results = run_targets(targets, work_dir, args)
    summary = {
        "started_at": started_at,
        "finished_at": _now(),
        "status": overall_status(results),
        "published": sum(r["status"] in ("published", "crawled") for r in results),
        "total": len(results),
        "blocked_sites": sorted({r["site"] for r in results if r["status"] == "blocked"}),
        "limit": args.limit,
        "results": results,
    }
    path = write_summary(summary, args.automation_dir)
    logger.info("%s (%s/%s) -> %s", summary["status"], summary["published"], summary["total"], path)
    return {"success": 0, "partial_success": 2}.get(summary["status"], 1)


if __name__ == "__main__":
    raise SystemExit(main())
