from app.models import ProductDetail, ProductStub
from app.pipeline.validation import validate_product


def test_validate_product_rejects_missing_price():
    detail = ProductDetail(
        site="amazon_jp",
        country="kr",
        title="韓国 sample eSIM",
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
        title="ベトナム sample eSIM",
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
        country="kr",
        title=title,
        price_jpy=350,
        product_url="https://www.amazon.co.jp/dp/B07YBZ3D22",
        asin="B07YBZ3D22",
    )


def _stub() -> ProductStub:
    return ProductStub(site="amazon_jp", country="kr", product_url="https://www.amazon.co.jp/dp/B07YBZ3D22")


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


def test_validate_product_rejects_other_destination():
    detail = _detail("【Almond sim】ヨーロッパ simcard EU 30日間10GB")
    detail.country = "hk"
    invalid = validate_product(detail, ProductStub(site="amazon_jp", country="hk", product_url=detail.product_url))
    assert invalid is not None
    assert invalid.evidence["non_travel"] == ["off_destination:hk"]


def test_validate_product_keeps_multi_country_plan_naming_destination():
    detail = _detail("【中国・香港・マカオeSIM】5日間 高速データ通信無制限")
    detail.country = "hk"
    assert validate_product(detail, ProductStub(site="amazon_jp", country="hk", product_url=detail.product_url)) is None


def test_foreign_lead_detects_secondary_destination():
    from app.pipeline.validation import foreign_lead

    assert foreign_lead("【中国・香港・マカオ eSIM】3日間 現地回線", "hk") == "cn"
    assert foreign_lead("【Almond eSIM】香港 マカオ eSIMプラン 4日間", "hk") is None
    assert foreign_lead("【Almond eSIM】香港 マカオ eSIMプラン 4日間", "mo") == "hk"
    assert foreign_lead("【安心の日本企業】韓国eSIM 4日間 SKT・LGU+回線", "kr") is None
    assert foreign_lead("香港 eSIM 中國移動香港 CMHK 5日間", "hk") is None


def test_scope_network_type_downgrades_foreign_local_claim():
    from app.models import NetworkType
    from app.pipeline.validation import scope_network_type

    detail = _detail("【中国・香港・マカオ eSIM】3日間 現地回線")
    detail.country, detail.network_type = "hk", NetworkType.local
    scoped = scope_network_type(detail)
    assert scoped.network_type == NetworkType.unknown
    assert scoped.evidence["network_type"] == ["local_claim_refers_to:cn"]
