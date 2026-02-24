# Agent Rules — eSIM Marketplace Crawler (Amazon JP → Multi-site)

## Mission
Build and maintain a production-oriented crawler that collects the top N eSIM products from a marketplace search and outputs normalized data for analysis. Start with Amazon Japan (amazon.co.jp), but keep the architecture extensible to other sites (Rakuten, etc.).

## Non-negotiables
- Use a plugin/adapter architecture: one adapter per site.
- Provide a single CLI entrypoint:
  - `python -m app crawl --site <site> --query "<q>" --limit <n> --out <dir>`
- Output at least:
  - `results.jsonl` (1 product per line)
  - `results.csv`
  - Also write `failed.jsonl` for failures.

## Data model (normalized fields)
Each product record MUST include:
- `title`
- `price_jpy` (int or null)
- `validity` (string or null; e.g., "7 days", "30 days")
- `network_type` ("local" | "roaming" | "unknown")
- `carrier_support_kr` (object with `SKT`, `KT`, `LGU+` as true/false/"unknown")
- `data_amount` (string or null)
- `product_url`
- `asin` (string or null)
- `brand` / `seller` (string or null)
- `evidence` (short supporting text snippets for key inferences)

## Extraction principles
- Prefer robust heuristics over brittle single selectors:
  - multiple candidate selectors + text-pattern fallback
- Always store `evidence` when inferring:
  - validity, network_type, carrier support
- Standardize:
  - Price: strip currency/commas → integer JPY
  - Validity: detect patterns like `日/日間/有効期限/利用期間/validity`
  - Network type:
    - "現地回線/ローカル/local" → local
    - "ローミング/国際ローミング/roaming" → roaming
    - else unknown
  - Carrier support (KR):
    - detect mentions of `SKT/KT/LG U+/Uplus` + Korea context
    - if Korea-use is implied but carriers not named → all "unknown"

## Crawling approach (Amazon JP baseline)
- Use Playwright (Chromium) for reliability; httpx/bs4 may be used as auxiliary.
- No aggressive bypass/illegal evasion:
  - Do NOT solve CAPTCHAs or use shady anti-bot services.
  - Do NOT use stolen accounts or scraping attacks.
- Stability measures:
  - concurrency default 2–4
  - randomized delay option (e.g., 1–3s)
  - retries with exponential backoff
  - save screenshots on parse failures (Playwright)
  - record error type/status/URL in `failed.jsonl`

## Quality gates
- Implement a smoke mode:
  - `--limit 5` must run end-to-end and create output files.
- Keep logs informative (progress, retries, parse fallbacks).
- When extraction is uncertain, return null/"unknown" + evidence rather than guessing.

## Extensibility
- New site support must be added by implementing a new adapter only:
  - `AmazonJPAdapter`, `RakutenAdapter`, etc.
- Shared utilities:
  - normalizers (price, validity, carrier support)
  - persistence writers (jsonl/csv)
  - retry/delay logic

## Deliverables expectation
When asked to implement changes, produce:
1) brief design note (module boundaries / flow)
2) code changes
3) updated run commands + expected output schema snippet