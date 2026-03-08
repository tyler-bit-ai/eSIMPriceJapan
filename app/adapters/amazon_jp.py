from __future__ import annotations

import logging
import re
from pathlib import Path
from urllib.parse import quote_plus

from bs4 import BeautifulSoup
from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from app.adapters.base import MarketplaceAdapter
from app.extractors.heuristics import (
    extract_asin,
    extract_bestseller_badge,
    extract_bestseller_rank,
    extract_carrier_support_kr,
    extract_data_amount,
    extract_monthly_sold_count,
    extract_network_type,
    extract_price_jpy_with_evidence,
    extract_review_count,
    extract_validity_split,
    parse_price_text,
)
from app.models import ProductDetail, ProductStub

logger = logging.getLogger(__name__)


class AmazonJPAdapter(MarketplaceAdapter):
    name = "amazon_jp"

    def __init__(self, browser: Browser, context: BrowserContext, screenshot_dir: Path):
        self.browser = browser
        self.context = context
        self.screenshot_dir = screenshot_dir
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    async def create(cls, screenshot_dir: Path) -> "AmazonJPAdapter":
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
        await context.add_cookies(
            [
                {
                    "name": "i18n-prefs",
                    "value": "JPY",
                    "domain": ".amazon.co.jp",
                    "path": "/",
                }
            ]
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
            unique: list[ProductStub] = []
            seen: set[str] = set()
            seen_asins: set[str] = set()

            max_pages = max(2, min(10, (limit // 20) + 3))
            for page_no in range(1, max_pages + 1):
                search_url = f"https://www.amazon.co.jp/s?k={encoded}&page={page_no}"
                await page.goto(search_url, wait_until="domcontentloaded")
                await page.wait_for_timeout(1200)

                html = await page.content()
                soup = BeautifulSoup(html, "lxml")

                for card in soup.select("div[data-component-type='s-search-result']"):
                    link = card.select_one("h2 a[href], a.a-link-normal.s-no-outline[href]")
                    if not link:
                        continue
                    href = link.get("href")
                    if not href:
                        continue
                    full = self._normalize_product_url(href)
                    if not full or full in seen:
                        continue
                    asin = card.get("data-asin") or extract_asin(full)
                    if asin and asin in seen_asins:
                        continue

                    price_text = self._extract_text_selectors(card, ["span.a-price span.a-offscreen", ".a-price .a-offscreen"])
                    search_price_jpy = None
                    if price_text:
                        amount, currency = parse_price_text(price_text)
                        if amount is not None and (currency == "JPY" or currency is None):
                            search_price_jpy = amount
                    card_text = card.get_text(" ", strip=True)
                    review_count = self._extract_review_count_value(
                        [
                            self._extract_text_selectors(
                                card,
                                [
                                    "span[aria-label*='個の評価']",
                                    "span[aria-label*='ratings']",
                                    "span.a-size-base.s-underline-text",
                                    "a.a-link-normal span.a-size-base",
                                    "a[href*='customerReviews'] span",
                                ],
                            )
                            or "",
                            card_text,
                        ]
                    )
                    monthly_sold = extract_monthly_sold_count([card_text])
                    bestseller_badge = extract_bestseller_badge([card_text])

                    seen.add(full)
                    if asin:
                        seen_asins.add(asin)
                    unique.append(
                        ProductStub(
                            site=self.name,
                            product_url=full,
                            asin=asin,
                            site_product_id=asin,
                            search_price_jpy=search_price_jpy,
                            search_price_text=price_text,
                            search_review_count=review_count.value if isinstance(review_count.value, int) else None,
                            search_monthly_sold_count=monthly_sold.value if isinstance(monthly_sold.value, int) else None,
                            search_is_bestseller=bestseller_badge.value if isinstance(bestseller_badge.value, bool) else None,
                        )
                    )
                    if len(unique) >= limit:
                        break

                if len(unique) >= limit:
                    break

                selectors = [
                    "div.s-main-slot a.a-link-normal.s-no-outline",
                    "h2 a.a-link-normal",
                    "a.a-link-normal[href*='/dp/']",
                ]
                for selector in selectors:
                    for link in soup.select(selector):
                        href = link.get("href")
                        if not href:
                            continue
                        full = self._normalize_product_url(href)
                        if not full or full in seen:
                            continue
                        asin = extract_asin(full)
                        if asin and asin in seen_asins:
                            continue
                        seen.add(full)
                        if asin:
                            seen_asins.add(asin)
                        unique.append(ProductStub(site=self.name, product_url=full, asin=asin, site_product_id=asin))
                        if len(unique) >= limit:
                            break
                    if len(unique) >= limit:
                        break

            logger.info("found %s candidate products", len(unique))
            return unique
        finally:
            await page.close()

    def _normalize_product_url(self, href: str) -> str | None:
        if "/dp/" not in href and "/gp/product/" not in href:
            return None
        if href.startswith("/"):
            href = f"https://www.amazon.co.jp{href}"
        elif href.startswith("https://") and "amazon.co.jp" not in href:
            return None
        href = href.split("?")[0]
        m = re.search(r"https://www\.amazon\.co\.jp/(?:[^/]+/)?(?:dp|gp/product)/[A-Z0-9]{10}", href)
        if m:
            return m.group(0)
        return href

    async def fetch_detail(self, stub: ProductStub) -> ProductDetail:
        page = await self._new_page()
        evidence: dict[str, list[str]] = {}
        try:
            await page.goto(str(stub.product_url), wait_until="domcontentloaded")
            await page.wait_for_timeout(900)

            html = await page.content()
            soup = BeautifulSoup(html, "lxml")

            title = self._extract_text_selectors(
                soup,
                ["#productTitle", "#title", "h1.a-size-large"],
            )

            text_blocks = self._collect_text_blocks(soup)

            price_text_candidates = self._collect_price_text_candidates(soup)
            price, non_jpy_evidence = extract_price_jpy_with_evidence(
                price_text_candidates,
                assume_jpy_on_unknown_currency=True,
            )
            if price.evidence:
                evidence["price_jpy"] = price.evidence
            elif stub.search_price_jpy is not None and stub.search_price_jpy > 0:
                price.value = stub.search_price_jpy
                evidence["price_jpy"] = [
                    f"search_result_fallback: {stub.search_price_text or stub.search_price_jpy}"
                ]
            else:
                evidence["price_jpy"] = ["no_jpy_price_found_in_primary_selectors"]

            if non_jpy_evidence:
                evidence["non_jpy_price"] = non_jpy_evidence

            validity_texts = [title] + text_blocks if title else text_blocks
            validity_split = extract_validity_split(validity_texts)
            if validity_split.usage_evidence:
                evidence["usage_validity"] = validity_split.usage_evidence
            if validity_split.activation_evidence:
                evidence["activation_validity"] = validity_split.activation_evidence

            data_amount = extract_data_amount(text_blocks)
            if data_amount.evidence:
                evidence["data_amount"] = data_amount.evidence

            network_texts = [title] + text_blocks if title else text_blocks
            network_type, network_ev = extract_network_type(network_texts)
            if network_ev:
                evidence["network_type"] = network_ev
            else:
                evidence["network_type"] = ["no_local_or_roaming_keyword_matched"]

            carrier_support, carrier_ev = extract_carrier_support_kr(text_blocks)
            if carrier_ev:
                evidence["carrier_support_kr"] = carrier_ev

            monthly_sold = extract_monthly_sold_count(text_blocks)
            if monthly_sold.evidence:
                evidence["monthly_sold_count"] = monthly_sold.evidence
            elif isinstance(stub.search_monthly_sold_count, int):
                monthly_sold.value = stub.search_monthly_sold_count
                evidence["monthly_sold_count"] = [f"search_result_fallback: {stub.search_monthly_sold_count}"]

            review_texts = self._collect_review_count_candidates(soup, text_blocks)
            review_count = self._extract_review_count_value(review_texts)
            if review_count.evidence:
                evidence["review_count"] = [f"detail_page: {review_count.evidence[0]}"]
            elif isinstance(stub.search_review_count, int):
                review_count.value = stub.search_review_count
                evidence["review_count"] = [f"search_result_fallback: {stub.search_review_count}"]

            bestseller_badge = extract_bestseller_badge(text_blocks)
            if bestseller_badge.evidence:
                evidence["is_bestseller"] = bestseller_badge.evidence
            elif isinstance(stub.search_is_bestseller, bool):
                bestseller_badge.value = stub.search_is_bestseller
                evidence["is_bestseller"] = [f"search_result_fallback: {stub.search_is_bestseller}"]

            bestseller_rank = extract_bestseller_rank(text_blocks)
            if bestseller_rank.evidence:
                evidence["bestseller_rank"] = bestseller_rank.evidence

            seller = self._extract_text_selectors(
                soup,
                ["#sellerProfileTriggerId", "#merchantInfo", "a#bylineInfo"],
            )
            brand = self._extract_text_selectors(
                soup,
                ["#bylineInfo", "tr:has(th:-soup-contains('ブランド')) td", "#productOverview_feature_div td"],
            )

            if title:
                evidence.setdefault("title", []).append(title)

            asin = stub.asin or extract_asin(str(stub.product_url))
            if not asin:
                asin = self._extract_asin_from_dom(soup)

            return ProductDetail(
                site=self.name,
                title=title,
                price_jpy=price.value if isinstance(price.value, int) else None,
                review_count=review_count.value if isinstance(review_count.value, int) else None,
                monthly_sold_count=monthly_sold.value if isinstance(monthly_sold.value, int) else None,
                is_bestseller=bestseller_badge.value if isinstance(bestseller_badge.value, bool) else None,
                bestseller_rank=bestseller_rank.value if isinstance(bestseller_rank.value, int) else None,
                usage_validity=validity_split.usage_validity,
                activation_validity=validity_split.activation_validity,
                validity=validity_split.usage_validity or validity_split.activation_validity,
                network_type=network_type,
                carrier_support_kr=carrier_support,
                data_amount=data_amount.value if isinstance(data_amount.value, str) else None,
                product_url=stub.product_url,
                asin=asin,
                site_product_id=asin,
                seller=seller,
                brand=brand,
                evidence=evidence,
            )
        except Exception as exc:
            shot = self.screenshot_dir / f"detail_error_{stub.asin or 'unknown'}.png"
            await page.screenshot(path=str(shot), full_page=True)
            raise RuntimeError(f"detail parsing failed: {exc}; screenshot={shot}") from exc
        finally:
            await page.close()

    def _collect_text_blocks(self, soup: BeautifulSoup) -> list[str]:
        blocks: list[str] = []
        selectors = [
            "#feature-bullets li",
            "#productDescription",
            "#aplus_feature_div",
            "#productDetails_feature_div tr",
            "#detailBullets_feature_div li",
            "meta[name='description']",
            "img[alt]",
        ]
        for selector in selectors:
            for node in soup.select(selector):
                text = node.get("content") if node.name == "meta" else node.get_text(" ", strip=True)
                if node.name == "img":
                    text = node.get("alt") or ""
                if text:
                    blocks.append(text)

        all_text = soup.get_text(" ", strip=True)
        if all_text:
            blocks.append(all_text[:5000])
        return blocks

    def _collect_price_text_candidates(self, soup: BeautifulSoup) -> list[str]:
        candidates: list[str] = []
        selectors = [
            "#corePrice_feature_div .a-offscreen",
            "#corePriceDisplay_desktop_feature_div .a-offscreen",
            "#apex_desktop .a-price .a-offscreen",
            "#tp_price_block_total_price_ww .a-offscreen",
            "#buybox .a-price .a-offscreen",
            "#priceblock_ourprice",
            "#priceblock_dealprice",
            "#price_inside_buybox",
            "#newBuyBoxPrice",
        ]
        for selector in selectors:
            for node in soup.select(selector):
                text = node.get_text(" ", strip=True)
                if text:
                    candidates.append(text)
        context_patterns = [
            r"(?:価格|税込価格|￥|¥|JPY)[^。\n\r]{0,40}[0-9][0-9,]*\s*円?",
            r"[￥¥]\s*[0-9][0-9,]*",
        ]
        all_text = soup.get_text(" ", strip=True)
        for pattern in context_patterns:
            for match in re.finditer(pattern, all_text, re.IGNORECASE):
                snippet = match.group(0).strip()
                if snippet:
                    candidates.append(snippet)

        if not candidates:
            for node in soup.select(".a-price .a-offscreen"):
                text = node.get_text(" ", strip=True)
                if text:
                    candidates.append(text)

        return candidates[:12]

    def _collect_review_count_candidates(self, soup: BeautifulSoup, text_blocks: list[str]) -> list[str]:
        candidates: list[str] = []
        selectors = [
            "#acrCustomerReviewText",
            "span[data-hook='total-review-count']",
            "a[data-hook='see-all-reviews-link-foot'] span",
            "a[href*='customerReviews'] span",
            "#averageCustomerReviews_feature_div",
            "[data-hook='cr-filter-info-review-rating-count']",
            "script[type='application/ld+json']",
        ]
        for selector in selectors:
            for node in soup.select(selector):
                if node.name == "script":
                    text = node.string or node.get_text(" ", strip=True)
                else:
                    text = (
                        node.get_text(" ", strip=True)
                        or node.get("aria-label")
                        or node.get("content")
                        or ""
                    )
                if text:
                    candidates.append(text)
        candidates.extend(text_blocks[:5])
        return candidates

    def _extract_review_count_value(self, texts: list[str]):
        extracted = extract_review_count(texts)
        if extracted.evidence:
            return extracted

        for raw in texts:
            text = raw.strip() if raw else ""
            if not text:
                continue
            paren_match = re.search(r"\(\s*([0-9][0-9,]*)\s*\)", text)
            if paren_match:
                return type(extracted)(int(paren_match.group(1).replace(",", "")), [text[:180]])
            bare_match = re.fullmatch(r"[#]?\s*([0-9][0-9,]*)", text)
            if bare_match:
                return type(extracted)(int(bare_match.group(1).replace(",", "")), [text[:180]])

        return extracted

    def _extract_text_selectors(self, soup: BeautifulSoup, selectors: list[str]) -> str | None:
        for selector in selectors:
            node = soup.select_one(selector)
            if node:
                text = (
                    node.get_text(" ", strip=True)
                    or node.get("aria-label")
                    or node.get("content")
                    or node.get("alt")
                    or ""
                )
                if text:
                    return text
        return None

    def _extract_asin_from_dom(self, soup: BeautifulSoup) -> str | None:
        candidates = soup.select("#detailBullets_feature_div li, #productDetails_detailBullets_sections1 tr")
        for row in candidates:
            text = row.get_text(" ", strip=True)
            match = re.search(r"([A-Z0-9]{10})", text)
            if "ASIN" in text and match:
                return match.group(1)
        return None
