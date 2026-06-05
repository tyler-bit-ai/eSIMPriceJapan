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


def test_dashboard_server_normalizes_legacy_site_only_index_to_country_map():
    script = """
const { normalizeIndexShape } = require('./dashboard_server');
const input = {
  latest: {
    amazon_jp: {
      site: 'amazon_jp',
      csv: 'sites/amazon_jp/latest.csv',
      jsonl: 'sites/amazon_jp/latest.jsonl',
      metadata: 'sites/amazon_jp/metadata.json'
    }
  },
  runs: [
    { id: 'run1', site: 'amazon_jp', csv: 'runs/run1.csv', jsonl: 'runs/run1.jsonl' }
  ]
};
console.log(JSON.stringify(normalizeIndexShape(input)));
"""
    normalized = json.loads(run_node(script))

    assert "amazon_jp" in normalized["latest"]
    assert "kr" in normalized["latest"]["amazon_jp"]
    assert normalized["latest"]["amazon_jp"]["kr"]["country"] == "kr"
    assert normalized["runs"][0]["country"] == "kr"


def test_dashboard_server_keeps_site_country_nested_index():
    script = """
const { normalizeIndexShape } = require('./dashboard_server');
const input = {
  latest: {
    amazon_jp: {
      kr: { site: 'amazon_jp', country: 'kr', csv: 'sites/amazon_jp/kr/latest.csv', jsonl: 'sites/amazon_jp/kr/latest.jsonl' },
      vn: { site: 'amazon_jp', country: 'vn', csv: 'sites/amazon_jp/vn/latest.csv', jsonl: 'sites/amazon_jp/vn/latest.jsonl' }
    }
  },
  runs: [
    { id: 'run-kr', site: 'amazon_jp', country: 'kr', csv: 'runs/run-kr.csv', jsonl: 'runs/run-kr.jsonl' },
    { id: 'run-vn', site: 'amazon_jp', country: 'vn', csv: 'runs/run-vn.csv', jsonl: 'runs/run-vn.jsonl' }
  ]
};
console.log(JSON.stringify(normalizeIndexShape(input)));
"""
    normalized = json.loads(run_node(script))

    assert set(normalized["latest"]["amazon_jp"]) == {"kr", "vn"}
    assert normalized["latest"]["amazon_jp"]["vn"]["jsonl"] == "sites/amazon_jp/vn/latest.jsonl"
    assert normalized["runs"][1]["country"] == "vn"


def test_dashboard_server_normalize_item_infers_legacy_vietnam_carrier():
    script = """
const { normalizeItem } = require('./dashboard_server');
const raw = {
  site: 'qoo10_jp',
  country: 'vn',
  title: 'ベトナム eSIM Viettel MobiFone 30日',
  price_jpy: 1500,
  product_url: 'https://example.com/item',
  evidence: {
    title: ['ベトナム eSIM Viettel MobiFone 30日']
  }
};
console.log(JSON.stringify(normalizeItem(raw)));
"""
    normalized = json.loads(run_node(script))

    assert normalized["carrier_support_local"]["viettel"] is True
    assert normalized["carrier_support_local"]["mobifone"] is True
    assert normalized["carrier_support_kr"] == {}


def test_dashboard_server_normalize_item_uses_kr_legacy_fallback():
    script = """
const { normalizeItem } = require('./dashboard_server');
const raw = {
  site: 'amazon_jp',
  country: 'kr',
  title: '韓国 eSIM',
  price_jpy: 1500,
  product_url: 'https://example.com/item',
  carrier_support_kr: { skt: true, kt: false, lgu: true }
};
console.log(JSON.stringify(normalizeItem(raw)));
"""
    normalized = json.loads(run_node(script))

    assert normalized["carrier_support_local"]["skt"] is True
    assert normalized["carrier_support_local"]["lgu"] is True
    assert normalized["carrier_support_kr"]["skt"] is True


def test_dashboard_server_network_generation_defaults_unknown_and_summarizes():
    script = """
const { normalizeItem, summarize } = require('./dashboard_server');
const legacy = normalizeItem({
  site: 'amazon_jp',
  country: 'kr',
  title: 'legacy item',
  price_jpy: 1000,
  product_url: 'https://example.com/legacy'
});
const fiveG = normalizeItem({
  site: 'amazon_jp',
  country: 'kr',
  title: '5g item',
  price_jpy: 1200,
  product_url: 'https://example.com/5g',
  network_generation: '5g_capable'
});
const lte = normalizeItem({
  site: 'amazon_jp',
  country: 'kr',
  title: 'lte item',
  price_jpy: 900,
  product_url: 'https://example.com/lte',
  network_generation: 'lte_4g_only'
});
console.log(JSON.stringify({ legacy, summary: summarize([legacy, fiveG, lte]) }));
"""
    result = json.loads(run_node(script))

    assert result["legacy"]["network_generation"] == "unknown"
    assert result["summary"]["networkGenerationCounts"]["5g_capable"] == 1
    assert result["summary"]["networkGenerationCounts"]["lte_4g_only"] == 1
    assert result["summary"]["networkGenerationCounts"]["unknown"] == 1
    assert result["summary"]["networkGenerationKnownOnlyShares"]["5g_capable"] == 50


def test_dashboard_server_filters_by_network_generation():
    script = """
const { applyFilters } = require('./dashboard_server');
const items = [
  { title: '5g', price_jpy: 1000, network_generation: '5g_capable', carrier_support_local: {} },
  { title: 'lte', price_jpy: 900, network_generation: 'lte_4g_only', carrier_support_local: {} },
  { title: 'unknown', price_jpy: 800, network_generation: 'unknown', carrier_support_local: {} }
];
console.log(JSON.stringify(applyFilters(items, { generation: '5g_capable' })));
"""
    filtered = json.loads(run_node(script))

    assert len(filtered) == 1
    assert filtered[0]["title"] == "5g"


def test_dashboard_server_reads_thailand_and_existing_country_datasets():
    script = """
const { readLatestData } = require('./dashboard_server');
const qoo10Th = readLatestData('qoo10_jp', 'th');
const amazonTh = readLatestData('amazon_jp', 'th');
const qoo10Kr = readLatestData('qoo10_jp', 'kr');
console.log(JSON.stringify({
  qoo10Th: {
    found: qoo10Th.found,
    country: qoo10Th.record && qoo10Th.record.country,
    source: qoo10Th.record && qoo10Th.record.source,
    total: qoo10Th.items.length,
  },
  amazonTh: {
    found: amazonTh.found,
    country: amazonTh.record && amazonTh.record.country,
    source: amazonTh.record && amazonTh.record.source,
    total: amazonTh.items.length,
  },
  qoo10Kr: {
    found: qoo10Kr.found,
    country: qoo10Kr.record && qoo10Kr.record.country,
    source: qoo10Kr.record && qoo10Kr.record.source,
    total: qoo10Kr.items.length,
  }
}));
"""
    loaded = json.loads(run_node(script))

    assert loaded["qoo10Th"]["found"] is True
    assert loaded["qoo10Th"]["country"] == "th"
    assert "qoo10_jp_th" in loaded["qoo10Th"]["source"]
    assert loaded["qoo10Th"]["total"] > 0

    assert loaded["amazonTh"]["found"] is True
    assert loaded["amazonTh"]["country"] == "th"
    assert "amazon_jp_th" in loaded["amazonTh"]["source"]
    assert loaded["amazonTh"]["total"] > 0

    assert loaded["qoo10Kr"]["found"] is True
    assert loaded["qoo10Kr"]["country"] == "kr"
    assert "qoo10_jp_kr" in loaded["qoo10Kr"]["source"]
    assert loaded["qoo10Kr"]["total"] > 0
