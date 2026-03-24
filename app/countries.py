from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class CountryConfig:
    code: str
    label: str
    search_keyword: str
    crawl_enabled: bool = True
    dashboard_enabled: bool = True


COUNTRY_REGISTRY: dict[str, CountryConfig] = {
    "kr": CountryConfig(
        code="kr",
        label="한국",
        search_keyword="eSIM 韓国",
    ),
    "vn": CountryConfig(
        code="vn",
        label="베트남",
        search_keyword="eSIM ベトナム",
    ),
    "th": CountryConfig(
        code="th",
        label="태국",
        search_keyword="eSIM タイ",
        dashboard_enabled=False,
    ),
    "tw": CountryConfig(
        code="tw",
        label="대만",
        search_keyword="eSIM 台湾",
    ),
    "hk": CountryConfig(
        code="hk",
        label="홍콩",
        search_keyword="eSIM 香港",
    ),
    "mo": CountryConfig(
        code="mo",
        label="마카오",
        search_keyword="eSIM マカオ",
    ),
    "us": CountryConfig(
        code="us",
        label="미국",
        search_keyword="eSIM アメリカ",
    ),
}


def get_supported_countries(include_hidden: bool = True) -> list[str]:
    if include_hidden:
        return list(COUNTRY_REGISTRY.keys())
    return [code for code, config in COUNTRY_REGISTRY.items() if config.dashboard_enabled]


def get_country_config(country: str) -> CountryConfig:
    try:
        return COUNTRY_REGISTRY[country]
    except KeyError as exc:
        supported = ", ".join(get_supported_countries())
        raise ValueError(f"Unsupported country '{country}'. Supported countries: {supported}") from exc


def get_default_query(site: str, country: str) -> str:
    del site
    return get_country_config(country).search_keyword


def get_dashboard_countries() -> list[str]:
    return get_supported_countries(include_hidden=False)


def get_country_metadata() -> list[dict[str, object]]:
    return [asdict(config) for config in COUNTRY_REGISTRY.values()]
