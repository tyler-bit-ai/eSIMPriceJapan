from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote_plus, urlparse

from bs4 import BeautifulSoup
from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from app.adapters.base import MarketplaceAdapter
from app.extractors.heuristics import (
    ExtractedValue,
    extract_carrier_support_for_country,
    extract_data_amount,
    extract_network_type,
    extract_price_jpy_with_evidence,
    extract_validity_split,
    normalize_text,
    parse_price_text,
)
from app.models import CarrierSupportKR, ProductDetail, ProductStub

logger = logging.getLogger(__name__)


@dataclass
class TitleSignals:
    usage_days: float | None
    activation_days: int | None
    data_amount: str | None
    carrier_tokens: set[str]


@dataclass
class OptionCandidate:
    label: str
    option_value: str
    surcharge_jpy: int
    absolute_price_jpy: int | None
    usage_days: float | None
    activation_days: int | None
    data_amount: str | None
    carrier_tokens: set[str]
    raw_text: str


class Qoo10JPAdapter(MarketplaceAdapter):
    name = "qoo10_jp"

    def __init__(self, browser: Browser, context: BrowserContext, screenshot_dir: Path):
        self.browser = browser
        self.context = context
        self.screenshot_dir = screenshot_dir
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    async def create(cls, screenshot_dir: Path) -> "Qoo10JPAdapter":
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            locale="ja-JP",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0.0.0 Safari/537.36"
            ),
            extra_http_headers={
                "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
            },
        )
        adapter = cls(browser=browser, context=context, screenshot_dir=screenshot_dir)
        adapter._playwright = pw
        return adapter

    async def close(self) -> None:
        await self.context.close()
        await self.browser.close()
        await self._playwright.stop()

    async def _new_page(self) -> Page:
        page = await self.context.new_page()
        page.set_default_timeout(25_000)
        return page

    async def search(self, query: str, limit: int) -> list[ProductStub]:
        page = await self._new_page()
        try:
            encoded = quote_plus(query)
            url = f"https://www.qoo10.jp/s/ESIM?keyword={encoded}"
            await page.goto(url, wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)

            unique: list[ProductStub] = []
            seen_ids: set[str] = set()
            seen_urls: set[str] = set()
            append_round = 0

            while len(unique) < limit:
                html = await page.content()
                soup = BeautifulSoup(html, "lxml")

                added_this_round = 0
                for card in self._iter_search_cards(soup):
                    stub = self._parse_search_card(card, search_position=len(unique) + 1)
                    if not stub:
                        continue
                    if stub.site_product_id and stub.site_product_id in seen_ids:
                        continue
                    if str(stub.product_url) in seen_urls:
                        continue

                    if stub.site_product_id:
                        seen_ids.add(stub.site_product_id)
                    seen_urls.add(str(stub.product_url))
                    unique.append(stub)
                    added_this_round += 1
                    if len(unique) >= limit:
                        break

                if len(unique) >= limit:
                    break

                if added_this_round == 0 and append_round > 0:
                    logger.info("qoo10 search stopped: no new items after append round %s", append_round)
                    break

                clicked_more = await self._click_more_results(page, append_round + 1)
                if not clicked_more:
                    break
                append_round += 1

            logger.info("found %s qoo10 candidate products", len(unique))
            return unique
        finally:
            await page.close()

    async def _click_more_results(self, page: Page, round_number: int) -> bool:
        button = page.locator("#btn_more_item")
        if await button.count() == 0:
            return False
        if not await button.is_visible():
            return False
        if not await button.is_enabled():
            return False

        before_rows = await page.locator("tr[goodscode]").count()
        await button.click()
        await page.wait_for_timeout(1800)

        for _ in range(8):
            current_rows = await page.locator("tr[goodscode]").count()
            if current_rows > before_rows:
                logger.info(
                    "qoo10 search append round %s: rows %s -> %s",
                    round_number,
                    before_rows,
                    current_rows,
                )
                return True
            await page.wait_for_timeout(700)

        logger.info("qoo10 search append round %s: no additional rows detected", round_number)
        return False

    async def fetch_detail(self, stub: ProductStub) -> ProductDetail:
        page = await self._new_page()
        evidence: dict[str, list[str]] = {}
        try:
            await page.goto(str(stub.product_url), wait_until="domcontentloaded")
            await page.wait_for_timeout(1200)

            html = await page.content()
            soup = BeautifulSoup(html, "lxml")

            title = self._extract_title(soup)
            if title:
                evidence["title"] = [title]

            text_blocks = self._collect_text_blocks(soup)
            base_price_texts = self._collect_price_candidates(soup, text_blocks)
            base_price, non_jpy_evidence = self._extract_detail_price(base_price_texts)

            option_candidates = self._extract_option_candidates(soup)
            title_signals = self._extract_title_signals(title or "")
            representative_option, option_reason = self._select_representative_option(
                title_signals=title_signals,
                options=option_candidates,
            )
            if option_candidates:
                evidence["option_candidates"] = [opt.raw_text[:180] for opt in option_candidates[:3]]
            if representative_option:
                evidence["representative_option"] = [
                    representative_option.raw_text[:180],
                    option_reason,
                ]
            elif option_candidates:
                evidence["option_resolution"] = ["no_confident_option_match", option_reason]

            if non_jpy_evidence:
                evidence["non_jpy_price"] = non_jpy_evidence

            price = self._resolve_price(
                base_price=base_price,
                stub=stub,
                representative_option=representative_option,
                unresolved_options=bool(option_candidates and not representative_option),
            )
            if price.evidence:
                evidence["price_jpy"] = price.evidence
            elif non_jpy_evidence:
                evidence["price_jpy"] = ["no_jpy_price_found_in_primary_selectors"]

            validity_texts = [title] + text_blocks if title else text_blocks
            text_validity = extract_validity_split(validity_texts)
            resolved_usage, resolved_activation = self._resolve_validity(
                text_validity=text_validity,
                representative_option=representative_option,
                unresolved_options=bool(option_candidates and not representative_option),
            )
            if representative_option and representative_option.usage_days is not None:
                evidence["usage_validity"] = [representative_option.raw_text[:180]]
            elif resolved_usage and text_validity.usage_evidence:
                evidence["usage_validity"] = text_validity.usage_evidence
            if representative_option and representative_option.activation_days is not None:
                evidence["activation_validity"] = [representative_option.raw_text[:180]]
            elif resolved_activation and text_validity.activation_evidence:
                evidence["activation_validity"] = text_validity.activation_evidence

            data_amount = self._resolve_data_amount(
                validity_texts=validity_texts,
                title=title or "",
                option_candidates=option_candidates,
                representative_option=representative_option,
                unresolved_options=bool(option_candidates and not representative_option),
            )
            if representative_option and representative_option.data_amount:
                evidence["data_amount"] = [representative_option.raw_text[:180]]
            elif data_amount.evidence:
                evidence["data_amount"] = data_amount.evidence

            network_type, network_ev = self._resolve_network_type(
                validity_texts=validity_texts,
                title=title or "",
                representative_option=representative_option,
            )
            if network_ev:
                evidence["network_type"] = network_ev
            else:
                evidence["network_type"] = ["no_local_or_roaming_keyword_matched"]

            carrier_texts = list(validity_texts)
            if representative_option:
                carrier_texts.insert(0, representative_option.raw_text)
            carrier_support_local, carrier_support_kr, carrier_ev = self._extract_carrier_support(
                text_blocks=carrier_texts,
                country=stub.country,
            )
            if carrier_ev:
                evidence["carrier_support_local"] = carrier_ev

            seller = stub.search_seller or self._extract_detail_seller(text_blocks)
            if seller:
                evidence["seller"] = [seller]

            review_count = stub.search_review_count
            if review_count is not None:
                evidence["review_count"] = [f"search_result: {review_count}"]
            else:
                review_count = self._extract_detail_review_count(validity_texts)
                if review_count is not None:
                    evidence["review_count"] = [f"detail_page: {review_count}"]

            seller_badge = stub.search_seller_badge
            if seller_badge:
                evidence["seller_badge"] = [f"search_result: {seller_badge}"]

            detail = ProductDetail(
                site=self.name,
                country=stub.country,
                title=title,
                price_jpy=price.value if isinstance(price.value, int) else None,
                review_count=review_count,
                seller_badge=seller_badge,
                search_position=stub.search_position,
                monthly_sold_count=None,
                is_bestseller=None,
                bestseller_rank=None,
                validity=resolved_usage or resolved_activation,
                usage_validity=resolved_usage,
                activation_validity=resolved_activation,
                network_type=network_type,
                carrier_support_local=carrier_support_local,
                carrier_support_kr=carrier_support_kr,
                data_amount=data_amount.value if isinstance(data_amount.value, str) else None,
                product_url=stub.product_url,
                asin=None,
                site_product_id=stub.site_product_id or self.extract_site_product_id(str(stub.product_url)),
                seller=seller,
                brand=None,
                evidence=evidence,
            )
            return detail
        except Exception as exc:
            shot = self.screenshot_dir / f"detail_error_{stub.site_product_id or 'unknown'}.png"
            await page.screenshot(path=str(shot), full_page=True)
            raise RuntimeError(f"detail parsing failed: {exc}; screenshot={shot}") from exc
        finally:
            await page.close()

    def _extract_carrier_support(
        self,
        text_blocks: list[str],
        country: str | None,
    ) -> tuple[dict[str, bool | None], CarrierSupportKR, list[str]]:
        return extract_carrier_support_for_country(text_blocks, country)

    def _iter_search_cards(self, soup: BeautifulSoup) -> list[BeautifulSoup]:
        cards: list[BeautifulSoup] = []
        for card in soup.select("tr"):
            text = normalize_text(card.get_text(" ", strip=True))
            if "/item/" not in str(card) or not text:
                continue
            if "韓国" not in text and "eSIM" not in text and "SIM" not in text:
                continue
            cards.append(card)
        return cards

    def _parse_search_card(self, card: BeautifulSoup, search_position: int) -> ProductStub | None:
        title_link = card.select_one("div.sbj a[href*='/item/'][title]") or card.select_one(
            "a[href*='/item/'][title]"
        )
        href = title_link.get("href") if title_link else None
        if not href:
            href = self._extract_first_item_href(card)
        full = self._normalize_product_url(href)
        if not full:
            return None

        site_product_id = (
            self.extract_site_product_id(full)
            or self._extract_attr_value(card, "goodscode")
            or self._extract_attr_value(card, "data-goodscode")
        )
        card_text = normalize_text(card.get_text(" ", strip=True))
        review_count = self._extract_search_review_count(card_text)
        seller, seller_badge = self._extract_search_seller_info(card_text)
        price_text = self._extract_search_price_text(card)
        price_jpy = None
        if price_text:
            amount, currency = parse_price_text(price_text)
            if amount is not None and (currency == "JPY" or currency is None):
                price_jpy = amount

        if not price_text:
            amount = self._extract_best_price_from_text(card_text)
            if amount is not None:
                price_jpy = amount
                price_text = f"{amount}円"

        return ProductStub(
            site=self.name,
            product_url=full,
            asin=None,
            site_product_id=site_product_id,
            search_position=search_position,
            search_price_jpy=price_jpy,
            search_price_text=price_text,
            search_review_count=review_count,
            search_seller=seller,
            search_seller_badge=seller_badge,
            search_monthly_sold_count=None,
            search_is_bestseller=None,
        )

    def _collect_text_blocks(self, soup: BeautifulSoup) -> list[str]:
        blocks: list[str] = []
        selectors = [
            "meta[property='og:title']",
            "meta[name='description']",
            "#item_detail",
            "#goods_info",
            "#tabCon",
            "#item_contents",
            "table",
            "dl",
            ".option_select",
            ".review_list",
        ]
        for selector in selectors:
            for node in soup.select(selector):
                if node.name == "meta":
                    text = node.get("content") or ""
                else:
                    text = node.get_text(" ", strip=True)
                text = normalize_text(text)
                if text:
                    blocks.append(text[:1500])

        all_text = normalize_text(soup.get_text(" ", strip=True))
        if all_text:
            blocks.append(all_text[:7000])
        return blocks

    def _collect_price_candidates(self, soup: BeautifulSoup, text_blocks: list[str]) -> list[str]:
        candidates: list[str] = []
        for block in text_blocks:
            for line in self._extract_price_contexts(block):
                candidates.append(line)
        selectors = [
            ".price",
            ".price_area",
            ".sales_price",
            ".good_price",
            "meta[property='product:price:amount']",
        ]
        for selector in selectors:
            for node in soup.select(selector):
                if node.name == "meta":
                    text = node.get("content") or ""
                else:
                    text = node.get_text(" ", strip=True)
                text = normalize_text(text)
                if text:
                    candidates.append(text)
        return candidates[:20]

    def _extract_detail_price(self, candidates: list[str]) -> tuple[ExtractedValue, list[str]]:
        price, non_jpy_evidence = extract_price_jpy_with_evidence(
            candidates,
            assume_jpy_on_unknown_currency=False,
        )
        if isinstance(price.value, int):
            return price, non_jpy_evidence

        yen_candidates = [text for text in candidates if "円" in text or "¥" in text or "￥" in text]
        if yen_candidates:
            return extract_price_jpy_with_evidence(
                yen_candidates,
                assume_jpy_on_unknown_currency=False,
            )

        fallback_candidates = [text for text in candidates if "$" not in text]
        if fallback_candidates:
            return extract_price_jpy_with_evidence(
                fallback_candidates,
                assume_jpy_on_unknown_currency=True,
            )

        return price, non_jpy_evidence

    def _extract_price_contexts(self, text: str) -> list[str]:
        contexts: list[str] = []
        patterns = [
            r"(?:販売価格|商品価格|最大割引価格|割引価格)\s*[:：]?\s*[¥￥]?\s*[0-9][0-9,]*\s*円?",
            r"(?:販売価格|商品価格|最大割引価格|割引価格)\s*[:：]?\s*[0-9][0-9,]*",
        ]
        for pattern in patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                snippet = normalize_text(match.group(0))
                if snippet:
                    contexts.append(snippet)
        return contexts

    def _extract_option_candidates(self, soup: BeautifulSoup) -> list[OptionCandidate]:
        candidates: list[OptionCandidate] = []
        seen: set[tuple[str, str]] = set()
        for select in soup.select("select"):
            select_id = (select.get("id") or "").strip()
            if select_id == "selectbox_____furusato_type":
                continue
            options = select.select("option")
            if not options:
                continue
            for option in options:
                label = normalize_text(option.get_text(" ", strip=True))
                if not label or label == "選択してください。":
                    continue
                parsed = self._parse_option_candidate(label, option.get("value") or "")
                if not parsed:
                    continue
                key = (parsed.option_value, parsed.raw_text)
                if key in seen:
                    continue
                seen.add(key)
                candidates.append(parsed)
        return candidates

    def _parse_option_candidate(self, label: str, option_value: str) -> OptionCandidate | None:
        lower = label.lower()
        if any(
            token in lower
            for token in [
                "返品",
                "交換",
                "ご利用不可",
                "対応端末",
                "注意事項",
                "承っておりません",
                "選択してください",
                "受取確認",
                "チャージ必須",
            ]
        ) and not self._has_plan_signals(label):
            return None
        if "受取確認" in lower or "チャージ必須" in lower:
            return None
        if not self._has_plan_signals(label):
            return None

        surcharge = 0
        surcharge_match = re.search(r"\(([+-]?\d[\d,]*)円\)", label)
        if surcharge_match:
            surcharge_text = surcharge_match.group(1)
            sign = -1 if surcharge_text.startswith("-") else 1
            surcharge = sign * int(re.sub(r"[^\d]", "", surcharge_text))

        absolute_price_jpy = None
        if surcharge_match is None:
            amount, currency = parse_price_text(label)
            if amount is not None and currency == "JPY":
                absolute_price_jpy = amount

        usage_days = self._extract_usage_days_float(label)
        activation_days = self._extract_activation_days_int(label)
        data_amount = self._extract_option_data_amount(label)
        carrier_tokens = self._extract_carrier_tokens(label)
        return OptionCandidate(
            label=label,
            option_value=str(option_value).strip(),
            surcharge_jpy=surcharge,
            absolute_price_jpy=absolute_price_jpy,
            usage_days=usage_days,
            activation_days=activation_days,
            data_amount=data_amount,
            carrier_tokens=carrier_tokens,
            raw_text=label,
        )

    def _has_plan_signals(self, text: str) -> bool:
        lower = text.lower()
        return any(
            signal in text or signal in lower
            for signal in ["日", "時間", "無制限", "gb", "giga", "有効期間", "購入日", "skt", "kt", "lgu", "u+"]
        )

    def _extract_title_signals(self, title: str) -> TitleSignals:
        validity = extract_validity_split([title] if title else [])
        data_amount = self._extract_option_data_amount(title)
        usage_days = self._extract_usage_days_float(title)
        activation_days = None
        if validity.activation_validity:
            activation_days = self._extract_korean_day_value(validity.activation_validity)
        return TitleSignals(
            usage_days=usage_days,
            activation_days=activation_days,
            data_amount=data_amount,
            carrier_tokens=self._extract_carrier_tokens(title),
        )

    def _select_representative_option(
        self,
        title_signals: TitleSignals,
        options: list[OptionCandidate],
    ) -> tuple[OptionCandidate | None, str]:
        if not options:
            return None, "no_option_candidates"

        has_title_signal = any(
            [
                title_signals.usage_days is not None,
                title_signals.activation_days is not None,
                title_signals.data_amount is not None,
                bool(title_signals.carrier_tokens),
            ]
        )

        ranked: list[tuple[int, int, float, int, OptionCandidate]] = []
        for option in options:
            score = self._score_option_against_title(title_signals, option)
            surcharge = option.surcharge_jpy
            usage_distance = self._usage_distance(title_signals.usage_days, option.usage_days)
            ranked.append((score, surcharge, usage_distance, len(option.raw_text), option))

        ranked.sort(key=lambda item: (-item[0], item[1], item[2], item[3]))
        best_score, _, _, _, best_option = ranked[0]
        if has_title_signal:
            if best_score >= 4:
                return best_option, f"title_match_score={best_score}"
            return None, f"title_match_score={best_score}"

        base_option = min(
            options,
            key=lambda option: (
                option.surcharge_jpy if option.absolute_price_jpy is None else option.absolute_price_jpy,
                math.ceil(option.usage_days) if option.usage_days is not None else 999,
                len(option.raw_text),
            ),
        )
        return base_option, "fallback_base_option"

    def _score_option_against_title(self, title_signals: TitleSignals, option: OptionCandidate) -> int:
        score = 0
        if title_signals.usage_days is not None and option.usage_days is not None:
            if math.isclose(title_signals.usage_days, option.usage_days, abs_tol=0.05):
                score += 6
            elif math.ceil(title_signals.usage_days) == math.ceil(option.usage_days):
                score += 5
            elif abs(title_signals.usage_days - option.usage_days) <= 1:
                score += 2
            else:
                score -= 2
        if title_signals.activation_days is not None and option.activation_days is not None:
            if title_signals.activation_days == option.activation_days:
                score += 3
            else:
                score -= 1
        if title_signals.data_amount and option.data_amount:
            if title_signals.data_amount == option.data_amount:
                score += 2
            else:
                score -= 1
        overlap = title_signals.carrier_tokens & option.carrier_tokens
        score += len(overlap)
        if title_signals.carrier_tokens and option.carrier_tokens and not overlap:
            score -= 1
        return score

    def _usage_distance(self, title_usage: float | None, option_usage: float | None) -> float:
        if title_usage is None or option_usage is None:
            return 999.0
        return abs(title_usage - option_usage)

    def _resolve_price(
        self,
        base_price: ExtractedValue,
        stub: ProductStub,
        representative_option: OptionCandidate | None,
        unresolved_options: bool,
    ) -> ExtractedValue:
        if representative_option:
            if representative_option.absolute_price_jpy is not None:
                if representative_option.absolute_price_jpy <= 0:
                    return ExtractedValue(None, ["representative_option_absolute_price_non_positive"])
                return ExtractedValue(
                    representative_option.absolute_price_jpy,
                    [f"{representative_option.raw_text[:140]} (option absolute price)"],
                )
            if isinstance(base_price.value, int):
                computed_price = base_price.value + representative_option.surcharge_jpy
                if computed_price <= 0:
                    return ExtractedValue(
                        None,
                        [
                            "representative_option_resolved_to_non_positive_price",
                            f"{base_price.evidence[0] if base_price.evidence else base_price.value} + option surcharge {representative_option.surcharge_jpy}",
                            representative_option.raw_text[:140],
                        ],
                    )
                return ExtractedValue(
                    computed_price,
                    [
                        f"{base_price.evidence[0] if base_price.evidence else base_price.value} + option surcharge {representative_option.surcharge_jpy}",
                        representative_option.raw_text[:140],
                    ],
                )
        if unresolved_options:
            return ExtractedValue(None, ["option_candidates_present_but_no_confident_representative_match"])
        if isinstance(base_price.value, int):
            if base_price.value <= 0:
                return ExtractedValue(None, ["base_price_non_positive"])
            return base_price
        if stub.search_price_jpy is not None and stub.search_price_jpy > 0:
            return ExtractedValue(
                stub.search_price_jpy,
                [f"search_result_fallback: {stub.search_price_text or stub.search_price_jpy}"],
            )
        return ExtractedValue(None, ["no_jpy_price_found_in_primary_selectors"])

    def _resolve_validity(
        self,
        text_validity,
        representative_option: OptionCandidate | None,
        unresolved_options: bool,
    ) -> tuple[str | None, str | None]:
        if representative_option:
            usage = self._format_usage_days(representative_option.usage_days)
            activation = self._format_activation_days(representative_option.activation_days)
            if not usage:
                usage = text_validity.usage_validity
            if not activation and not unresolved_options:
                activation = text_validity.activation_validity
            return usage, activation
        if unresolved_options:
            return None, None
        return text_validity.usage_validity, text_validity.activation_validity

    def _resolve_data_amount(
        self,
        validity_texts: list[str],
        title: str,
        option_candidates: list[OptionCandidate],
        representative_option: OptionCandidate | None,
        unresolved_options: bool,
    ) -> ExtractedValue:
        if representative_option and representative_option.data_amount:
            return ExtractedValue(representative_option.data_amount, [representative_option.raw_text[:180]])

        direct = extract_data_amount(validity_texts)
        if isinstance(direct.value, str) and not unresolved_options:
            return direct

        if unresolved_options:
            fallback = self._resolve_data_amount_from_qoo10_signals(title, option_candidates)
            if fallback:
                return fallback
            return ExtractedValue(None, ["option_candidates_present_but_no_confident_representative_match"])

        return direct

    def _resolve_data_amount_from_qoo10_signals(
        self,
        title: str,
        option_candidates: list[OptionCandidate],
    ) -> ExtractedValue | None:
        title_amount = self._extract_option_data_amount(title)
        if title_amount == "unlimited":
            return ExtractedValue("unlimited", [f"qoo10_title_fallback: {title[:160]}"])

        option_amounts = [opt.data_amount for opt in option_candidates if opt.data_amount]
        if not option_amounts:
            return None

        unique_amounts = set(option_amounts)
        if len(unique_amounts) == 1:
            value = option_amounts[0]
            reason = "qoo10_option_consensus"
            if title_amount and title_amount == value:
                reason = "qoo10_title_and_option_consensus"
            return ExtractedValue(value, [f"{reason}: {option_candidates[0].raw_text[:160]}"])

        if title_amount and title_amount in unique_amounts:
            matching = [opt for opt in option_candidates if opt.data_amount == title_amount]
            if len(matching) >= max(2, len(option_candidates) // 2):
                return ExtractedValue(
                    title_amount,
                    [f"qoo10_option_majority_with_title: {matching[0].raw_text[:160]}"],
                )

        return None

    def _resolve_network_type(
        self,
        validity_texts: list[str],
        title: str,
        representative_option: OptionCandidate | None,
    ) -> tuple[str, list[str]]:
        texts = list(validity_texts)
        if representative_option:
            texts.insert(0, representative_option.raw_text)

        network_type, evidence = extract_network_type(texts)
        local_signals = self._collect_qoo10_local_signals(texts)
        roaming_signals = self._collect_qoo10_roaming_signals(texts)

        if network_type != "unknown":
            if network_type == "local" and local_signals:
                return "local", [f"qoo10_local_signal: {local_signals[0][:180]}"]
            if network_type == "roaming" and roaming_signals:
                return "roaming", [f"qoo10_roaming_signal: {roaming_signals[0][:180]}"]
            return network_type, evidence

        if local_signals and roaming_signals:
            return "unknown", [
                f"conflicting_qoo10_network_signals(local={len(local_signals)}, roaming={len(roaming_signals)})",
                local_signals[0][:180],
                roaming_signals[0][:180],
            ]
        if roaming_signals:
            return "roaming", [f"qoo10_roaming_signal: {roaming_signals[0][:180]}"]
        if local_signals:
            return "local", [f"qoo10_local_signal: {local_signals[0][:180]}"]
        return network_type, evidence

    def _collect_qoo10_local_signals(self, texts: list[str]) -> list[str]:
        patterns = [
            re.compile(r"現地番号"),
            re.compile(r"韓国国内通話"),
            re.compile(r"電話(?:番号)?付き"),
            re.compile(r"010電話番号"),
            re.compile(r"電話\s*/\s*SMS可", re.IGNORECASE),
            re.compile(r"SMS(?:受信|送受信)?可"),
        ]
        signals: list[str] = []
        for text in texts:
            if any(pattern.search(text) for pattern in patterns):
                signals.append(text)
        return signals

    def _collect_qoo10_roaming_signals(self, texts: list[str]) -> list[str]:
        patterns = [
            re.compile(r"国際ローミング"),
            re.compile(r"データローミング"),
            re.compile(r"ローミング設定"),
        ]
        signals: list[str] = []
        for text in texts:
            if any(pattern.search(text) for pattern in patterns):
                signals.append(text)
        return signals

    def _format_usage_days(self, usage_days: float | None) -> str | None:
        if usage_days is None:
            return None
        return f"{math.ceil(usage_days)}일"

    def _format_activation_days(self, activation_days: int | None) -> str | None:
        if activation_days is None:
            return None
        return f"{activation_days}일"

    def _extract_usage_days_float(self, text: str) -> float | None:
        day_matches: list[float] = []
        for match in re.finditer(r"(\d+(?:\.\d+)?)\s*日", text):
            day_matches.append(float(match.group(1)))
        if day_matches:
            return day_matches[0]
        hour_match = re.search(r"(\d{1,4})\s*時間", text)
        if hour_match:
            return int(hour_match.group(1)) / 24.0
        return None

    def _extract_activation_days_int(self, text: str) -> int | None:
        patterns = [
            r"(?:有効期間|有効期限)\s*[:：]?\s*(?:ご購入日より)?\s*(\d{1,4})\s*日",
            r"(?:ご購入日より|購入日より|受信後)\s*(\d{1,4})\s*日",
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return int(match.group(1))
        return None

    def _extract_option_data_amount(self, text: str) -> str | None:
        if "無限" in text:
            return "unlimited"
        extracted = extract_data_amount([text])
        return extracted.value if isinstance(extracted.value, str) else None

    def _extract_carrier_tokens(self, text: str) -> set[str]:
        lower = text.lower()
        tokens: set[str] = set()
        if "skt" in lower or "sk telecom" in lower or "sktelecom" in lower:
            tokens.add("skt")
        if re.search(r"\bkt\b", lower):
            tokens.add("kt")
        if "lg u+" in lower or "lgu+" in lower or "uplus" in lower or re.search(r"\bu\+\b", lower):
            tokens.add("lgu")
        return tokens

    def _extract_korean_day_value(self, value: str | None) -> int | None:
        if not value:
            return None
        match = re.search(r"(\d{1,4})\s*일", value)
        if match:
            return int(match.group(1))
        return None

    def _extract_title(self, soup: BeautifulSoup) -> str | None:
        selectors = [
            "meta[name='description']",
            "meta[property='og:title']",
            "title",
            "h1",
        ]
        for selector in selectors:
            node = soup.select_one(selector)
            if not node:
                continue
            text = node.get("content") if node.name == "meta" else node.get_text(" ", strip=True)
            text = normalize_text(text)
            if not text:
                continue
            if selector == "meta[name='description']":
                text = text.split("」", 1)[0].lstrip("「")
            if selector == "title" and " Qoo10" in text:
                text = text.split(" : ", 1)[0]
                text = re.sub(r"^\[Qoo10\]\s*", "", text)
            if selector == "meta[property='og:title']" and " : " in text:
                text = text.split(" : ", 1)[0]
                text = re.sub(r"^\[Qoo10\]\s*", "", text)
            return text[:300]
        return None

    def _extract_party(self, text_blocks: list[str], labels: tuple[str, ...]) -> str | None:
        for block in text_blocks:
            for label in labels:
                pattern = rf"{re.escape(label)}\s*[:：]?\s*([^\s][^|/\n\r]{1,80})"
                match = re.search(pattern, block, re.IGNORECASE)
                if match:
                    value = normalize_text(match.group(1))
                    value = re.split(r"(商品価格|レビュー|発送国|送料|返品|Qポイント)", value)[0].strip()
                    if value and value != label:
                        return value[:120]
        return None

    def _extract_detail_seller(self, text_blocks: list[str]) -> str | None:
        for block in text_blocks:
            match = re.search(r"(?:販売者|Seller|ショップ)\s*[:：]?\s*([^\n\r|]{1,80})", block, re.IGNORECASE)
            if not match:
                continue
            value = normalize_text(match.group(1))
            if not value:
                continue
            if any(token in value for token in ["返品", "交換", "ご連絡", "商品満足度", "レビュー", "A/S"]):
                continue
            value = re.split(r"(商品価格|レビュー|発送国|送料|返品|Qポイント|商品満足度|A/S情報)", value)[0].strip()
            if value:
                return value[:120]
        return None

    def _extract_detail_review_count(self, texts: list[str]) -> int | None:
        for text in texts:
            match = re.search(r"レビュー\s*(\d{1,6})", text)
            if match:
                return int(match.group(1))
        return None

    def _normalize_product_url(self, href: str | None) -> str | None:
        if not href:
            return None
        href = href.strip()
        if href.startswith("//"):
            href = f"https:{href}"
        if href.startswith("/"):
            href = f"https://www.qoo10.jp{href}"
        if not href.startswith("http"):
            return None
        if "qoo10.jp" not in href:
            return None
        if "/item/" not in href:
            return None
        href = href.split("?", 1)[0]
        return href

    @staticmethod
    def extract_site_product_id(url: str) -> str | None:
        match = re.search(r"/(\d{6,})$", urlparse(url).path)
        if match:
            return match.group(1)
        return None

    def _extract_first_item_href(self, card: BeautifulSoup) -> str | None:
        link = card.select_one("a[href*='/item/']")
        return link.get("href") if link else None

    def _extract_attr_value(self, card: BeautifulSoup, attr_name: str) -> str | None:
        node = card.select_one(f"[{attr_name}]")
        if not node:
            return None
        value = node.get(attr_name)
        return str(value).strip() if value else None

    def _extract_search_price_text(self, card: BeautifulSoup) -> str | None:
        selectors = [
            ".prc",
            ".price",
            ".num",
            "[class*='price']",
        ]
        for selector in selectors:
            for node in card.select(selector):
                text = normalize_text(node.get_text(" ", strip=True))
                if not text:
                    continue
                amount, currency = parse_price_text(text)
                if amount is not None and (currency == "JPY" or currency is None):
                    return text
        return None

    def _extract_search_review_count(self, text: str) -> int | None:
        match = re.search(r"\((\d{1,6})\)\s*(?:Power seller|Good seller|General seller)", text, re.IGNORECASE)
        if match:
            return int(match.group(1))
        match = re.search(r"\((\d{1,6})\)", text)
        if match:
            return int(match.group(1))
        return None

    def _extract_search_seller_info(self, text: str) -> tuple[str | None, str | None]:
        match = re.search(
            r"(Power seller|Good seller|General seller)\s+(.+?)(?=\s+[0-9][0-9,]*円|\s+Q-point:|\s+メガ割時|$)",
            text,
            re.IGNORECASE,
        )
        if not match:
            return None, None
        badge = normalize_text(match.group(1))
        seller = normalize_text(match.group(2))
        seller = re.sub(r"\s+", " ", seller).strip(" -")
        return seller or None, badge or None

    def _extract_best_price_from_text(self, text: str) -> int | None:
        candidates: list[tuple[int, int]] = []
        for match in re.finditer(r"([0-9][0-9,]*)\s*円", text):
            amount = int(match.group(1).replace(",", ""))
            start = max(0, match.start() - 24)
            context = text[start : match.end() + 12]
            priority = 3
            if "メガ割時" in context or "割引価格" in context or "最大割引価格" in context:
                priority = 0
            elif "販売価格" in context or "商品価格" in context:
                priority = 1
            elif "通常価格" in context:
                priority = 4
            candidates.append((priority, amount))
        if not candidates:
            return None
        candidates.sort(key=lambda item: (item[0], item[1]))
        return candidates[0][1]
