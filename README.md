# eSIMPriceCollector_Japan

Amazon Japan에서 `eSIM 韓国` 검색 결과를 수집하는 프로덕션 지향 크롤러입니다.  
어댑터 기반 구조로 라쿠텐 등 다른 마켓플레이스를 확장할 수 있습니다.

## Features
- Playwright 기반 Amazon JP 검색/상세 수집
- 상위 N개 상품 수집 (`--limit`, 기본 50)
- 필드 근거(`evidence`) 저장
- 실패 URL/에러/스크린샷 기록 (`failed.jsonl`)
- 출력: `results.jsonl`, `results.csv`
- 대시보드: 최신 `out_*/results.jsonl` 자동 로드 + 동적 필터/KPI

## Install
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -r requirements-dev.txt
playwright install chromium
```

## Run
```powershell
python -m app crawl --site amazon_jp --query "eSIM 韓国" --limit 50 --out .\out
```

### Smoke (E2E-lite)
```powershell
python -m app crawl --site amazon_jp --query "eSIM 韓国" --limit 5 --concurrency 2 --min-delay 1 --max-delay 2 --out .\out_smoke
```

## Dashboard
최신 결과(`out_*/results.jsonl`)를 자동 탐색해 웹 대시보드로 보여줍니다.

```powershell
npm run dashboard
```

브라우저에서 `http://localhost:4173` 접속.

대시보드 필터:
- 검색어(상품명/셀러/브랜드)
- 네트워크(local/roaming)
- 데이터 용량(`unlimited`, `NGB`)
- 사용기간 / 활성화기간
- 통신사 지원(SKT/KT/LGU+)
- 가격 범위

주의: URL(`product_url`)은 인사이트가 낮아 UI에서 노출하지 않습니다.

## Output Schema
주요 필드:
- `title`, `price_jpy`, `validity`(하위호환), `usage_validity`, `activation_validity`, `network_type`
- `carrier_support_kr` (`skt`, `kt`, `lgu`: true/false/null)
- `data_amount` (`unlimited` 또는 `NGB`), `product_url`, `asin`, `seller`, `brand`, `evidence`

예시 JSONL:
```json
{"title":"韓国 eSIM 7日 3GB","price_jpy":1980,"usage_validity":"7일","activation_validity":"30일","network_type":"roaming","carrier_support_kr":{"skt":true,"kt":null,"lgu":null},"data_amount":"3GB","product_url":"https://www.amazon.co.jp/dp/B0ABCDEF12","asin":"B0ABCDEF12","seller":"Example Store","brand":"Example"}
{"title":"韓国 eSIM 30日 unlimited","price_jpy":3980,"usage_validity":"30일","activation_validity":"120일","network_type":"local","carrier_support_kr":{"skt":null,"kt":true,"lgu":true},"data_amount":"unlimited","product_url":"https://www.amazon.co.jp/dp/B0ABCDEF34","asin":"B0ABCDEF34","seller":"Another Store","brand":"Another"}
```

## Tests
```powershell
python -m pytest -q
```

## Adapter Extension Guide (Rakuten 등)
1. `app/adapters/<site>.py` 생성 후 `MarketplaceAdapter` 구현.
2. `search()`에서 URL/상품 식별자 스텁 반환.
3. `fetch_detail()`에서 공통 모델(`ProductDetail`)로 매핑.
4. 사이트별 셀렉터는 다중 후보 + 텍스트 패턴 fallback 유지.
5. `app/cli.py`에서 `--site` 분기 추가.

## Notes
- 캡차 우회/계정 도용/공격적 차단 회피는 구현하지 않습니다.
- Amazon DOM은 자주 변경되므로 셀렉터 단일 의존을 피하고 휴리스틱을 사용합니다.
