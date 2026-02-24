from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, HttpUrl


class NetworkType(str, Enum):
    local = "local"
    roaming = "roaming"
    unknown = "unknown"


class CarrierSupportKR(BaseModel):
    skt: Optional[bool] = None
    kt: Optional[bool] = None
    lgu: Optional[bool] = None


class ProductStub(BaseModel):
    product_url: HttpUrl
    asin: Optional[str] = None
    search_price_jpy: Optional[int] = None
    search_price_text: Optional[str] = None


class ProductDetail(BaseModel):
    title: Optional[str] = None
    price_jpy: Optional[int] = None
    validity: Optional[str] = None
    usage_validity: Optional[str] = None
    activation_validity: Optional[str] = None
    network_type: NetworkType = NetworkType.unknown
    carrier_support_kr: CarrierSupportKR = Field(default_factory=CarrierSupportKR)
    data_amount: Optional[str] = None
    product_url: HttpUrl
    asin: Optional[str] = None
    seller: Optional[str] = None
    brand: Optional[str] = None
    evidence: dict[str, list[str]] = Field(default_factory=dict)


class CrawlError(BaseModel):
    product_url: str
    asin: Optional[str] = None
    error_type: str
    error_message: str
    status_code: Optional[int] = None
    screenshot_path: Optional[str] = None


class CrawlResult(BaseModel):
    items: list[ProductDetail]
    failures: list[CrawlError]


def model_to_row(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(mode="json")
