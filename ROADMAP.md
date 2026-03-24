# Qoo10 Japan Integration Roadmap

## Scope
- [x] Keep Amazon JP and Qoo10 JP in the same adapter-based project.
- [x] Add `qoo10_jp` crawler support to the shared CLI and pipeline.
- [x] Extend normalized output for multi-site tracking with `site` and `site_product_id`.
- [x] Update dashboard data publishing and UI for site switching.
- [x] Run tests and smoke verification after implementation.

## Implementation Checklist
- [x] Create this roadmap and use it as the execution checklist.
- [x] Update shared models, writers, and adapter registry.
- [x] Implement `Qoo10JPAdapter`.
- [x] Extend extraction heuristics for Qoo10 wording and pricing.
- [x] Add or update automated tests.
- [x] Update dashboard server, static data index handling, and frontend site selector.
- [x] Update publish scripts and README.

## Verification Checklist
- [x] `python -m pytest -q`
- [x] `python -m app crawl --site qoo10_jp --query "eSIM 韓国" --limit 5 --concurrency 2 --min-delay 1 --max-delay 2 --out .\out_smoke_qoo10`
- [x] Validate generated `results.jsonl`, `results.csv`, and `failed.jsonl`.
- [x] Validate published dashboard index and site switching behavior.

## Open Issues / Assumptions
- Qoo10 top-N ordering uses the marketplace's default popular ranking.
- Qoo10 fields equivalent to Amazon monthly sales and bestseller rank may remain `null`.
- 일부 Qoo10 상품은 옵션 목록에 여러 일수 플랜이 함께 있어 `usage_validity`/`activation_validity`가 대표 옵션 기준으로 완벽하지 않을 수 있다.

## Result
- Implemented.
- Test result:
  - `python -m pytest -q` -> `29 passed`
  - `python -m app crawl --site qoo10_jp --query "eSIM 韓国" --limit 5 --concurrency 2 --min-delay 1 --max-delay 2 --out .\out_smoke_qoo10` -> success, `results.jsonl/results.csv/failed.jsonl` generated
  - `powershell -ExecutionPolicy Bypass -File .\tools\publish.ps1 -OutDir .\out_smoke_qoo10 -DataDir dashboard\data -Site qoo10_jp -Query "eSIM 韓国" -Limit 5` -> success
  - `node -e "const srv=require('./dashboard_server'); ..."` -> Amazon/Qoo10 latest dataset resolution verified
