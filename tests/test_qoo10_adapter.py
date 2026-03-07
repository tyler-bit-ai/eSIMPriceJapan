from bs4 import BeautifulSoup

from app.adapters.qoo10_jp import Qoo10JPAdapter


def test_extract_site_product_id():
    url = "https://www.qoo10.jp/item/ESIM/1133241666?banner_no=1170169"
    assert Qoo10JPAdapter.extract_site_product_id(url) == "1133241666"


def test_parse_search_card_extracts_price_and_id():
    html = """
    <tr>
      <td>
        <div class="inner">
          <a class="img_cut" goodscode="1133241666" href="#none"><dfn>images:</dfn>6</a>
          <div class="sbj">
            <a href="https://www.qoo10.jp/item/ESIM/1133241666?banner_no=1170169"
               title="【eSIM 韓国】3日間(72時間) データ通信無制限 SKテレコム KT 即日発行">
              【eSIM 韓国】3日間(72時間) データ通信無制限 SKテレコム KT 即日発行
            </a>
          </div>
          <div class="price">980円</div>
          <div class="review">(61)</div>
          <div class="seller">General seller KOTABIストア</div>
        </div>
      </td>
    </tr>
    """
    adapter = object.__new__(Qoo10JPAdapter)
    card = BeautifulSoup(html, "lxml").select_one("tr")
    stub = adapter._parse_search_card(card, search_position=1)

    assert stub is not None
    assert stub.site == "qoo10_jp"
    assert str(stub.product_url) == "https://www.qoo10.jp/item/ESIM/1133241666"
    assert stub.site_product_id == "1133241666"
    assert stub.search_price_jpy == 980
    assert stub.search_review_count == 61
    assert stub.search_seller_badge == "General seller"
    assert stub.search_seller == "KOTABIストア"
    assert stub.search_position == 1


def test_extract_best_price_prefers_discount_price():
    adapter = object.__new__(Qoo10JPAdapter)
    text = "販売価格 1,620円 1,980円 最大割引価格 1,296円 通常価格 1,980円"
    assert adapter._extract_best_price_from_text(text) == 1296


def test_extract_title_from_meta_description():
    html = """
    <html>
      <head>
        <meta name="description" content="「【Almond sim】韓国 eSIM 3日間 完全無制限 SKT キャリア」 スマートフォン・タブレットPCがお得な[Qoo10]">
      </head>
    </html>
    """
    adapter = object.__new__(Qoo10JPAdapter)
    soup = BeautifulSoup(html, "lxml")
    assert adapter._extract_title(soup) == "【Almond sim】韓国 eSIM 3日間 完全無制限 SKT キャリア"


def test_extract_option_candidates_filters_disclaimer_selects():
    html = """
    <html>
      <body>
        <select id="sub_sel_no">
          <option value="">選択してください。</option>
          <option value="1">返品・交換は承っておりません。</option>
        </select>
        <select id="sub_inventory_seqno">
          <option value="">選択してください。</option>
          <option value="2713867035">3日 72時間（正規）（超高速無限データ）（有効期間180日）(+160円)</option>
        </select>
      </body>
    </html>
    """
    adapter = object.__new__(Qoo10JPAdapter)
    soup = BeautifulSoup(html, "lxml")
    candidates = adapter._extract_option_candidates(soup)

    assert len(candidates) == 1
    assert candidates[0].option_value == "2713867035"
    assert candidates[0].surcharge_jpy == 160
    assert candidates[0].usage_days == 3.0
    assert candidates[0].activation_days == 180
    assert candidates[0].data_amount == "unlimited"


def test_select_representative_option_prefers_title_match():
    adapter = object.__new__(Qoo10JPAdapter)
    title_signals = adapter._extract_title_signals("【eSIM 韓国】3日間 データ通信無制限 KT 即日発行")
    options = [
        adapter._parse_option_candidate("2日 48時間（正規）（超高速無限データ）（有効期間180日）", "1"),
        adapter._parse_option_candidate("3日 72時間（正規）（超高速無限データ）（有効期間180日）(+160円)", "2"),
        adapter._parse_option_candidate("4日 96時間（正規）（超高速無限データ）（有効期間180日）(+420円)", "3"),
    ]

    selected, reason = adapter._select_representative_option(title_signals, [opt for opt in options if opt])

    assert selected is not None
    assert selected.option_value == "2"
    assert "title_match_score" in reason


def test_select_representative_option_falls_back_to_base_price_without_title_signal():
    adapter = object.__new__(Qoo10JPAdapter)
    title_signals = adapter._extract_title_signals("韓国 eSIM 安心サポート")
    options = [
        adapter._parse_option_candidate("5日 120時間（正規）（超高速無限データ）(+600円)", "5"),
        adapter._parse_option_candidate("3日 72時間（正規）（超高速無限データ）(+160円)", "3"),
        adapter._parse_option_candidate("2日 48時間（正規）（超高速無限データ）", "2"),
    ]

    selected, reason = adapter._select_representative_option(title_signals, [opt for opt in options if opt])

    assert selected is not None
    assert selected.option_value == "2"
    assert reason == "fallback_base_option"


def test_select_representative_option_returns_none_when_not_confident():
    adapter = object.__new__(Qoo10JPAdapter)
    title_signals = adapter._extract_title_signals("【韓国 eSIM】10日間 5GB LGU+")
    options = [
        adapter._parse_option_candidate("2日 48時間（正規）（超高速無限データ）", "1"),
        adapter._parse_option_candidate("3日 72時間（正規）（超高速無限データ）", "2"),
    ]

    selected, reason = adapter._select_representative_option(title_signals, [opt for opt in options if opt])

    assert selected is None
    assert reason.startswith("title_match_score=")


def test_resolve_price_uses_representative_option_surcharge():
    adapter = object.__new__(Qoo10JPAdapter)
    base_price = adapter._resolve_price(
        base_price=type("X", (), {"value": 980, "evidence": ["販売価格 980円"]})(),
        stub=type("Stub", (), {"search_price_jpy": None, "search_price_text": None})(),
        representative_option=adapter._parse_option_candidate("3日 72時間（正規）（超高速無限データ）(+160円)", "2"),
        unresolved_options=False,
    )
    assert base_price.value == 1140


def test_resolve_validity_returns_none_on_unresolved_options():
    adapter = object.__new__(Qoo10JPAdapter)
    text_validity = type(
        "Validity",
        (),
        {"usage_validity": "3일", "activation_validity": "180일", "usage_evidence": [], "activation_evidence": []},
    )()
    usage, activation = adapter._resolve_validity(
        text_validity=text_validity,
        representative_option=None,
        unresolved_options=True,
    )
    assert usage is None
    assert activation is None


def test_extract_search_seller_info_splits_badge_and_name():
    adapter = object.__new__(Qoo10JPAdapter)
    seller, badge = adapter._extract_search_seller_info("General seller KOTABIストア 980円 Q-point: 10P")
    assert seller == "KOTABIストア"
    assert badge == "General seller"


def test_extract_detail_review_count_fallback():
    adapter = object.__new__(Qoo10JPAdapter)
    assert adapter._extract_detail_review_count(["商品情報", "レビュー 843", "その他"]) == 843
