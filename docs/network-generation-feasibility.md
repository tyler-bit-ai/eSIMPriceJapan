# Network Generation Feasibility

## Scope

This note defines how the crawler should decide whether a product is LTE/4G-only, 5G-capable, or unknown from existing Amazon JP and Qoo10 JP collected JSONL data.

Input data checked for the first pass:

- `dashboard/data/sites/<site>/<country>/latest.jsonl`
- `dashboard/data/runs/*.jsonl`
- `out_refresh_*` can be inspected later if a run-specific audit is needed.

## Current Data Shape

The normalized model currently has `network_type`, `carrier_support_local`, `carrier_support_kr`, `data_amount`, and `evidence`, but no LTE/5G generation field.

Amazon records often preserve LTE/5G clues in product titles or evidence snippets, including strings such as `5G対応`, `4G/5G対応`, and `4G/LTE`. Qoo10 records preserve title and option evidence, but the visible latest data has fewer direct LTE/5G generation clues.

## Source Strength

Strong sources:

- `title`
- `seller` and `brand` only when they directly include generation text
- `evidence.title`
- `evidence.representative_option`
- `evidence.option_candidates`
- `evidence.usage_validity`
- `evidence.activation_validity`
- `evidence.data_amount`

Fallback or weak sources:

- `evidence.network_type`
- `evidence.carrier_support_kr`
- `evidence.carrier_support_local`
- `evidence.monthly_sold_count`
- `evidence.review_count`
- `evidence.bestseller_rank`
- any uncategorized long page text that may include related products, comparisons, reviews, or page-wide fallback text

The main contamination risk is Amazon page-wide text that can include related products or comparison blocks. A fallback-only `5G` hit must not classify a product as 5G-capable.

## Classification Policy

Use `network_generation` with these values:

- `5g_capable`: a strong source directly states 5G support, for example `5G対応`, `4G/5G対応`, `5G support`, or `5G available`.
- `lte_4g_only`: a strong source states LTE/4G support, and no strong 5G support is present. Explicit 5G negative text such as `5G非対応` also maps here.
- `unknown`: no strong LTE/5G source exists, only fallback sources mention LTE/5G, or signals conflict.

`4G/5G` is treated as `5g_capable`, because the business question is whether the product provides 5G in addition to LTE/4G.

## Market Share Rules

Report two product-count shares:

- Overall share: denominator includes `unknown`.
- Known-only share: denominator excludes `unknown`.

Weighted share should be separated from product-count share:

- Amazon can use `monthly_sold_count` where available.
- Qoo10 lacks a reliable sold-count field in the current model, so review count or search position can only be labeled as a proxy.

## Reproducible Check

Run:

```powershell
$env:PYTHONIOENCODING='utf-8'
python tools/analyze_network_generation.py
```

The script prints site/country totals, provisional classification counts, strong/fallback signal counts, and conflict counts.

## Initial Findings

The first scan confirms that the current data can support a conservative LTE/5G analysis, but accuracy differs by site.

Amazon JP has many strong 5G and LTE/4G signals in the collected title/evidence text. In the country-level data, provisional `5g_capable` counts are substantial for Korea, Taiwan, Thailand, and the United States. It also has fallback-only 5G hits and conflicts, so source separation is required before using the result as a market share metric.

Qoo10 JP has far fewer direct strong hits. Some titles contain generation text, but many records remain `unknown` because the current extracted option/detail evidence often says only `高速` or `超高速` without explicit LTE/5G generation. Qoo10 market share must therefore report a high unknown rate unless a future crawl captures more direct detail text.

Past `dashboard/data/runs/*.jsonl` files may not include `country`; those are grouped as `unknown` in the feasibility script. For country-level reporting, prefer `dashboard/data/sites/<site>/<country>/latest.jsonl`.
