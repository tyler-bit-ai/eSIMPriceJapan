import json
import subprocess
from pathlib import Path

from app.pipeline.validation import non_travel_reason

ROOT = Path(__file__).resolve().parents[1]

TITLES = [
    "【コード入力で事務手数料不要】 UQ mobile ウェルカムパッケージ/[SIMカード/eSIM共通]/au回線",
    "ahamo 契約 eSIM 乗り換え",
    "リジュオール PDRNクリーム 60g 韓国スキンケア",
    "エアタグ Android gps 子供 スマートタグ 紛失防止",
    "【韓国eSIM】3日間 無制限 日本国内500MB付き データ通信専用",
    "タイ用データSIMカード 30日間 日本国内即日発送（Amazon倉庫）",
    "韓国 ローミング 5日間 10GB",
    "",
]
# (title, country) pairs for the destination check
DEST = [
    ["【Almond sim】ヨーロッパ simcard EU 30日間10GB", "hk"],
    ["【中国・香港・マカオeSIM】5日間", "hk"],
    ["香港タイワンSIMカード 4日間", "th"],
    ["タイ eSIM 5日間", "th"],
    ["米国USA eSIM 7日間", "us"],
    ["【Simmy公式】カナダ eSIM 7日間", "us"],
]


def test_js_and_python_travel_filters_agree():
    script = (
        "const f = require('./dashboard/travel-filter');"
        f"const t = {json.dumps(TITLES, ensure_ascii=False)};"
        "console.log(JSON.stringify(t.map((x) => f.nonTravelReason(x))));"
    )
    out = subprocess.run(
        ["node", "-e", script], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8"
    ).stdout
    assert json.loads(out) == [non_travel_reason(t) for t in TITLES]


def test_js_and_python_destination_checks_agree():
    script = (
        "const f = require('./dashboard/travel-filter');"
        f"const t = {json.dumps(DEST, ensure_ascii=False)};"
        "console.log(JSON.stringify(t.map(([x, c]) => f.nonTravelReason(x, c))));"
    )
    out = subprocess.run(
        ["node", "-e", script], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8"
    ).stdout
    expected = [non_travel_reason(t, c) for t, c in DEST]
    assert json.loads(out) == expected
    assert expected == ["off_destination:hk", None, "off_destination:th", None, None, "off_destination:us"]


def test_dashboard_server_drops_non_travel_items():
    script = (
        "const s = require('./dashboard_server');"
        "const rows = [{title:'UQ mobile ウェルカムパッケージ eSIM',price_jpy:350},"
        "{title:'韓国eSIM 3日間',price_jpy:1200}].map(s.normalizeItem).filter(s.keepDashboardItem);"
        "console.log(JSON.stringify(rows.map((r) => r.title)));"
    )
    out = subprocess.run(
        ["node", "-e", script], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8"
    ).stdout
    assert json.loads(out) == ["韓国eSIM 3日間"]
