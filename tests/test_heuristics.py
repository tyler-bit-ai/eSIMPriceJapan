from app.extractors.heuristics import (
    extract_carrier_support_kr,
    extract_data_amount,
    extract_network_type,
    extract_price_jpy,
    extract_price_jpy_with_evidence,
    extract_validity,
    extract_validity_split,
    parse_price_text,
)
from app.models import NetworkType


def test_extract_price_jpy():
    res = extract_price_jpy(["今だけ ￥1,980 税込"])
    assert res.value == 1980


def test_parse_price_text_krw():
    amount, currency = parse_price_text("KRW14,210")
    assert amount == 14210
    assert currency == "KRW"


def test_extract_price_jpy_with_non_jpy_evidence():
    value, non_jpy = extract_price_jpy_with_evidence(["KRW14,210"], assume_jpy_on_unknown_currency=True)
    assert value.value is None
    assert non_jpy


def test_extract_validity_days():
    res = extract_validity(["利用期間: 30日間有効"])
    assert res.value == "30일"


def test_extract_validity_data_until_used():
    res = extract_validity(["GB使い切りまで利用可能"])
    assert res.value == "GB使い切り"


def test_extract_validity_split_usage_and_activation():
    res = extract_validity_split(
        ["利用期間 3日間 / 有効期限 受信後30日以内に有効化してください"]
    )
    assert res.usage_validity == "3일"
    assert res.activation_validity == "30일"


def test_extract_validity_split_swap_if_inverted():
    res = extract_validity_split(["有効期限 180日以内 例: 3日間プランは4日まで"])
    assert res.activation_validity == "180일"


def test_extract_validity_split_title_priority():
    res = extract_validity_split(
        [
            "【韓国eSIM】 1日間 500MB/日",
            "有効期限は購入日より180日です",
            "365日多言語LINEサポート",
        ]
    )
    assert res.usage_validity == "1일"
    assert res.activation_validity == "180일"


def test_extract_validity_split_ignore_non_numeric_label():
    res = extract_validity_split(
        ["有効期限のカウントが始まります"]
    )
    assert res.activation_validity is None


def test_extract_network_type_roaming():
    net, _ = extract_network_type(["国際ローミング対応 eSIM"])
    assert net == NetworkType.roaming


def test_extract_network_type_local():
    net, _ = extract_network_type(["韓国 現地回線 local network"])
    assert net == NetworkType.local


def test_extract_carrier_support_kr():
    carriers, evidence = extract_carrier_support_kr(["韓国 SKT KT LG U+ 対応キャリア"])
    assert carriers.skt is True
    assert carriers.kt is True
    assert carriers.lgu is True
    assert evidence


def test_extract_data_amount():
    res = extract_data_amount(["3GB / 7日"])
    assert res.value == "3GB"


def test_extract_data_amount_unlimited_jp_to_en():
    res = extract_data_amount(["高速データ通信 無制限"])
    assert res.value == "unlimited"
