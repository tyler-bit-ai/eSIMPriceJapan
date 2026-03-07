from app.extractors.heuristics import (
    extract_bestseller_badge,
    extract_bestseller_rank,
    extract_carrier_support_kr,
    extract_data_amount,
    extract_monthly_sold_count,
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


def test_parse_price_text_yen_suffix():
    amount, currency = parse_price_text("商品価格 1,080円")
    assert amount == 1080
    assert currency == "JPY"


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


def test_extract_validity_split_hours_to_days():
    res = extract_validity_split(["韓国eSIM 72時間 無制限 / 有効期限 90日"])
    assert res.usage_validity == "3일"
    assert res.activation_validity == "90일"


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


def test_extract_network_type_avoid_roaming_center_false_positive():
    net, _ = extract_network_type(["現地空港サポート(SKTelecomローミングセンター)"])
    assert net == NetworkType.unknown


def test_extract_network_type_negated_roaming():
    net, _ = extract_network_type(["このプランはローミング不要です"])
    assert net == NetworkType.unknown


def test_extract_network_type_conflicting_signals():
    net, _ = extract_network_type(["現地回線対応、ただし国際ローミング設定が必要"])
    assert net == NetworkType.unknown


def test_extract_network_type_korean_carrier_line_is_unknown():
    net, _ = extract_network_type(["韓国大手通信キャリア SKTelecom 公式認証正規品SIM"])
    assert net == NetworkType.unknown


def test_extract_carrier_support_kr():
    carriers, evidence = extract_carrier_support_kr(["韓国 SKT KT LG U+ 対応キャリア"])
    assert carriers.skt is True
    assert carriers.kt is True
    assert carriers.lgu is True
    assert evidence


def test_extract_carrier_support_kr_sk_telecom_variants():
    carriers, _ = extract_carrier_support_kr(["Korea SK Telecom KT Japan Uplus 対応"])
    assert carriers.skt is True
    assert carriers.kt is True
    assert carriers.lgu is True


def test_extract_data_amount():
    res = extract_data_amount(["3GB / 7日"])
    assert res.value == "3GB"


def test_extract_data_amount_unlimited_jp_to_en():
    res = extract_data_amount(["高速データ通信 無制限"])
    assert res.value == "unlimited"


def test_extract_monthly_sold_count():
    res = extract_monthly_sold_count(["過去1か月で4,000点以上購入されました"])
    assert res.value == 4000


def test_extract_bestseller_badge():
    res = extract_bestseller_badge(["ベストセラー"])
    assert res.value is True


def test_extract_bestseller_rank():
    res = extract_bestseller_rank(["Amazon 売れ筋ランキング: 家電＆カメラ 28位"])
    assert res.value == 28
