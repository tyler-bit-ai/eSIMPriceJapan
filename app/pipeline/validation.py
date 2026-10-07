from __future__ import annotations

import re

from app.models import InvalidItem, NetworkType, ProductDetail, ProductStub

# Keep in sync with dashboard/travel-filter.js (tests/test_travel_filter.py checks parity).
# "日本国内" is deliberately NOT listed: legit travel eSIMs use it ("日本国内500MB付き").
_DOMESTIC_PLAN = re.compile(
    r"UQ\s*mobile|ウェルカムパッケージ|エントリーパッケージ|事務手数料"
    r"|ahamo|povo|LINEMO|楽天モバイル|mineo|IIJmio|ワイモバイル|Y!mobile",
    re.IGNORECASE,
)
_SIM_WORD = re.compile(r"sim|シム|ローミング|roaming|データ通信|data", re.IGNORECASE)
# Search results mix in other destinations (Taiwan/China/Europe SIMs under "eSIM 香港"):
# the title must name the crawled country. Multi-country plans that name it are kept.
_DESTINATION = {
    "kr": r"韓国|韓國|한국|korea|ソウル|釜山|済州",
    "vn": r"ベトナム|vietnam|越南|ハノイ|ホーチミン|ダナン",
    "th": r"タイ(?![プムヤルトマツミワ])|thailand|バンコク|プーケット",
    "tw": r"台湾|台灣|taiwan|タイワン|台北",
    "hk": r"香港|ホンコン|hong\s*kong",
    "mo": r"マカオ|澳門|澳门|maca[ou]",
    "us": r"アメリカ|米国|(?<![a-z])usa(?![a-z])|united\s*states|ハワイ|hawaii|グアム|guam|北米",
}
_DESTINATION_RE = {c: re.compile(p, re.IGNORECASE) for c, p in _DESTINATION.items()}
# Lead-destination detection also needs China (CMHK/China Mobile are HK carriers, not China).
# Japan is never counted: titles mention it for the seller or a pre-departure test.
_LEAD_RE = {
    **_DESTINATION_RE,
    "cn": re.compile(r"中国(?!移動|移动)|中國(?!移動)|china(?!\s*mobile)", re.IGNORECASE),
}


def foreign_lead(title: str | None, country: str | None) -> str | None:
    """The destination a multi-country title leads with, when it isn't `country`.

    "【中国・香港・マカオ eSIM】… 現地回線" under hk: the local network meant is China's.
    """
    if not title or country not in _DESTINATION_RE:
        return None
    hits = sorted((m.start(), c) for c, r in _LEAD_RE.items() if (m := r.search(title)))
    if len(hits) < 2 or hits[0][1] == country:
        return None
    return hits[0][1]


def scope_network_type(detail: ProductDetail) -> ProductDetail:
    """A "local" claim on a plan led by another country is not local to the crawled one → unknown."""
    lead = foreign_lead(detail.title, detail.country)
    if detail.network_type != NetworkType.local or not lead:
        return detail
    evidence = {**detail.evidence}
    evidence["network_type"] = [*evidence.get("network_type", []), f"local_claim_refers_to:{lead}"]
    return detail.model_copy(update={"network_type": NetworkType.unknown, "evidence": evidence})


def non_travel_reason(title: str | None, country: str | None = None) -> str | None:
    """Why this listing is not a travel eSIM/SIM product for `country`, or None if it looks like one."""
    if not title:
        return None
    m = _DOMESTIC_PLAN.search(title)
    if m:
        return f"domestic_carrier_plan:{m.group(0)}"
    if not _SIM_WORD.search(title):
        return "no_sim_keyword_in_title"
    dest = _DESTINATION_RE.get(country or "")
    if dest and not dest.search(title):
        return f"off_destination:{country}"
    return None


def validate_product(detail: ProductDetail, stub: ProductStub) -> InvalidItem | None:
    reason = non_travel_reason(detail.title, detail.country or stub.country)
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
