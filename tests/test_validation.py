from app.models import ProductDetail, ProductStub
from app.pipeline.validation import validate_product


def test_validate_product_rejects_missing_price():
    detail = ProductDetail(
        site="amazon_jp",
        country="kr",
        title="sample",
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
        title="sample",
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
