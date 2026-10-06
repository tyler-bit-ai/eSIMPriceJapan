from __future__ import annotations

import re

from app.models import InvalidItem, ProductDetail, ProductStub

# Keep in sync with dashboard/travel-filter.js (tests/test_travel_filter.py checks parity).
# "日本国内" is deliberately NOT listed: legit travel eSIMs use it ("日本国内500MB付き").
_DOMESTIC_PLAN = re.compile(
    r"UQ\s*mobile|ウェルカムパッケージ|エントリーパッケージ|事務手数料"
    r"|ahamo|povo|LINEMO|楽天モバイル|mineo|IIJmio|ワイモバイル|Y!mobile",
    re.IGNORECASE,
)
_SIM_WORD = re.compile(r"sim|シム|ローミング|roaming|データ通信|data", re.IGNORECASE)


def non_travel_reason(title: str | None) -> str | None:
    """Why this listing is not a travel eSIM/SIM product, or None if it looks like one."""
    if not title:
        return None
    m = _DOMESTIC_PLAN.search(title)
    if m:
        return f"domestic_carrier_plan:{m.group(0)}"
    if not _SIM_WORD.search(title):
        return "no_sim_keyword_in_title"
    return None


def validate_product(detail: ProductDetail, stub: ProductStub) -> InvalidItem | None:
    reason = non_travel_reason(detail.title)
    if reason:
        invalid = _to_invalid(detail, stub, reason="non_travel_product")
        invalid.evidence = {**invalid.evidence, "non_travel": [reason]}
        return invalid
    price = detail.price_jpy
    if price is None:
        return _to_invalid(
            detail,
            stub,
            reason="missing_price",
        )
    if price <= 0:
        return _to_invalid(
            detail,
            stub,
            reason="non_positive_price",
        )
    return None


def _to_invalid(detail: ProductDetail, stub: ProductStub, reason: str) -> InvalidItem:
    raw_price_texts = []
    raw_price_texts.extend(detail.evidence.get("price_jpy", []))
    raw_price_texts.extend(detail.evidence.get("non_jpy_price", []))
    if stub.search_price_text:
        raw_price_texts.append(f"search_price: {stub.search_price_text}")

    return InvalidItem(
        site=detail.site or stub.site,
        country=detail.country or stub.country,
        product_url=str(detail.product_url),
        asin=detail.asin or stub.asin,
        site_product_id=detail.site_product_id or stub.site_product_id,
        title=detail.title,
        price_jpy=detail.price_jpy,
        search_price_jpy=stub.search_price_jpy,
        invalid_reason=reason,
        raw_price_texts=raw_price_texts[:10],
        evidence=detail.evidence,
    )
