from __future__ import annotations

import re
from dataclasses import dataclass

from app.models import CarrierSupportKR, NetworkType

PRICE_PATTERN = re.compile(r"(?:￥|¥|JPY\s?)([0-9][0-9,]*)")
AMOUNT_PATTERN = re.compile(r"([0-9][0-9,]+)")
DATA_PATTERN = re.compile(r"(?:(\d+)\s?GB|無制限|使い放題|unlimited)", re.IGNORECASE)
VALIDITY_PATTERNS = [
    re.compile(r"(\d{1,3})\s?(?:日間|日)\s?(?:有効|利用|利用可能|validity)?", re.IGNORECASE),
    re.compile(r"(?:有効期限|利用期間|validity)\s*[:：]?\s*([^\n\r。]+)", re.IGNORECASE),
    re.compile(r"(GB\s?使い切り|GB\s?소진\s?시까지|until\s+data\s+is\s+used)", re.IGNORECASE),
]


@dataclass
class ExtractedValue:
    value: str | int | None
    evidence: list[str]


@dataclass
class ValidityExtraction:
    usage_validity: str | None
    activation_validity: str | None
    usage_evidence: list[str]
    activation_evidence: list[str]


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def extract_price_jpy(texts: list[str]) -> ExtractedValue:
    for raw in texts:
        text = normalize_text(raw)
        m = PRICE_PATTERN.search(text)
        if not m:
            continue
        number = int(m.group(1).replace(",", ""))
        return ExtractedValue(number, [text[:180]])
    return ExtractedValue(None, [])


def parse_price_text(text: str) -> tuple[int | None, str | None]:
    normalized = normalize_text(text)
    amount_match = AMOUNT_PATTERN.search(normalized)
    if not amount_match:
        return None, None

    amount = int(amount_match.group(1).replace(",", ""))
    upper = normalized.upper()
    if "KRW" in upper:
        return amount, "KRW"
    if "USD" in upper:
        return amount, "USD"
    if "EUR" in upper:
        return amount, "EUR"
    if "JPY" in upper or "￥" in normalized or "¥" in normalized:
        return amount, "JPY"
    return amount, None


def extract_price_jpy_with_evidence(
    texts: list[str],
    assume_jpy_on_unknown_currency: bool = False,
) -> tuple[ExtractedValue, list[str]]:
    non_jpy_evidence: list[str] = []
    for raw in texts:
        text = normalize_text(raw)
        amount, currency = parse_price_text(text)
        if amount is None:
            continue
        if currency == "JPY":
            return ExtractedValue(amount, [text[:180]]), non_jpy_evidence
        if currency in {"KRW", "USD", "EUR"}:
            non_jpy_evidence.append(text[:180])
            continue
        if assume_jpy_on_unknown_currency:
            return ExtractedValue(amount, [f"{text[:150]} (assumed JPY by i18n-prefs)"]), non_jpy_evidence

    return ExtractedValue(None, []), non_jpy_evidence


def extract_data_amount(texts: list[str]) -> ExtractedValue:
    for raw in texts:
        text = normalize_text(raw)
        m = DATA_PATTERN.search(text)
        if not m:
            continue
        val = _normalize_data_amount(m.group(0))
        return ExtractedValue(val, [text[:180]])
    return ExtractedValue(None, [])


def _normalize_data_amount(raw_value: str) -> str:
    lower = raw_value.lower()
    if "無制限" in raw_value or "使い放題" in raw_value or "unlimited" in lower:
        return "unlimited"

    m = re.search(r"(\d+)\s?gb", lower, re.IGNORECASE)
    if m:
        return f"{m.group(1)}GB"
    return raw_value


def extract_validity(texts: list[str]) -> ExtractedValue:
    split = extract_validity_split(texts)
    if split.usage_validity:
        return ExtractedValue(split.usage_validity, split.usage_evidence)
    if split.activation_validity:
        return ExtractedValue(split.activation_validity, split.activation_evidence)
    return ExtractedValue(None, [])


def extract_validity_split(texts: list[str]) -> ValidityExtraction:
    usage_keywords = ("利用期間", "使用期間", "travel days", "days plan", "days")
    activation_keywords = ("有効期限", "受信後", "購入日", "以内", "activate", "有効化")
    noise_keywords = ("サポート", "お問い合わせ", "営業", "365日多言語", "24時間サポート")
    usage_validity: str | None = None
    activation_validity: str | None = None
    usage_evidence: list[str] = []
    activation_evidence: list[str] = []

    for idx, raw in enumerate(texts):
        text = normalize_text(raw)
        lower = text.lower()

        day_hits = re.findall(r"(\d{1,3})\s?(?:日間|日)", text, re.IGNORECASE)
        has_usage_context = any(k.lower() in lower for k in usage_keywords)
        has_activation_context = any(k.lower() in lower for k in activation_keywords)
        has_noise_context = any(k.lower() in lower for k in noise_keywords)
        has_plan_signal = (
            "日間" in text
            or "時間" in text
            or "プラン" in text
            or "無制限" in text
            or bool(re.search(r"\d+\s*GB", text, re.IGNORECASE))
        )

        if day_hits:
            # Title is usually the strongest signal for actual usage duration.
            if idx == 0 and not usage_validity:
                usage_validity = f"{day_hits[0]}일"
                usage_evidence.append(text[:180])
                if has_activation_context and len(day_hits) >= 2 and not activation_validity:
                    activation_validity = f"{day_hits[-1]}일"
                    activation_evidence.append(text[:180])
            elif has_usage_context and has_activation_context and len(day_hits) >= 2:
                if not usage_validity:
                    usage_validity = f"{day_hits[0]}일"
                    usage_evidence.append(text[:180])
                if not activation_validity:
                    activation_validity = f"{day_hits[-1]}일"
                    activation_evidence.append(text[:180])
            elif has_activation_context and len(day_hits) >= 2:
                if not usage_validity:
                    usage_validity = f"{day_hits[0]}일"
                    usage_evidence.append(text[:180])
                if not activation_validity:
                    activation_validity = f"{day_hits[-1]}일"
                    activation_evidence.append(text[:180])
            elif has_activation_context and not activation_validity:
                activation_validity = f"{day_hits[0]}일"
                activation_evidence.append(text[:180])
            elif (not usage_validity) and has_plan_signal and (not has_noise_context):
                usage_validity = f"{day_hits[0]}일"
                usage_evidence.append(text[:180])

        if not usage_validity:
            m_usage = re.search(r"(GB\s?使い切り|GB\s?소진\s?시까지|until\s+data\s+is\s+used)", text, re.IGNORECASE)
            if m_usage:
                usage_validity = m_usage.group(1)
                usage_evidence.append(text[:180])

        if (not usage_validity or not activation_validity) and ("有効期限" in text or "利用期間" in text):
            m_label = re.search(r"(?:有効期限|利用期間|validity)\s*[:：]?\s*([^\n\r。]+)", text, re.IGNORECASE)
            if m_label:
                captured = m_label.group(1).strip()
                captured_norm = _normalize_labeled_validity(captured)
                if not captured_norm:
                    continue
                if "有効期限" in text:
                    if not activation_validity:
                        activation_validity = captured_norm
                        activation_evidence.append(text[:180])
                elif not usage_validity:
                    usage_validity = captured_norm
                    usage_evidence.append(text[:180])

        if usage_validity and activation_validity:
            break

    usage_num = _extract_korean_days(usage_validity)
    activation_num = _extract_korean_days(activation_validity)
    if usage_num is not None and activation_num is not None and activation_num < usage_num:
        usage_validity, activation_validity = activation_validity, usage_validity
        usage_evidence, activation_evidence = activation_evidence, usage_evidence

    return ValidityExtraction(
        usage_validity=usage_validity,
        activation_validity=activation_validity,
        usage_evidence=usage_evidence,
        activation_evidence=activation_evidence,
    )


def _extract_korean_days(value: str | None) -> int | None:
    if not value:
        return None
    m = re.search(r"(\d{1,4})\s*일", value)
    if m:
        return int(m.group(1))
    return None


def _normalize_labeled_validity(value: str) -> str | None:
    text = normalize_text(value)
    day = re.search(r"(\d{1,4})\s?(?:日間|日)", text)
    if day:
        return f"{day.group(1)}일"
    if re.search(r"(GB\s?使い切り|until\s+data\s+is\s+used)", text, re.IGNORECASE):
        return "GB使い切り"
    return None


def extract_network_type(texts: list[str]) -> tuple[NetworkType, list[str]]:
    local_words = ("現地回線", "現地通信", "ローカル回線", "local")
    roaming_words = ("ローミング", "国際ローミング", "roaming")
    for raw in texts:
        text = normalize_text(raw)
        lower = text.lower()
        if any(word.lower() in lower for word in local_words):
            return NetworkType.local, [text[:180]]
        if any(word.lower() in lower for word in roaming_words):
            return NetworkType.roaming, [text[:180]]
    return NetworkType.unknown, []


def extract_carrier_support_kr(texts: list[str]) -> tuple[CarrierSupportKR, list[str]]:
    support = CarrierSupportKR()
    evidence: list[str] = []
    for raw in texts:
        text = normalize_text(raw)
        lower = text.lower()
        if "韓国" not in text and "korea" not in lower:
            continue

        matched = False
        if "skt" in lower:
            support.skt = True
            matched = True
        if re.search(r"\bkt\b", lower):
            support.kt = True
            matched = True
        if "lg u+" in lower or "lgu+" in lower or "uplus" in lower or "lgu" in lower:
            support.lgu = True
            matched = True

        if matched or ("対応キャリア" in text) or ("사용 가능" in text):
            evidence.append(text[:180])

    return support, evidence


def extract_asin(url: str) -> str | None:
    match = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", url)
    if match:
        return match.group(1)
    return None
