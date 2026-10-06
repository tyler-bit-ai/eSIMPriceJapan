(function attachTravelFilter(root, factory) {
  const utils = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = utils;
  if (root) root.TravelFilter = utils;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildTravelFilter() {
  // Keep in sync with app/pipeline/validation.py (tests/test_travel_filter.py checks parity).
  // "日本国内" is deliberately NOT listed: legit travel eSIMs use it ("日本国内500MB付き").
  const DOMESTIC_PLAN = /UQ\s*mobile|ウェルカムパッケージ|エントリーパッケージ|事務手数料|ahamo|povo|LINEMO|楽天モバイル|mineo|IIJmio|ワイモバイル|Y!mobile/i;
  const SIM_WORD = /sim|シム|ローミング|roaming|データ通信|data/i;

  function nonTravelReason(title) {
    if (!title) return null;
    const m = DOMESTIC_PLAN.exec(title);
    if (m) return `domestic_carrier_plan:${m[0]}`;
    if (!SIM_WORD.test(title)) return 'no_sim_keyword_in_title';
    return null;
  }

  return { nonTravelReason, isTravelProduct: (title) => nonTravelReason(title) === null };
}));
