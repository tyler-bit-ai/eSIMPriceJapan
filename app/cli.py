from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import typer

from app.adapters.amazon_jp import AmazonJPAdapter
from app.output.writers import write_csv, write_failed_jsonl, write_jsonl
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

    if site != "amazon_jp":
        raise typer.BadParameter("Only --site amazon_jp is implemented for now")

    if min_delay > max_delay:
        raise typer.BadParameter("--min-delay must be <= --max-delay")

    asyncio.run(
        _run_crawl(
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

    adapter = await AmazonJPAdapter.create(screenshot_dir=screenshot_dir)
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

    write_jsonl(results_jsonl, result.items)
    write_csv(results_csv, result.items)
    write_failed_jsonl(failed_jsonl, result.failures)

    logger.info("saved %s items to %s", len(result.items), results_jsonl)
    logger.info("saved %s items to %s", len(result.items), results_csv)
    logger.info("saved %s failures to %s", len(result.failures), failed_jsonl)


if __name__ == "__main__":
    app()
