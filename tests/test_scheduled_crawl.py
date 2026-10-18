import argparse
import json
from pathlib import Path

import tools.scheduled_crawl as sc
from tools.notify_telegram import build_message


def _args(tmp_path: Path, **kw) -> argparse.Namespace:
    data = tmp_path / "data"
    data.mkdir(exist_ok=True)
    (data / "index.json").write_text(
        json.dumps({"latest": {"amazon_jp": {"kr": {"csv": "x", "jsonl": "y", "item_count": 100}}}}), encoding="utf-8"
    )
    base = dict(limit=100, concurrency=2, min_delay=1, max_delay=2, min_items=0, data_dir=data, no_publish=False)
    return argparse.Namespace(**{**base, **kw})


def _fake_crawl(n_items: int, code: int = 0):
    def crawl(site, country, out_dir, args):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "results.jsonl").write_text("{}\n" * n_items, encoding="utf-8")
        (out_dir / "results.csv").write_text("", encoding="utf-8")
        return code, "" if code == 0 else f"crawl exit {code}"

    return crawl


def test_low_count_is_not_published(tmp_path, monkeypatch):
    monkeypatch.setattr(sc, "crawl_one", _fake_crawl(3))
    monkeypatch.setattr(sc, "publish", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not publish")))
    result = sc.run_target("amazon_jp", "kr", tmp_path / "work", _args(tmp_path))
    assert result["status"] == "skipped_low_count" and "3 < 30" in result["reason"]


def test_healthy_crawl_is_published(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(sc, "crawl_one", _fake_crawl(95))
    monkeypatch.setattr(sc, "publish", lambda *a, **k: calls.append(a))
    result = sc.run_target("amazon_jp", "kr", tmp_path / "work", _args(tmp_path))
    assert result["status"] == "published" and len(calls) == 1


def test_first_crawl_of_a_target_only_needs_one_item(tmp_path, monkeypatch):
    monkeypatch.setattr(sc, "crawl_one", _fake_crawl(2))
    monkeypatch.setattr(sc, "publish", lambda *a, **k: None)
    assert sc.run_target("qoo10_jp", "mo", tmp_path / "work", _args(tmp_path))["status"] == "published"


def test_small_test_limit_lowers_the_threshold(tmp_path, monkeypatch):
    monkeypatch.setattr(sc, "crawl_one", _fake_crawl(2))
    result = sc.run_target("amazon_jp", "kr", tmp_path / "work", _args(tmp_path, limit=5, no_publish=True))
    assert result["status"] == "crawled"


def test_overall_status_and_exit_code(tmp_path, monkeypatch):
    assert sc.overall_status([{"status": "published"}, {"status": "failed"}]) == "partial_success"
    assert sc.overall_status([{"status": "failed"}]) == "failure"
    monkeypatch.setattr(sc, "crawl_one", _fake_crawl(0, code=1))
    data = _args(tmp_path).data_dir
    code = sc.main(["--only", "amazon_jp:kr", "--data-dir", str(data), "--work-dir", str(tmp_path / "w"), "--automation-dir", str(tmp_path / "auto")])
    assert code == 1
    summary = json.loads((tmp_path / "auto" / "last_run.json").read_text(encoding="utf-8"))
    assert summary["status"] == "failure" and summary["results"][0]["reason"] == "crawl exit 1"
    assert len((tmp_path / "auto" / "history.jsonl").read_text(encoding="utf-8").splitlines()) == 1


def test_telegram_message_lists_problems_and_failed_steps():
    summary = {
        "started_at": "2026-10-18T18:17:00Z", "finished_at": "2026-10-18T19:20:00Z", "status": "partial_success",
        "published": 1, "total": 2,
        "results": [
            {"site": "amazon_jp", "country": "kr", "status": "published", "item_count": 100},
            {"site": "qoo10_jp", "country": "th", "status": "skipped_low_count", "item_count": 3, "reason": "3 < 30 (previous 100)"},
        ],
    }
    text = build_message("eSIMPriceJapan", summary, [], "https://x/dashboard/", "https://x/run")
    assert text.startswith("⚠️") and "2026-10-19 03:17 KST" in text and "63분" in text
    assert "qoo10_jp/th skipped_low_count: 3 &lt; 30" in text and '<a href="https://x/run">' in text
    assert build_message("eSIMPriceJapan", summary, ["commit"]).startswith("❌")
    assert "last_run.json" in build_message("eSIMPriceJapan", None, ["install"])
