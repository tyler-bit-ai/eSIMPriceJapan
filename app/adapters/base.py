from __future__ import annotations

from abc import ABC, abstractmethod

from app.models import ProductDetail, ProductStub

# `python -m app crawl` exits with this code when the site served a bot-check/throttle page.
BLOCKED_EXIT_CODE = 3
# Amazon's robot-check page carries this contact comment; its throttle page is an HTTP 503.
AMAZON_BLOCK_MARKERS = ("api-services-support@amazon.com", "/errors/validateCaptcha")
BLOCK_STATUSES = (403, 429, 503)


class SiteBlockedError(RuntimeError):
    """The site answered with a bot-check or throttle page.

    Never retried and never bypassed (AGENTS.md): the crawl stops and reports it instead.
    """


def block_reason(status: int | None, html: str, markers: tuple[str, ...] = ()) -> str | None:
    if status in BLOCK_STATUSES:
        return f"http_{status}"
    for marker in markers:
        if marker in html:
            return f"bot_check_page ({marker})"
    return None


class MarketplaceAdapter(ABC):
    name: str

    @abstractmethod
    async def search(self, query: str, limit: int) -> list[ProductStub]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_detail(self, stub: ProductStub) -> ProductDetail:
        raise NotImplementedError

    @abstractmethod
    async def close(self) -> None:
        raise NotImplementedError
