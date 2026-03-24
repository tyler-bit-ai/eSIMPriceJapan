import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_node(script: str) -> str:
    completed = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return completed.stdout.strip()


def test_exchange_rate_utils_convert_and_summarize():
    script = """
const fx = require('./dashboard/exchange-rate');
const meta = fx.buildExchangeRateMeta({ rate: 9.1, updatedAt: '2026-03-24', fetchedAt: '2026-03-24T00:00:00.000Z' });
const items = fx.attachKrwPrices([
  { title: 'a', price_jpy: 1000 },
  { title: 'b', price_jpy: 1500 },
  { title: 'c', price_jpy: null }
], meta);
const summary = fx.summarizeNumbers(items.map((item) => item.price_krw));
console.log(JSON.stringify({ items, summary }));
"""
    payload = json.loads(run_node(script))

    assert payload["items"][0]["price_krw"] == 9100
    assert payload["items"][1]["price_krw"] == 13650
    assert payload["items"][2]["price_krw"] is None
    assert payload["summary"] == {
        "min": 9100,
        "max": 13650,
        "avg": 11375,
        "median": 11375,
    }


def test_exchange_rate_utils_uses_cached_rate_on_fetch_failure():
    script = """
const fx = require('./dashboard/exchange-rate');
const storage = {
  value: JSON.stringify({
    pair: 'JPY/KRW',
    rate: 9.25,
    source: 'Frankfurter (ECB reference)',
    updatedAt: '2026-03-20',
    fetchedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
    stale: false,
    unavailable: false,
    error: null,
    url: 'https://api.frankfurter.dev/v1/latest?base=JPY&symbols=KRW'
  }),
  getItem() { return this.value; },
  setItem(_key, next) { this.value = next; }
};
(async () => {
  const meta = await fx.fetchExchangeRate(async () => { throw new Error('boom'); }, { storage });
  console.log(JSON.stringify(meta));
})();
"""
    payload = json.loads(run_node(script))

    assert payload["rate"] == 9.25
    assert payload["stale"] is True
    assert payload["unavailable"] is False
    assert payload["error"] == "boom"


def test_dashboard_server_adds_exchange_rate_and_price_krw():
    script = """
global.fetch = async () => ({
  ok: true,
  json: async () => ({ amount: 1, base: 'JPY', date: '2026-03-24', rates: { KRW: 9.1 } })
});
const server = require('./dashboard_server');
(async () => {
  const data = await server.readLatestDataWithExchangeRate('amazon_jp', 'kr', null);
  console.log(JSON.stringify({
    found: data.found,
    exchangeRate: data.exchangeRate,
    firstItem: data.items[0],
    summary: {
      priceKrwMin: data.summary.priceKrwMin,
      priceKrwMedian: data.summary.priceKrwMedian,
      priceKrwAvg: data.summary.priceKrwAvg
    }
  }));
})();
"""
    payload = json.loads(run_node(script))

    assert payload["found"] is True
    assert payload["exchangeRate"]["rate"] == 9.1
    assert payload["firstItem"]["price_jpy"] > 0
    assert payload["firstItem"]["price_krw"] == round(payload["firstItem"]["price_jpy"] * 9.1)
    assert payload["summary"]["priceKrwMin"] is not None
