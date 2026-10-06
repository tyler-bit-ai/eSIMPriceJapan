from app.models import ProductDetail, ProductStub
from app.pipeline.validation import validate_product


def test_validate_product_rejects_missing_price():
    detail = ProductDetail(
        site="amazon_jp",
        country="kr",
        title="sample eSIM",
        price_jpy=None,
        product_url="https://www.amazon.co.jp/dp/B000000001",
        asin="B000000001",
        evidence={"price_jpy": ["no_jpy_price_found_in_primary_selectors"]},
    )
    stub = ProductStub(
        site="amazon_jp",
        country="kr",
        product_url="https://www.amazon.co.jp/dp/B000000001",
        asin="B000000001",
        search_price_jpy=None,
    )

    invalid = validate_product(detail, stub)

    assert invalid is not None
    assert invalid.invalid_reason == "missing_price"
    assert invalid.country == "kr"


def test_validate_product_rejects_non_positive_price():
    detail = ProductDetail(
        site="qoo10_jp",
        country="vn",
        title="sample eSIM",
        price_jpy=0,
        product_url="https://www.qoo10.jp/item/ESIM/1133241666",
        site_product_id="1133241666",
        evidence={"price_jpy": ["0円 placeholder"]},
    )
    stub = ProductStub(
        site="qoo10_jp",
        country="vn",
        product_url="https://www.qoo10.jp/item/ESIM/1133241666",
        site_product_id="1133241666",
        search_price_jpy=0,
        search_price_text="0円",
    )

    invalid = validate_product(detail, stub)

    assert invalid is not None
    assert invalid.invalid_reason == "non_positive_price"
    assert invalid.raw_price_texts[0] == "0円 placeholder"
    assert invalid.country == "vn"


def _detail(title: str) -> ProductDetail:
    return ProductDetail(
        site="amazon_jp",
        country="th",
        title=title,
        price_jpy=350,
        product_url="https://www.amazon.co.jp/dp/B07YBZ3D22",
        asin="B07YBZ3D22",
    )


def _stub() -> ProductStub:
    return ProductStub(site="amazon_jp", country="th", product_url="https://www.amazon.co.jp/dp/B07YBZ3D22")


def test_validate_product_rejects_domestic_carrier_plan():
    invalid = validate_product(
        _detail("【コード入力で事務手数料不要】 UQ mobile ウェルカムパッケージ/[SIMカード/eSIM共通]/au回線"),
        _stub(),
    )

    assert invalid is not None
    assert invalid.invalid_reason == "non_travel_product"
    assert invalid.evidence["non_travel"][0].startswith("domestic_carrier_plan:")


def test_validate_product_rejects_listing_without_sim_keyword():
    invalid = validate_product(_detail("リジュオール PDRNクリーム 60g 韓国スキンケア"), _stub())

    assert invalid is not None
    assert invalid.invalid_reason == "non_travel_product"
    assert invalid.evidence["non_travel"] == ["no_sim_keyword_in_title"]


def test_validate_product_keeps_travel_esim_mentioning_japan_domestic():
    assert validate_product(_detail("【韓国eSIM】3日間 出発前のお試しに便利 日本国内500MB付き データ通信専用"), _stub()) is None
