from __future__ import annotations

from abc import ABC, abstractmethod

from app.models import ProductDetail, ProductStub


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
