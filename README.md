# eSIMPriceCollector_Japan

일본 마켓플레이스의 eSIM 상품을 국가별로 수집하고, 정규화된 결과를 CSV/JSONL과 대시보드로 비교하는 크롤러입니다.  
현재 `amazon_jp`, `qoo10_jp`를 지원하며, 국가 축은 `kr`, `vn`, `th`, `tw`, `hk`, `mo`, `us`를 사용합니다.

## Dashboard Preview

현재 대시보드 전체 화면 (라이트 모드, 다크 모드는 우측 상단 버튼으로 전환):

![Dashboard Full](docs/images/dashboard-full.png)

대시보드 주요 구성:
- **좌측 고정 필터**: 국가·플랫폼·사용기간(복수 선택), 네트워크, 망 세대, 데이터, 통신사, 가격 범위, 검색, 정렬, 이상치 제외
- **핵심 요약**: 현재 필터 기준 1일 최저가 카드 + 국가별 최저 1일가·변동률 카드(클릭 시 국가 필터)
- **가격 추이**: 수집 시점별 중앙가(JPY), 플랫폼별 전환
- **플랫폼 경쟁력**: 국가 × 기간 칸 중 최저가 보유 수, 5G 비율, 평균 리뷰
- **가격 히트맵**: 국가 × 사용기간 1일당 최저/중앙가 (같은 기간 열 안에서 색 비교, 셀 클릭 시 필터)
- **Local vs Roaming / 망 세대 구성**
- **시점별 변경 상품**: 이전 수집 시점을 골라 가격 인하·인상, 신규 노출, 노출 종료 비교
- **가성비 Top 10 / 전체 상품 목록**: 페이지네이션, CSV 다운로드
- **다크 모드**: 선택값 저장, 없으면 시스템 설정을 따름

## Design Note
- 실행 단위: `site + country + query`
- 크롤러 CLI: `python -m app crawl --site <site> --country <country> --limit <n> --out <dir>`
- 저장 단위: `dashboard/data/sites/<site>/<country>/latest.{jsonl,csv}`
- 대시보드 단위: `사이트 + 국가 + 데이터셋(latest/run)`
- 확장 방식: 사이트별 adapter 추가
- 레거시 호환: 기존 site-only `index.json`은 `kr` fallback으로 읽음

## Features
- Playwright 기반 Amazon JP / Qoo10 JP 검색 및 상세 수집
- 상위 N개 상품 수집 (`--limit`, 기본 50, 최대 200)
- 다중 selector + 텍스트 fallback 기반 휴리스틱 추출
- `evidence` 저장
- 실패 URL/에러/스크린샷 기록 (`failed.jsonl`)
- 출력 파일 생성
  `results.jsonl`, `results.csv`, `failed.jsonl`, `invalid.jsonl`, `invalid.csv`
- 대시보드 제공
  사이트/국가/데이터셋 선택, 필터, KPI, 정렬, 다운로드
- KRW 환산 가격 지원
  `price_jpy` 기준으로 `price_krw`를 계산해 표시 (Frankfurter 실시간 환율, 실패 시 캐시 사용)
- 비여행 상품 제외
  일본 국내 통신사 가입 패키지(UQ mobile 등)와 SIM 관련 단어가 없는 상품은 `invalid.jsonl`에
  `invalid_reason=non_travel_product`로 분리되고, 대시보드는 과거 데이터에서도 숨깁니다.
  규칙은 `app/pipeline/validation.py`와 `dashboard/travel-filter.js`에 같은 내용으로 있으며 테스트가 일치를 검사합니다.

## Install
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -r requirements-dev.txt
playwright install chromium
npm install
```

## Quick Start
기본 query는 `--country`에 맞춰 자동 선택됩니다.

```powershell
python -m app crawl --site amazon_jp --country kr --limit 50 --out .\data\crawls\out_amazon_kr
python -m app crawl --site amazon_jp --country vn --limit 50 --out .\data\crawls\out_amazon_vn
python -m app crawl --site qoo10_jp --country tw --limit 50 --out .\data\crawls\out_qoo10_tw
```

직접 query를 지정할 수도 있습니다.

```powershell
python -m app crawl --site qoo10_jp --country hk --query "eSIM 香港 5G" --limit 30 --out .\data\crawls\out_qoo10_hk_custom
```

스모크 실행:

```powershell
python -m app crawl --site amazon_jp --country kr --limit 5 --concurrency 2 --min-delay 1 --max-delay 2 --out .\data\crawls\out_smoke_amazon_kr
python -m app crawl --site qoo10_jp --country vn --limit 5 --concurrency 2 --min-delay 1 --max-delay 2 --out .\data\crawls\out_smoke_qoo10_vn
```

## Publish Workflow

### Publish Only
이미 생성된 `results.jsonl`, `results.csv`를 대시보드 데이터로 반영할 때 사용합니다.

```powershell
.\tools\publish.ps1 -OutDir .\data\crawls\out_amazon_vn -DataDir dashboard\data -Site amazon_jp -Country vn -Query "eSIM ベトナム" -Limit 50
```

### One-click
크롤링 후 정적 대시보드 데이터 반영, 커밋/푸시까지 한 번에 진행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site amazon_jp -Country kr -Limit 200 -OutDir .\data\crawls\out_auto_kr
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site amazon_jp -Country vn -Limit 100 -OutDir .\data\crawls\out_auto_vn
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site qoo10_jp -Country us -Limit 50 -OutDir .\data\crawls\out_auto_us
```

### One-time Partial Refresh
이번 1회 배포처럼 전체 재수집 없이 `qoo10_jp/th`만 갱신해야 할 때 사용합니다.

- 이 절차는 `qoo10_jp/th`의 `latest`와 신규 `run`만 갱신합니다.
- 나머지 `amazon_jp/*`, `qoo10_jp/*` latest 데이터는 마지막 게시본을 그대로 유지합니다.
- 임시 운영 경로이므로 대시보드 런타임 로직은 바꾸지 않고 `tools/` 레이어에서만 처리합니다.

새로 수집 후 바로 게시:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\run_partial_refresh_qoo10_th.ps1 -OutDir .\data\crawls\out_partial_qoo10_jp_th_20260406 -Limit 200
```

이미 생성된 태국 결과만 게시:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\run_partial_refresh_qoo10_th.ps1 -PublishOnly -OutDir .\data\crawls\out_partial_qoo10_jp_th_20260406
```

### Full Refresh After This Batch
다음 정식 수집부터는 partial refresh를 반복하지 말고, 다시 전체 대상 국가를 재수집하는 원래 방식으로 복귀합니다.

- `run_and_publish.ps1`는 정식 배치용 경로입니다.
- `amazon_jp`, `qoo10_jp`의 대상 국가를 순차 실행해 각 `site + country` latest를 다시 갱신합니다.
- 이번에 추가된 `run_partial_refresh_qoo10_th.ps1`는 태국 1회성 대응용으로만 사용합니다.

예시:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site amazon_jp -Country th -Limit 200 -OutDir .\data\crawls\out_auto_amazon_th
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site qoo10_jp -Country th -Limit 200 -OutDir .\data\crawls\out_auto_qoo10_th
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site amazon_jp -Country kr -Limit 200 -OutDir .\data\crawls\out_auto_amazon_kr
powershell -ExecutionPolicy Bypass -File .\tools\run_and_publish.ps1 -Site qoo10_jp -Country kr -Limit 200 -OutDir .\data\crawls\out_auto_qoo10_kr
```

게시 후 생성 구조 예시:

```text
dashboard/data/
  index.json
  runs/
    20260320T090000Z_amazon_jp_vn_out_amazon_vn.csv
    20260320T090000Z_amazon_jp_vn_out_amazon_vn.jsonl
  sites/
    amazon_jp/
      vn/
        latest.csv
        latest.jsonl
        metadata.json
```

## Dashboard

실행:

```powershell
# 정적 모드 (Python)
cd dashboard && python -m http.server 8090
# 또는 Node 서버
npm run dashboard
```

브라우저에서 `http://localhost:8090` (정적) 또는 `http://localhost:4173` (Node) 접속.

대시보드에서 제공하는 것:
- **데이터셋 선택**: `최신` 또는 수집 날짜별(모든 국가·플랫폼 묶음) 데이터셋
- **필터/요약/차트**: 위 `Dashboard Preview` 구성 참고 (모든 계산은 브라우저에서 수행)
- **시점별 변경 상품**: 선택한 데이터셋과 이전 수집 시점의 공통 시리즈(국가×플랫폼)만 비교하며, 수집 개수 제한이 다르면 안내를 표시
- **정렬**: 1일당, 가격, 리뷰, 판매량(Amazon), 검색 위치(Qoo10), 사용기간
- **상세 목록**: 국가, 플랫폼, 상품명(원본 링크), 가격 JPY/KRW, 1일당, 기간·활성화기간, 데이터, 네트워크, 망 세대, 통신사, 리뷰/판매
- **다운로드**: 현재 필터 결과를 CSV(UTF-8 BOM, Excel 호환)로 저장

KRW 환산 동작:
- `price_krw = Math.round(price_jpy * rate)`
- 환율은 Frankfurter 기준 `JPY/KRW`를 브라우저가 실시간 조회하고, 12시간 동안 캐시함
- 조회에 실패하면 최근 성공 환율 캐시(최대 7일)를 재사용하고, 캐시도 없으면 KRW 환산·1일당 비교를 비활성화함
- `dashboard_server.js`의 `/api/latest`, `/api/export.xlsx`는 그대로 유지되지만 화면은 정적 파일(`data/index.json`, `data/**/*.jsonl`)만 사용함

주의:
- 태국(`th`)은 이제 상단 국가 selector에 노출되며, 이번 partial refresh에서는 `qoo10_jp/th` latest만 별도로 갱신할 수 있음
- 새 스키마는 `carrier_support_local`을 우선 사용
- 한국(`kr`) 구형 데이터만 `carrier_support_kr` fallback 사용
- 비한국 구형 데이터는 제목/evidence 기반 경량 fallback으로 carrier 복원

## Output Files

기본 출력:
- `results.jsonl`
- `results.csv`
- `failed.jsonl`
- `invalid.jsonl`
- `invalid.csv`

핵심 필드:
- `site`, `country`, `site_product_id`
- `title`, `price_jpy`, `review_count`, `monthly_sold_count`, `is_bestseller`, `bestseller_rank`
- `validity`, `usage_validity`, `activation_validity`, `network_type`
- `carrier_support_local`
- `carrier_support_kr`
- `data_amount`, `product_url`, `asin`, `seller`, `brand`, `evidence`

예시 JSONL:

```json
{"site":"amazon_jp","country":"kr","title":"韓国 eSIM 7日 3GB","price_jpy":1980,"usage_validity":"7일","activation_validity":"30일","network_type":"roaming","carrier_support_local":{"skt":true,"kt":null,"lgu":null},"carrier_support_kr":{"skt":true,"kt":null,"lgu":null},"data_amount":"3GB","product_url":"https://www.amazon.co.jp/dp/B0ABCDEF12","asin":"B0ABCDEF12","site_product_id":"B0ABCDEF12","seller":"Example Store","brand":"Example"}
{"site":"qoo10_jp","country":"vn","title":"ベトナム eSIM 3日 unlimited","price_jpy":1080,"usage_validity":"3일","activation_validity":"90일","network_type":"unknown","carrier_support_local":{"viettel":true,"vinaphone":null,"mobifone":null,"vietnamobile":null},"carrier_support_kr":{"skt":null,"kt":null,"lgu":null},"data_amount":"unlimited","product_url":"https://www.qoo10.jp/item/ESIM/1133241666","asin":null,"site_product_id":"1133241666","seller":"Example Seller","brand":null}
```

## Tests
```powershell
python -m pytest -q
node --check dashboard_server.js
node --check dashboard\exchange-rate.js
node --check dashboard	ravel-filter.js
node --check dashboard\app.js
```

`dashboard_server.js` 관련 테스트를 실행하려면 `npm install`로 `xlsx` 의존성이 설치되어 있어야 합니다.

## Adapter Extension Guide
1. `app/adapters/<site>.py` 생성 후 `MarketplaceAdapter` 구현
2. `search()`에서 URL/상품 식별자 스텁 반환
3. `fetch_detail()`에서 공통 모델 `ProductDetail` 로 매핑
4. 사이트별 selector는 다중 후보 + 텍스트 fallback 유지
5. `app/adapters/factory.py`에 사이트 등록

## Notes
- 캡차 우회, 계정 도용, 공격적 차단 회피는 구현하지 않음
- Amazon DOM 변경이 잦아서 단일 selector 의존을 피하고 휴리스틱 추출을 사용함
