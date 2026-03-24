# eSIMPriceCollector_Japan

일본 Amazon, Qoo10에서 국가별 eSIM 검색 결과를 수집하고, 정규화된 RAW 데이터를 대시보드로 비교하는 크롤러입니다.  
현재 사이트 축은 `amazon_jp`, `qoo10_jp`이며, 국가 축은 `kr`, `vn`, `th`, `tw`, `hk`, `mo`, `us`를 지원합니다.

## Design Note
- 크롤링 실행 축: `site + country + query`
- 저장 축: `dashboard/data/sites/<site>/<country>/latest.{jsonl,csv}`
- 대시보드 축: 상단 `사이트 + 국가 + 데이터셋` 선택
- 레거시 호환: 기존 site-only `index.json`과 한국 데이터는 `kr` fallback으로 읽음

## Features
- Playwright 기반 Amazon JP / Qoo10 JP 검색·상세 수집
- 상위 N개 상품 수집 (`--limit`, 기본 50)
- 필드 근거(`evidence`) 저장
- 실패 URL/에러/스크린샷 기록 (`failed.jsonl`)
- 출력: `results.jsonl`, `results.csv`, `failed.jsonl`, `invalid.jsonl`, `invalid.csv`
- 대시보드: 국가별 latest/run 데이터 로드 + 동적 필터/KPI

## Install
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -r requirements-dev.txt
playwright install chromium
npm install
```

## Run
기본 query는 `--country`에 맞춰 자동 선택됩니다.

```powershell
python -m app crawl --site amazon_jp --country kr --limit 50 --out .\out_amazon_kr
python -m app crawl --site amazon_jp --country vn --limit 50 --out .\out_amazon_vn
python -m app crawl --site qoo10_jp --country tw --limit 50 --out .\out_qoo10_tw
```

직접 query를 덮어쓰고 싶으면 `--query`를 같이 지정합니다.

```powershell
python -m app crawl --site qoo10_jp --country hk --query "eSIM 香港 5G" --limit 30 --out .\out_qoo10_hk_custom
```

### One-click (crawl + publish + git push)
```powershell
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site amazon_jp -Country kr -Limit 200 -OutDir .\out_auto_kr
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site amazon_jp -Country vn -Limit 100 -OutDir .\out_auto_vn
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site qoo10_jp -Country us -Limit 50 -OutDir .\out_auto_us
```

### Publish Only
이미 생성된 `results.jsonl`, `results.csv`를 대시보드 데이터로 반영할 때 사용합니다.

```powershell
.\tools\publish.ps1 -OutDir .\out_amazon_vn -DataDir dashboard\data -Site amazon_jp -Country vn -Query "eSIM ベトナム" -Limit 50
```

게시 후 생성 구조 예시:
```text
dashboard/data/
  index.json
  runs/
    20260320T090000Z_amazon_jp_vn_out_amazon_vn.jsonl
  sites/
    amazon_jp/
      vn/
        latest.jsonl
        latest.csv
        metadata.json
```

### Smoke (E2E-lite)
```powershell
python -m app crawl --site amazon_jp --country kr --limit 5 --concurrency 2 --min-delay 1 --max-delay 2 --out .\out_smoke_amazon_kr
python -m app crawl --site qoo10_jp --country vn --limit 5 --concurrency 2 --min-delay 1 --max-delay 2 --out .\out_smoke_qoo10_vn
```

## Dashboard
```powershell
npm run dashboard
```

브라우저에서 `http://localhost:4173` 접속.

대시보드 상단:
- 사이트 선택: `Amazon JP`, `Qoo10 JP`
- 국가 선택: `한국`, `베트남`, `대만`, `홍콩`, `마카오`, `미국`
- 데이터셋 선택: 선택한 `site + country` 조합의 latest/run 목록

대시보드 필터:
- 검색어(상품명/셀러/브랜드)
- 네트워크(`local` / `roaming` / `unknown`)
- 데이터 용량(`unlimited`, `NGB`, `1GB/day`)
- 사용기간
- 통신사 지원(SKT/KT/LGU+)
- 가격 범위
- 정렬(가격/판매량/리뷰/검색위치/사용기간)

주의:
- 태국(`th`)은 수집 대상이지만 현재 상단 국가 selector에는 노출하지 않도록 설정되어 있습니다.
- `carrier_support_kr`는 한국 통신사 기준 필드이므로 비한국 국가 데이터에서는 대부분 `unknown` 또는 null로 남을 수 있습니다.
- URL(`product_url`)은 인사이트가 낮아 UI 본문에는 직접 노출하지 않습니다.

## Output Schema
주요 필드:
- `site`, `country`, `site_product_id`
- `title`, `price_jpy`, `review_count`, `monthly_sold_count`, `is_bestseller`, `bestseller_rank`
- `validity`(하위호환), `usage_validity`, `activation_validity`, `network_type`
- `carrier_support_kr` (`skt`, `kt`, `lgu`: true/false/null)
- `data_amount`, `product_url`, `asin`, `seller`, `brand`, `evidence`

예시 JSONL:
```json
{"site":"amazon_jp","country":"kr","title":"韓国 eSIM 7日 3GB","price_jpy":1980,"usage_validity":"7일","activation_validity":"30일","network_type":"roaming","carrier_support_kr":{"skt":true,"kt":null,"lgu":null},"data_amount":"3GB","product_url":"https://www.amazon.co.jp/dp/B0ABCDEF12","asin":"B0ABCDEF12","site_product_id":"B0ABCDEF12","seller":"Example Store","brand":"Example"}
{"site":"qoo10_jp","country":"vn","title":"ベトナム eSIM 3日 unlimited","price_jpy":1080,"usage_validity":"3일","activation_validity":"90일","network_type":"unknown","carrier_support_kr":{"skt":null,"kt":null,"lgu":null},"data_amount":"unlimited","product_url":"https://www.qoo10.jp/item/ESIM/1133241666","asin":null,"site_product_id":"1133241666","seller":"Example Seller","brand":null}
```

## Tests
```powershell
python -m pytest -q
node --check dashboard_server.js
node --check dashboard\app.js
```

## Adapter Extension Guide
1. `app/adapters/<site>.py` 생성 후 `MarketplaceAdapter` 구현.
2. `search()`에서 URL/상품 식별자 스텁 반환.
3. `fetch_detail()`에서 공통 모델(`ProductDetail`)로 매핑.
4. 사이트별 셀렉터는 다중 후보 + 텍스트 패턴 fallback 유지.
5. `app/adapters/factory.py`에 사이트 등록.

## Notes
- 캡차 우회/계정 도용/공격적 차단 회피는 구현하지 않습니다.
- Amazon DOM은 자주 변경되므로 셀렉터 단일 의존을 피하고 휴리스틱을 사용합니다.
