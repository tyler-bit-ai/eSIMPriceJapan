from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from tenacity import AsyncRetrying, RetryError, stop_after_attempt, wait_exponential_jitter

from app.adapters.base import MarketplaceAdapter
from app.models import CrawlError, CrawlResult, InvalidItem, ProductDetail, ProductStub
from app.pipeline.validation import validate_product
from app.utils.delay import random_delay

logger = logging.getLogger(__name__)


class CrawlPipeline:
    def __init__(
        self,
        adapter: MarketplaceAdapter,
        out_dir: Path,
        concurrency: int = 3,
        min_delay: float = 1.0,
        max_delay: float = 3.0,
        max_retries: int = 3,
        detail_timeout: float = 90.0,
    ) -> None:
        self.adapter = adapter
        self.out_dir = out_dir
        self.concurrency = max(1, concurrency)
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.max_retries = max_retries
        self.detail_timeout = max(0.01, detail_timeout)

    async def run(self, query: str, limit: int, country: str | None = None) -> CrawlResult:
        stubs = await self.adapter.search(query=query, limit=limit)
        if country:
            stubs = [stub.model_copy(update={"country": country}) for stub in stubs]
        logger.info("start crawl details: %s items", len(stubs))
        semaphore = asyncio.Semaphore(self.concurrency)

        items: list[ProductDetail] = []
        invalid_items: list[InvalidItem] = []
        failures: list[CrawlError] = []

        async def worker(stub: ProductStub) -> None:
            async with semaphore:
                await random_delay(self.min_delay, self.max_delay)
                try:
                    item = await self._fetch_with_retry(stub)
                    if country and item.country is None:
                        item = item.model_copy(update={"country": country})
                    invalid = validate_product(item, stub)
                    if invalid is not None:
                        logger.info("invalid item for %s: %s", stub.product_url, invalid.invalid_reason)
                        invalid_items.append(invalid)
                    else:
                        items.append(item)
                except Exception as exc:
                    logger.warning("failed for %s: %s", stub.product_url, exc)
                    screenshot = self._extract_screenshot_path(str(exc))
                    failures.append(
                        CrawlError(
                            site=stub.site,
                            country=stub.country or country,
                            product_url=str(stub.product_url),
                            asin=stub.asin,
                            error_type=type(exc).__name__,
                            error_message=str(exc),
                            status_code=None,
                            screenshot_path=screenshot,
                        )
                    )

        await asyncio.gather(*(worker(stub) for stub in stubs))
        return CrawlResult(items=items, invalid_items=invalid_items, failures=failures)

    async def _fetch_with_retry(self, stub: ProductStub) -> ProductDetail:
        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self.max_retries),
                wait=wait_exponential_jitter(initial=1, max=8),
                reraise=True,
            ):
                with attempt:
                    try:
                        return await asyncio.wait_for(
                            self.adapter.fetch_detail(stub),
                            timeout=self.detail_timeout,
                        )
                    except TimeoutError as exc:
                        raise RuntimeError(
                            f"detail fetch timed out after {self.detail_timeout:.0f}s"
                        ) from exc
        except RetryError as retry_error:
            raise retry_error.last_attempt.exception() or retry_error

    def _extract_screenshot_path(self, message: str) -> str | None:
        marker = "screenshot="
        if marker not in message:
            return None
        return message.split(marker, 1)[-1].strip()
