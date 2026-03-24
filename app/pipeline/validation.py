from __future__ import annotations

from app.models import InvalidItem, ProductDetail, ProductStub


def validate_product(detail: ProductDetail, stub: ProductStub) -> InvalidItem | None:
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
