from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path

from app.adapters.amazon_jp import AmazonJPAdapter
from app.adapters.base import MarketplaceAdapter
from app.adapters.qoo10_jp import Qoo10JPAdapter

AdapterFactory = Callable[[Path], Awaitable[MarketplaceAdapter]]


ADAPTER_FACTORIES: dict[str, AdapterFactory] = {
    AmazonJPAdapter.name: AmazonJPAdapter.create,
    Qoo10JPAdapter.name: Qoo10JPAdapter.create,
}


def get_supported_sites() -> list[str]:
    return sorted(ADAPTER_FACTORIES)


async def create_adapter(site: str, screenshot_dir: Path) -> MarketplaceAdapter:
    try:
        factory = ADAPTER_FACTORIES[site]
    except KeyError as exc:
        supported = ", ".join(get_supported_sites())
        raise ValueError(f"Unsupported site '{site}'. Supported sites: {supported}") from exc
    return await factory(screenshot_dir)
