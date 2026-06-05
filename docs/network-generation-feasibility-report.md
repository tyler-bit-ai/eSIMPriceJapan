# Network Generation Feasibility Report

This report is generated from collected JSONL files using the source-strength policy in `docs/network-generation-feasibility.md`.

| Site/Country | Total | 5G capable | LTE/4G only | Unknown | Known 5G share | Known LTE share | Fallback-only signals | Conflicts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| amazon_jp/hk | 820 | 241 | 44 | 535 | 85% | 15% | 499 | 47 |
| amazon_jp/kr | 820 | 405 | 35 | 380 | 92% | 8% | 353 | 29 |
| amazon_jp/mo | 820 | 222 | 34 | 564 | 87% | 13% | 531 | 43 |
| amazon_jp/th | 800 | 213 | 19 | 568 | 92% | 8% | 548 | 27 |
| amazon_jp/tw | 820 | 299 | 20 | 501 | 94% | 6% | 477 | 28 |
| amazon_jp/unknown | 400 | 169 | 19 | 212 | 90% | 10% | 197 | 17 |
| amazon_jp/us | 820 | 357 | 3 | 460 | 99% | 1% | 430 | 30 |
| amazon_jp/vn | 820 | 169 | 14 | 637 | 92% | 8% | 604 | 39 |
| qoo10_jp/hk | 308 | 1 | 0 | 307 | 100% | 0% | 291 | 16 |
| qoo10_jp/kr | 575 | 7 | 0 | 568 | 100% | 0% | 568 | 0 |
| qoo10_jp/mo | 405 | 1 | 0 | 404 | 100% | 0% | 404 | 0 |
| qoo10_jp/th | 777 | 6 | 7 | 764 | 46% | 54% | 771 | 0 |
| qoo10_jp/tw | 395 | 18 | 3 | 374 | 86% | 14% | 377 | 0 |
| qoo10_jp/unknown | 415 | 0 | 0 | 415 | 0% | 0% | 415 | 0 |
| qoo10_jp/us | 587 | 0 | 0 | 587 | 0% | 0% | 571 | 16 |
| qoo10_jp/vn | 552 | 1 | 8 | 543 | 11% | 89% | 551 | 0 |
| unknown/unknown | 201 | 74 | 11 | 116 | 87% | 13% | 111 | 6 |

## Interpretation

- Amazon JP has enough direct generation signals to produce a conservative known-only LTE/5G split for several countries.
- Qoo10 JP remains mostly unknown in current collected data because many product texts use speed words such as `高速` or `超高速` without explicit LTE/5G generation.
- Fallback-only signals and conflicts are not promoted to 5G-capable; they are treated as unknown to avoid related-product contamination.
- Exact market share should be based on newly crawled source-separated records. Existing RAW can show feasibility and rough known-only proportions, not a final market truth.
