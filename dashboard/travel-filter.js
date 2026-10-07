(function attachTravelFilter(root, factory) {
  const utils = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = utils;
  if (root) root.TravelFilter = utils;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildTravelFilter() {
  // Keep in sync with app/pipeline/validation.py (tests/test_travel_filter.py checks parity).
  // "日本国内" is deliberately NOT listed: legit travel eSIMs use it ("日本国内500MB付き").
  const DOMESTIC_PLAN = /UQ\s*mobile|ウェルカムパッケージ|エントリーパッケージ|事務手数料|ahamo|povo|LINEMO|楽天モバイル|mineo|IIJmio|ワイモバイル|Y!mobile/i;
  const SIM_WORD = /sim|シム|ローミング|roaming|データ通信|data/i;
  // Title must name the crawled country (search results mix in other destinations).
  const DESTINATION = {
    kr: /韓国|韓國|한국|korea|ソウル|釜山|済州/i,
    vn: /ベトナム|vietnam|越南|ハノイ|ホーチミン|ダナン/i,
    th: /タイ(?![プムヤルトマツミワ])|thailand|バンコク|プーケット/i,
    tw: /台湾|台灣|taiwan|タイワン|台北/i,
    hk: /香港|ホンコン|hong\s*kong/i,
    mo: /マカオ|澳門|澳门|maca[ou]/i,
    us: /アメリカ|米国|(?<![a-z])usa(?![a-z])|united\s*states|ハワイ|hawaii|グアム|guam|北米/i,
  };

  function nonTravelReason(title, country) {
    if (!title) return null;
    const m = DOMESTIC_PLAN.exec(title);
    if (m) return `domestic_carrier_plan:${m[0]}`;
    if (!SIM_WORD.test(title)) return 'no_sim_keyword_in_title';
    const dest = DESTINATION[country];
    if (dest && !dest.test(title)) return `off_destination:${country}`;
    return null;
  }

  return { nonTravelReason, isTravelProduct: (title, country) => nonTravelReason(title, country) === null };
}));
