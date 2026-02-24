import asyncio
from pathlib import Path

from app.adapters.base import MarketplaceAdapter
from app.models import CarrierSupportKR, ProductDetail, ProductStub
from app.output.writers import write_csv, write_failed_jsonl, write_jsonl
from app.pipeline.crawler import CrawlPipeline


class FakeAdapter(MarketplaceAdapter):
    name = "fake"

    async def search(self, query: str, limit: int) -> list[ProductStub]:
        return [ProductStub(product_url=f"https://www.amazon.co.jp/dp/B00000000{i}", asin=f"B00000000{i}") for i in range(limit)]

    async def fetch_detail(self, stub: ProductStub) -> ProductDetail:
        if stub.asin == "B000000003":
            raise RuntimeError("detail parsing failed: boom; screenshot=out/screenshots/detail_error_B000000003.png")
        return ProductDetail(
            title="sample esim",
            price_jpy=1200,
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
    result = asyncio.run(pipeline.run(query="eSIM 韓国", limit=5))

    assert len(result.items) == 4
    assert len(result.failures) == 1

    write_jsonl(tmp_path / "results.jsonl", result.items)
    write_csv(tmp_path / "results.csv", result.items)
    write_failed_jsonl(tmp_path / "failed.jsonl", result.failures)

    assert (tmp_path / "results.jsonl").exists()
    assert (tmp_path / "results.csv").exists()
    assert (tmp_path / "failed.jsonl").exists()
