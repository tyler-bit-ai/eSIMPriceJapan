from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from tenacity import AsyncRetrying, RetryError, stop_after_attempt, wait_exponential_jitter

from app.adapters.base import MarketplaceAdapter
from app.models import CrawlError, CrawlResult, ProductDetail, ProductStub
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
    ) -> None:
        self.adapter = adapter
        self.out_dir = out_dir
        self.concurrency = max(1, concurrency)
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.max_retries = max_retries

    async def run(self, query: str, limit: int) -> CrawlResult:
        stubs = await self.adapter.search(query=query, limit=limit)
        logger.info("start crawl details: %s items", len(stubs))
        semaphore = asyncio.Semaphore(self.concurrency)

        items: list[ProductDetail] = []
        failures: list[CrawlError] = []

        async def worker(stub: ProductStub) -> None:
            async with semaphore:
                await random_delay(self.min_delay, self.max_delay)
                try:
                    item = await self._fetch_with_retry(stub)
                    items.append(item)
                except Exception as exc:
                    logger.warning("failed for %s: %s", stub.product_url, exc)
                    screenshot = self._extract_screenshot_path(str(exc))
                    failures.append(
                        CrawlError(
                            product_url=str(stub.product_url),
                            asin=stub.asin,
                            error_type=type(exc).__name__,
                            error_message=str(exc),
                            status_code=None,
                            screenshot_path=screenshot,
                        )
                    )

        await asyncio.gather(*(worker(stub) for stub in stubs))
        return CrawlResult(items=items, failures=failures)

    async def _fetch_with_retry(self, stub: ProductStub) -> ProductDetail:
        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self.max_retries),
                wait=wait_exponential_jitter(initial=1, max=8),
                reraise=True,
            ):
                with attempt:
                    return await self.adapter.fetch_detail(stub)
        except RetryError as retry_error:
            raise retry_error.last_attempt.exception() or retry_error

    def _extract_screenshot_path(self, message: str) -> str | None:
        marker = "screenshot="
        if marker not in message:
            return None
        return message.split(marker, 1)[-1].strip()
