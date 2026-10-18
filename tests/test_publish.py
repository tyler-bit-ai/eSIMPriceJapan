import json
from pathlib import Path

from tools.publish import build_history, publish


def _write_out(out: Path, prices: list[int], title: str = "韓国 eSIM 3日間") -> Path:
    out.mkdir(parents=True)
    rows = [{"site": "amazon_jp", "country": "kr", "title": title, "price_jpy": p} for p in prices]
    (out / "results.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    (out / "results.csv").write_text("title,price_jpy\n", encoding="utf-8")
    return out


def test_publish_writes_latest_run_and_index(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    (data / "index.json").write_text(
        json.dumps({"latest": {}, "runs": [{"id": "old", "site": "qoo10_jp", "country": "vn", "jsonl": "runs/old.jsonl", "csv": "runs/old.csv"}]}),
        encoding="utf-8",
    )
    out = _write_out(tmp_path / "out_kr", [1000, 1200])

    run = publish(out, data, "amazon_jp", "kr", limit=100)

    index = json.loads((data / "index.json").read_text(encoding="utf-8"))
    assert [r["id"] for r in index["runs"]] == [run["id"], "old"]
    assert run["csv"] == "" and (data / run["jsonl"]).exists()
    assert not list((data / "runs").glob("*.csv"))
    latest = index["latest"]["amazon_jp"]["kr"]
    assert latest["jsonl"] == "sites/amazon_jp/kr/latest.jsonl" and latest["item_count"] == 2
    assert (data / "sites/amazon_jp/kr/latest.csv").exists()
    assert json.loads((data / "sites/amazon_jp/kr/metadata.json").read_text(encoding="utf-8"))["limit"] == 100
    assert (data / "history.json").exists()


def test_build_history_matches_dashboard_trend_rules(tmp_path):
    data = tmp_path / "data"
    (data / "runs").mkdir(parents=True)

    def run(name, crawled_at, prices, title="韓国 eSIM 3日間"):
        rows = [{"title": title, "price_jpy": p} for p in prices]
        (data / "runs" / f"{name}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
        return {"id": name, "site": "amazon_jp", "country": "kr", "crawled_at": crawled_at, "jsonl": f"runs/{name}.jsonl"}

    runs = [
        run("a", "2026-10-01T05:00:00Z", [1000] * 50 + [2000] * 50),  # median of even list = mean of middle two
        run("b", "2026-10-01T01:00:00Z", [9999] * 60),  # older run the same day is ignored
        run("c", "2026-10-15T05:00:00Z", [1500] * 49),  # below MIN_TREND_N
        run("d", "2026-10-29T05:00:00Z", [1200] * 60 + [None, 0]),  # null/0 prices dropped
        run("e", "2026-10-29T05:00:00Z", [100] * 60, title="UQ mobile ウェルカムパッケージ eSIM"),  # non-travel
    ]
    runs[-1]["country"] = "vn"

    assert build_history(data, runs) == {"amazon_jp|kr": {"2026-10-01": [1500, 100], "2026-10-29": [1200, 60]}}
