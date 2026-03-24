from app.countries import COUNTRY_REGISTRY, get_dashboard_countries, get_default_query


def test_country_registry_exposes_all_target_countries():
    assert set(COUNTRY_REGISTRY) == {"kr", "vn", "th", "tw", "hk", "mo", "us"}


def test_dashboard_country_list_hides_thailand():
    assert get_dashboard_countries() == ["kr", "vn", "tw", "hk", "mo", "us"]
    assert COUNTRY_REGISTRY["th"].crawl_enabled is True
    assert COUNTRY_REGISTRY["th"].dashboard_enabled is False


def test_default_query_uses_country_mapping():
    assert get_default_query(site="amazon_jp", country="kr") == "eSIM 韓国"
    assert get_default_query(site="qoo10_jp", country="vn") == "eSIM ベトナム"
