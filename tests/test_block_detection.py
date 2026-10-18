import asyncio
import json

import tools.scheduled_crawl as sc
from app.adapters.base import BLOCKED_EXIT_CODE, AMAZON_BLOCK_MARKERS, MarketplaceAdapter, SiteBlockedError, block_reason
from app.models import ProductDetail, ProductStub
from app.pipeline.crawler import CrawlPipeline
from tools.notify_telegram import build_message
from tests.test_scheduled_crawl import _args, _fake_crawl

SITE, OTHER = "amazon_jp", "qoo10_jp"
ROBOT_PAGE = "<body><!-- To discuss automated access to Amazon data please contact api-services-support@amazon.com. --></body>"


def test_block_reason_detects_throttle_and_robot_check():
    assert block_reason(503, "", AMAZON_BLOCK_MARKERS) == "http_503"
    assert block_reason(200, ROBOT_PAGE, AMAZON_BLOCK_MARKERS).startswith("bot_check_page")
    assert block_reason(200, "<div id='productTitle'>eSIM</div>", AMAZON_BLOCK_MARKERS) is None
    assert block_reason(404, "", AMAZON_BLOCK_MARKERS) is None


class BlockingAdapter(MarketplaceAdapter):
    name = SITE

    def __init__(self, block_search=False):
        self.block_search = block_search
        self.calls = []

    async def search(self, query, limit):
        if self.block_search:
            raise SiteBlockedError(f"{SITE} blocked: http_503 at https://example/s")
        return [ProductStub(site=SITE, product_url=f"https://example/dp/B00000000{i}", asin=f"B00000000{i}") for i in range(limit)]

    async def fetch_detail(self, stub):
        self.calls.append(stub.asin)
        if len(self.calls) >= 2:
            raise SiteBlockedError(f"{SITE} blocked: bot_check_page at {stub.product_url}")
        return ProductDetail(title="x", product_url=stub.product_url, asin=stub.asin)

    async def close(self):
        pass


def _pipeline(adapter, tmp_path):
    return CrawlPipeline(adapter=adapter, out_dir=tmp_path, concurrency=1, min_delay=0, max_delay=0, max_retries=3)


def test_detail_block_is_not_retried_and_stops_the_crawl(tmp_path):
    adapter = BlockingAdapter()
    result = asyncio.run(_pipeline(adapter, tmp_path).run(query="q", limit=6))
    assert len(adapter.calls) == 2  # no retry of the blocked page, nothing fetched after it
    assert result.blocked and [f.error_type for f in result.failures] == ["SiteBlockedError"]


def test_search_block_returns_blocked_result(tmp_path):
    result = asyncio.run(_pipeline(BlockingAdapter(block_search=True), tmp_path).run(query="q", limit=6, country="kr"))
    assert result.blocked and result.items == [] and result.failures[0].error_type == "SiteBlockedError"


def test_blocked_site_skips_its_remaining_countries(tmp_path, monkeypatch):
    def crawl(site, country, out_dir, args):
        out_dir.mkdir(parents=True, exist_ok=True)
        if site == SITE and country == "vn":
            (out_dir / "failed.jsonl").write_text(json.dumps({"error_type": "SiteBlockedError", "error_message": "blocked: http_503"}) + "\n")
            return BLOCKED_EXIT_CODE, "crawl exit 3"
        return _fake_crawl(50)(site, country, out_dir, args)

    calls = []
    monkeypatch.setattr(sc, "crawl_one", lambda *a: (calls.append(a[:2]), crawl(*a))[1])
    monkeypatch.setattr(sc, "publish", lambda *a, **k: None)
    targets = [(SITE, "kr"), (SITE, "vn"), (SITE, "th"), (OTHER, "kr")]
    results = sc.run_targets(targets, tmp_path / "w", _args(tmp_path))
    assert [r["status"] for r in results] == ["published", "blocked", "skipped_site_blocked", "published"]
    assert (SITE, "th") not in calls and results[1]["reason"] == "blocked: http_503"


def test_telegram_message_reports_block():
    summary = {
        "started_at": "2026-10-18T18:17:00Z", "finished_at": "2026-10-18T18:30:00Z", "status": "partial_success",
        "published": 1, "total": 3, "blocked_sites": [SITE],
        "results": [
            {"site": SITE, "country": "kr", "status": "published", "item_count": 92},
            {"site": SITE, "country": "vn", "status": "blocked", "item_count": 3, "reason": "blocked: http_503"},
            {"site": SITE, "country": "th", "status": "skipped_site_blocked", "item_count": 0, "reason": "-"},
        ],
    }
    text = build_message("t", summary, [])
    assert f"🚫 <b>{SITE} 차단 감지</b>" in text and "남은 국가 수집 중단: th" in text
    assert "vn 3🚫" in text and "skipped_site_blocked" not in text
