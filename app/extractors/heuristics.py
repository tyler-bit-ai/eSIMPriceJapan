from __future__ import annotations

import re
from dataclasses import dataclass

from app.models import CarrierSupportKR, NetworkType

PRICE_PATTERN = re.compile(r"(?:(?:￥|¥|JPY\s?)\s*([0-9][0-9,]*)|([0-9][0-9,]*)\s*円)")
AMOUNT_PATTERN = re.compile(r"([0-9][0-9,]+)")
DATA_PATTERN = re.compile(r"(?:(\d+)\s?GB|無制限|使い放題|unlimited)", re.IGNORECASE)
VALIDITY_PATTERNS = [
    re.compile(r"(\d{1,3})\s?(?:日間|日)\s?(?:有効|利用|利用可能|validity)?", re.IGNORECASE),
    re.compile(r"(\d{1,3})\s?(?:時間|hour|hours)\b", re.IGNORECASE),
    re.compile(r"(?:有効期限|利用期間|validity)\s*[:：]?\s*([^\n\r。]+)", re.IGNORECASE),
    re.compile(r"(GB\s?使い切り|GB\s?소진\s?시까지|until\s+data\s+is\s+used)", re.IGNORECASE),
]


@dataclass
class ExtractedValue:
    value: str | int | bool | None
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
        numeric = m.group(1) or m.group(2)
        if not numeric:
            continue
        number = int(numeric.replace(",", ""))
        return ExtractedValue(number, [text[:180]])
    return ExtractedValue(None, [])


def parse_price_text(text: str) -> tuple[int | None, str | None]:
    normalized = normalize_text(text)
    amount_match = AMOUNT_PATTERN.search(normalized)
    if not amount_match:
        return None, None

    amount = int(amount_match.group(1).replace(",", ""))
    upper = normalized.upper()
    if "SGD" in upper or "S$" in normalized:
        return amount, "SGD"
    if "KRW" in upper:
        return amount, "KRW"
    if "USD" in upper:
        return amount, "USD"
    if "EUR" in upper:
        return amount, "EUR"
    if "JPY" in upper or "￥" in normalized or "¥" in normalized or "円" in normalized:
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
    activation_keywords = ("有効期限", "受信後", "購入日", "ご購入日", "activate", "有効化")
    noise_keywords = ("サポート", "お問い合わせ", "営業", "365日多言語", "24時間サポート")
    usage_validity: str | None = None
    activation_validity: str | None = None
    usage_evidence: list[str] = []
    activation_evidence: list[str] = []

    for idx, raw in enumerate(texts):
        text = normalize_text(raw)
        lower = text.lower()

        day_hits = _extract_day_hits(text)
        hour_hits = re.findall(r"(\d{1,3})\s?(?:時間|hour|hours)\b", text, re.IGNORECASE)
        normalized_day_hits = [str(_hours_to_days(int(hour))) for hour in hour_hits if _hours_to_days(int(hour)) is not None]
        duration_hits = day_hits + normalized_day_hits
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

        if duration_hits:
            # Title is usually the strongest signal for actual usage duration.
            if idx == 0 and not usage_validity:
                usage_validity = f"{duration_hits[0]}일"
                usage_evidence.append(text[:180])
                if has_activation_context and len(duration_hits) >= 2 and not activation_validity:
                    activation_validity = f"{duration_hits[-1]}일"
                    activation_evidence.append(text[:180])
            elif has_usage_context and has_activation_context and len(duration_hits) >= 2:
                if not usage_validity:
                    usage_validity = f"{duration_hits[0]}일"
                    usage_evidence.append(text[:180])
                if not activation_validity:
                    activation_validity = f"{duration_hits[-1]}일"
                    activation_evidence.append(text[:180])
            elif has_activation_context and len(duration_hits) >= 2:
                if not usage_validity:
                    usage_validity = f"{duration_hits[0]}일"
                    usage_evidence.append(text[:180])
                if not activation_validity:
                    activation_validity = f"{duration_hits[-1]}일"
                    activation_evidence.append(text[:180])
            elif has_activation_context and not activation_validity:
                activation_validity = f"{duration_hits[0]}일"
                activation_evidence.append(text[:180])
            elif (not usage_validity) and has_plan_signal and (not has_noise_context):
                usage_validity = f"{duration_hits[0]}일"
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
    day = re.search(r"(\d{1,4})(?:\s*[-~〜]\s*\d{1,4})?\s?(?:日間|日)", text)
    if day:
        return f"{day.group(1)}일"
    hours = re.search(r"(\d{1,4})\s?(?:時間|hour|hours)\b", text, re.IGNORECASE)
    if hours:
        days = _hours_to_days(int(hours.group(1)))
        if days is not None:
            return f"{days}일"
    if re.search(r"(GB\s?使い切り|until\s+data\s+is\s+used)", text, re.IGNORECASE):
        return "GB使い切り"
    return None


def _hours_to_days(hours: int) -> int | None:
    if hours <= 0:
        return None
    return max(1, hours // 24)


def _extract_day_hits(text: str) -> list[str]:
    hits: list[str] = []
    for match in re.finditer(r"(\d{1,4})(?:\s*[-~〜]\s*\d{1,4})?\s?(?:日間|日)", text, re.IGNORECASE):
        hits.append(match.group(1))
    return hits


def extract_network_type(texts: list[str]) -> tuple[NetworkType, list[str]]:
    local_score = 0
    roaming_score = 0
    local_hits: list[str] = []
    roaming_hits: list[str] = []

    local_strong_patterns = [
        re.compile(r"現地回線"),
        re.compile(r"現地通信"),
        re.compile(r"現地キャリア"),
        re.compile(r"ローカル回線"),
        re.compile(r"local\s+(?:network|carrier)", re.IGNORECASE),
    ]
    roaming_strong_patterns = [
        re.compile(r"国際ローミング"),
        re.compile(r"データローミング"),
        re.compile(r"ローミング設定"),
        re.compile(r"data\s+roaming", re.IGNORECASE),
    ]
    roaming_noise_patterns = [
        re.compile(r"ローミングセンター"),
        re.compile(r"roaming\s+center", re.IGNORECASE),
    ]
    roaming_negative_patterns = [
        re.compile(r"ローミング不要"),
        re.compile(r"非ローミング"),
        re.compile(r"no\s+roaming", re.IGNORECASE),
    ]
    noise_penalty_applied = False
    negative_penalty_applied = False

    for raw in texts:
        text = normalize_text(raw)
        lower = text.lower()

        has_local_strong = any(p.search(text) for p in local_strong_patterns)
        has_roaming_strong = any(p.search(text) for p in roaming_strong_patterns)
        has_roaming_noise = any(p.search(text) for p in roaming_noise_patterns)
        has_roaming_negative = any(p.search(text) for p in roaming_negative_patterns)

        if has_local_strong:
            local_score += 3
            local_hits.append(text[:180])
        elif "ローカル" in text or re.search(r"\blocal\b", lower):
            local_score += 1
            local_hits.append(text[:180])

        if has_roaming_negative and not negative_penalty_applied:
            roaming_score -= 2
            negative_penalty_applied = True

        if has_roaming_strong and not has_roaming_negative:
            roaming_score += 3
            roaming_hits.append(text[:180])
        elif ("ローミング" in text or re.search(r"\broaming\b", lower)) and not has_roaming_noise and not has_roaming_negative:
            roaming_score += 1
            roaming_hits.append(text[:180])
        elif has_roaming_noise and ("ローミング" in text or re.search(r"\broaming\b", lower)) and not noise_penalty_applied:
            roaming_score += 0
            noise_penalty_applied = True

    local_threshold = 2
    roaming_threshold = 2
    if local_score >= local_threshold and roaming_score <= 1:
        evidence = local_hits[:2] + [f"score: local={local_score}, roaming={roaming_score}"]
        return NetworkType.local, evidence
    if roaming_score >= roaming_threshold and local_score <= 1:
        evidence = roaming_hits[:2] + [f"score: local={local_score}, roaming={roaming_score}"]
        return NetworkType.roaming, evidence

    evidence = []
    if local_hits:
        evidence.append(f"local_signal: {local_hits[0]}")
    if roaming_hits:
        evidence.append(f"roaming_signal: {roaming_hits[0]}")
    if local_score != 0 or roaming_score != 0:
        evidence.append(f"insufficient_or_conflicting_signals(local={local_score}, roaming={roaming_score})")
    return NetworkType.unknown, evidence


def extract_carrier_support_kr(texts: list[str]) -> tuple[CarrierSupportKR, list[str]]:
    support = CarrierSupportKR()
    evidence: list[str] = []
    for raw in texts:
        text = normalize_text(raw)
        lower = text.lower()
        if "韓国" not in text and "korea" not in lower:
            continue

        matched = False
        if "skt" in lower or "sk telecom" in lower or "sktelecom" in lower:
            support.skt = True
            matched = True
        if re.search(r"\bkt\b", lower) or "kt japan" in lower:
            support.kt = True
            matched = True
        if "lg u+" in lower or "lgu+" in lower or "uplus" in lower or "lgu" in lower or "u+" in lower:
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


def extract_monthly_sold_count(texts: list[str]) -> ExtractedValue:
    patterns = [
        re.compile(r"過去1か月で\s*([0-9][0-9,]*)\s*点以上購入されました"),
        re.compile(r"([0-9][0-9,]*)\s*点以上購入されました"),
        re.compile(r"([0-9][0-9,]*)\+?\s*bought in past month", re.IGNORECASE),
    ]
    for raw in texts:
        text = normalize_text(raw)
        for pat in patterns:
            m = pat.search(text)
            if not m:
                continue
            return ExtractedValue(int(m.group(1).replace(",", "")), [text[:180]])
    return ExtractedValue(None, [])


def extract_bestseller_badge(texts: list[str]) -> ExtractedValue:
    for raw in texts:
        text = normalize_text(raw)
        lower = text.lower()
        if "ベストセラー" in text or "best seller" in lower:
            return ExtractedValue(True, [text[:180]])
    return ExtractedValue(None, [])


def extract_bestseller_rank(texts: list[str]) -> ExtractedValue:
    best_rank: int | None = None
    best_evidence: str | None = None
    for raw in texts:
        text = normalize_text(raw)
        if "売れ筋ランキング" not in text and "best sellers rank" not in text.lower():
            continue

        for m in re.finditer(r"([0-9][0-9,]*)\s*位", text):
            rank = int(m.group(1).replace(",", ""))
            if best_rank is None or rank < best_rank:
                best_rank = rank
                best_evidence = text[:180]

    if best_rank is not None:
        return ExtractedValue(best_rank, [best_evidence] if best_evidence else [])
    return ExtractedValue(None, [])
