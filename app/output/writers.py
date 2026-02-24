from __future__ import annotations

import csv
import json
from pathlib import Path

from app.models import CrawlError, ProductDetail, model_to_row


def write_jsonl(path: Path, items: list[ProductDetail]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(model_to_row(item), ensure_ascii=False) + "\n")


def write_csv(path: Path, items: list[ProductDetail]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "title",
        "price_jpy",
        "validity",
        "usage_validity",
        "activation_validity",
        "network_type",
        "carrier_support_kr",
        "data_amount",
        "product_url",
        "asin",
        "seller",
        "brand",
        "evidence",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for item in items:
            row = model_to_row(item)
            row["carrier_support_kr"] = json.dumps(row["carrier_support_kr"], ensure_ascii=False)
            row["evidence"] = json.dumps(row["evidence"], ensure_ascii=False)
            writer.writerow(row)


def write_failed_jsonl(path: Path, failures: list[CrawlError]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for failure in failures:
            f.write(json.dumps(model_to_row(failure), ensure_ascii=False) + "\n")
