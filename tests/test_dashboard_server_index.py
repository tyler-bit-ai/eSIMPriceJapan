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
