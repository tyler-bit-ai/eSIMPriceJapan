# eSIMPriceCollector_Japan

Amazon Japan에서 `eSIM Korea` 검색 결과를 수집하는 크롤러입니다.  
플러그인(어댑터) 기반 구조로 다른 마켓플레이스 확장이 가능합니다.

## Features
- Playwright 기반 Amazon JP 검색/상세 수집
- 상위 N개 상품 수집 (`--limit`, 기본 50)
- 근거(evidence) 텍스트 추출
- 실패 URL/에러/스크린샷 경로 기록 (`failed.jsonl`)
- 출력: `results.jsonl`, `results.csv`
- 대시보드에서 최신 CSV를 정적 로드 + 필터/KPI

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
python -m app crawl --site amazon_jp --query "eSIM Korea" --limit 50 --out .\out
```

### Smoke (E2E-lite)
```powershell
python -m app crawl --site amazon_jp --query "eSIM Korea" --limit 5 --concurrency 2 --min-delay 1 --max-delay 2 --out .\out_smoke
```

## Dashboard (GitHub Pages / Static)
최신 결과(`results.csv`)를 `dashboard/data/latest.csv`로 복사해 대시보드에서 읽습니다.

### 1) 크롤링
```powershell
python -m app crawl --site amazon_jp --query "eSIM Korea" --limit 50 --out .\out
```

### 2) 퍼블리시 (CSV 복사)
```powershell
.\tools\publish.ps1 -OutDir .\out
```

### 3) 로컬 확인
```powershell
python -m http.server 4173
```
브라우저에서 `http://localhost:4173/dashboard/` 접속.

### GitHub Pages
- 이 저장소 `main` 브랜치 root에서 Pages 활성화
- 접속 URL: `https://<org>.github.io/<repo>/dashboard/`

대시보드 필터:
- 검색어(상품명/셀러/브랜드)
- 네트워크(local/roaming)
- 데이터 용량(`unlimited`, `NGB`)
- 사용기간 / 활성화기한
- 통신사 지원(SKT/KT/LGU+)
- 가격 범위

## Output Schema
주요 필드:
- `title`, `price_jpy`, `validity`, `usage_validity`, `activation_validity`, `network_type`
- `carrier_support_kr` (`skt`, `kt`, `lgu`: true/false/null)
- `data_amount`, `product_url`, `asin`, `seller`, `brand`, `evidence`

JSONL 예시:
```json
{"title":"Korea eSIM 7일 3GB","price_jpy":1980,"usage_validity":"7일","activation_validity":"30일","network_type":"roaming","carrier_support_kr":{"skt":true,"kt":null,"lgu":null},"data_amount":"3GB","product_url":"https://www.amazon.co.jp/dp/B0ABCDEF12","asin":"B0ABCDEF12","seller":"Example Store","brand":"Example"}
{"title":"Korea eSIM 30일 unlimited","price_jpy":3980,"usage_validity":"30일","activation_validity":"120일","network_type":"local","carrier_support_kr":{"skt":null,"kt":true,"lgu":true},"data_amount":"unlimited","product_url":"https://www.amazon.co.jp/dp/B0ABCDEF34","asin":"B0ABCDEF34","seller":"Another Store","brand":"Another"}
```

## Tests
```powershell
python -m pytest -q
```

## Adapter Extension Guide (Rakuten 등)
1. `app/adapters/<site>.py` 생성 후 `MarketplaceAdapter` 구현.
2. `search()`에서 URL/상품 스텁 리스트 반환.
3. `fetch_detail()`에서 공통 모델(`ProductDetail`)로 매핑.
4. 셀렉터 다중 후보 + 텍스트 패턴 fallback 사용.
5. `app/cli.py`에 `--site` 분기 추가.

## Notes
- 캡차 우회/계정 사용/공격적 우회는 구현하지 않습니다.
- Amazon DOM은 자주 변하므로 셀렉터 변경에 대비한 테스트/모니터링 필요.
