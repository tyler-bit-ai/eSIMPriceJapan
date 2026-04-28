import asyncio
from pathlib import Path

from app.adapters.base import MarketplaceAdapter
from app.models import CarrierSupportKR, ProductDetail, ProductStub
from app.output.writers import write_csv, write_failed_jsonl, write_invalid_csv, write_invalid_jsonl, write_jsonl
from app.pipeline.crawler import CrawlPipeline


class FakeAdapter(MarketplaceAdapter):
    name = "fake"

    async def search(self, query: str, limit: int) -> list[ProductStub]:
        return [ProductStub(product_url=f"https://www.amazon.co.jp/dp/B00000000{i}", asin=f"B00000000{i}") for i in range(limit)]

    async def fetch_detail(self, stub: ProductStub) -> ProductDetail:
        if stub.asin == "B000000003":
            raise RuntimeError("detail parsing failed: boom; screenshot=out/screenshots/detail_error_B000000003.png")
        if stub.asin == "B000000004":
            return ProductDetail(
                title="invalid price esim",
                price_jpy=0,
                monthly_sold_count=100,
                is_bestseller=False,
                bestseller_rank=99,
                validity="3일",
                network_type="local",
                carrier_support_kr=CarrierSupportKR(skt=True, kt=True, lgu=None),
                data_amount="1GB/day",
                product_url=stub.product_url,
                asin=stub.asin,
                seller="sample seller",
                brand="sample brand",
                evidence={"price_jpy": ["0円 placeholder"]},
            )
        return ProductDetail(
            title="sample esim",
            price_jpy=1200,
            monthly_sold_count=300,
            is_bestseller=True,
            bestseller_rank=28,
            validity="7일",
            network_type="roaming",
            carrier_support_kr=CarrierSupportKR(skt=True, kt=None, lgu=None),
            data_amount="1GB",
            product_url=stub.product_url,
            asin=stub.asin,
            seller="sample seller",
            brand="sample brand",
            evidence={"title": ["sample esim"]},
        )

    async def close(self) -> None:
        return None


def test_pipeline_smoke(tmp_path: Path):
    adapter = FakeAdapter()
    pipeline = CrawlPipeline(adapter=adapter, out_dir=tmp_path, concurrency=2, min_delay=0, max_delay=0)
    result = asyncio.run(pipeline.run(query="eSIM 韓国", limit=5, country="kr"))

    assert len(result.items) == 3
    assert len(result.invalid_items) == 1
    assert len(result.failures) == 1
    assert all(item.country == "kr" for item in result.items)
    assert result.invalid_items[0].country == "kr"
    assert result.failures[0].country == "kr"

    write_jsonl(tmp_path / "results.jsonl", result.items)
    write_csv(tmp_path / "results.csv", result.items)
    write_failed_jsonl(tmp_path / "failed.jsonl", result.failures)
    write_invalid_jsonl(tmp_path / "invalid.jsonl", result.invalid_items)
    write_invalid_csv(tmp_path / "invalid.csv", result.invalid_items)

    assert (tmp_path / "results.jsonl").exists()
    assert (tmp_path / "results.csv").exists()
    assert (tmp_path / "failed.jsonl").exists()
    assert (tmp_path / "invalid.jsonl").exists()
    assert (tmp_path / "invalid.csv").exists()
    assert '"country": "kr"' in (tmp_path / "results.jsonl").read_text(encoding="utf-8")
    assert "country" in (tmp_path / "results.csv").read_text(encoding="utf-8-sig")


class HangingAdapter(MarketplaceAdapter):
    name = "hanging"

    async def search(self, query: str, limit: int) -> list[ProductStub]:
        return [ProductStub(product_url="https://www.amazon.co.jp/dp/B000000009", asin="B000000009")]

    async def fetch_detail(self, stub: ProductStub) -> ProductDetail:
        await asyncio.sleep(0.2)
        return ProductDetail(
            title="never reached",
            price_jpy=1000,
            validity="1일",
            network_type="unknown",
            product_url=stub.product_url,
            asin=stub.asin,
        )

    async def close(self) -> None:
        return None


def test_pipeline_times_out_stuck_detail(tmp_path: Path):
    adapter = HangingAdapter()
    pipeline = CrawlPipeline(
        adapter=adapter,
        out_dir=tmp_path,
        concurrency=1,
        min_delay=0,
        max_delay=0,
        max_retries=1,
        detail_timeout=0.05,
    )

    result = asyncio.run(pipeline.run(query="eSIM 台湾", limit=1, country="tw"))

    assert len(result.items) == 0
    assert len(result.invalid_items) == 0
    assert len(result.failures) == 1
    assert result.failures[0].country == "tw"
    assert "timed out" in result.failures[0].error_message
