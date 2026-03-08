from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import typer

from app.adapters.factory import create_adapter, get_supported_sites
from app.output.writers import (
    write_csv,
    write_failed_jsonl,
    write_invalid_csv,
    write_invalid_jsonl,
    write_jsonl,
)
from app.pipeline.crawler import CrawlPipeline
from app.utils.logging import configure_logging

app = typer.Typer(help="Marketplace crawler CLI")
logger = logging.getLogger(__name__)


@app.callback()
def main() -> None:
    """CLI root."""


@app.command("crawl")
def crawl(
    site: str = typer.Option("amazon_jp", "--site"),
    query: str = typer.Option("eSIM Korea", "--query"),
    limit: int = typer.Option(50, "--limit", min=1, max=200),
    out: Path = typer.Option(Path("./out"), "--out"),
    concurrency: int = typer.Option(3, "--concurrency", min=1, max=8),
    min_delay: float = typer.Option(1.0, "--min-delay"),
    max_delay: float = typer.Option(3.0, "--max-delay"),
    max_retries: int = typer.Option(3, "--max-retries", min=1, max=10),
    verbose: bool = typer.Option(False, "--verbose"),
) -> None:
    """Crawl marketplace and export JSONL/CSV results."""
    configure_logging(verbose=verbose)

    supported_sites = get_supported_sites()
    if site not in supported_sites:
        supported = ", ".join(supported_sites)
        raise typer.BadParameter(f"Unsupported --site {site}. Supported: {supported}")

    if min_delay > max_delay:
        raise typer.BadParameter("--min-delay must be <= --max-delay")

    asyncio.run(
        _run_crawl(
            site=site,
            query=query,
            limit=limit,
            out=out,
            concurrency=concurrency,
            min_delay=min_delay,
            max_delay=max_delay,
            max_retries=max_retries,
        )
    )


async def _run_crawl(
    site: str,
    query: str,
    limit: int,
    out: Path,
    concurrency: int,
    min_delay: float,
    max_delay: float,
    max_retries: int,
) -> None:
    out.mkdir(parents=True, exist_ok=True)
    screenshot_dir = out / "screenshots"

    adapter = await create_adapter(site=site, screenshot_dir=screenshot_dir)
    try:
        pipeline = CrawlPipeline(
            adapter=adapter,
            out_dir=out,
            concurrency=concurrency,
            min_delay=min_delay,
            max_delay=max_delay,
            max_retries=max_retries,
        )
        result = await pipeline.run(query=query, limit=limit)
    finally:
        await adapter.close()

    results_jsonl = out / "results.jsonl"
    results_csv = out / "results.csv"
    failed_jsonl = out / "failed.jsonl"
    invalid_jsonl = out / "invalid.jsonl"
    invalid_csv = out / "invalid.csv"

    write_jsonl(results_jsonl, result.items)
    write_csv(results_csv, result.items)
    write_failed_jsonl(failed_jsonl, result.failures)
    write_invalid_jsonl(invalid_jsonl, result.invalid_items)
    write_invalid_csv(invalid_csv, result.invalid_items)

    logger.info("saved %s items to %s", len(result.items), results_jsonl)
    logger.info("saved %s items to %s", len(result.items), results_csv)
    logger.info("saved %s failures to %s", len(result.failures), failed_jsonl)
    logger.info("saved %s invalid items to %s", len(result.invalid_items), invalid_jsonl)
    logger.info("saved %s invalid items to %s", len(result.invalid_items), invalid_csv)


if __name__ == "__main__":
    app()
