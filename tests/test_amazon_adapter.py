from bs4 import BeautifulSoup

from app.adapters.amazon_jp import AmazonJPAdapter
from app.extractors.heuristics import extract_review_count


def test_amazon_search_card_extracts_review_count():
    html = """
    <div data-component-type="s-search-result" data-asin="B000000001">
      <h2><a href="/dp/B000000001">sample</a></h2>
      <span class="a-price"><span class="a-offscreen">￥1,980</span></span>
      <span aria-label="1,234個の評価"></span>
    </div>
    """
    adapter = object.__new__(AmazonJPAdapter)
    card = BeautifulSoup(html, "lxml").select_one("div[data-component-type='s-search-result']")

    text = adapter._extract_text_selectors(
        card,
        [
            "span[aria-label*='個の評価']",
            "span[aria-label*='ratings']",
            "span.a-size-base.s-underline-text",
            "a.a-link-normal span.a-size-base",
        ],
    )
    extracted = extract_review_count([text or "", card.get_text(" ", strip=True)])

    assert extracted.value == 1234


def test_amazon_collect_review_count_candidates():
    html = """
    <html>
      <body>
        <span id="acrCustomerReviewText">843個の評価</span>
      </body>
    </html>
    """
    adapter = object.__new__(AmazonJPAdapter)
    soup = BeautifulSoup(html, "lxml")

    candidates = adapter._collect_review_count_candidates(soup, ["fallback"])

    assert candidates[0] == "843個の評価"


def test_amazon_extract_review_count_value_from_parentheses():
    adapter = object.__new__(AmazonJPAdapter)
    extracted = adapter._extract_review_count_value(["(279)"])
    assert extracted.value == 279


def test_amazon_extract_review_count_value_from_json_ld():
    adapter = object.__new__(AmazonJPAdapter)
    extracted = adapter._extract_review_count_value(['{"reviewCount":"512","ratingValue":"4.5"}'])
    assert extracted.value == 512
