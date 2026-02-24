from __future__ import annotations

from tenacity import retry, stop_after_attempt, wait_exponential_jitter


def retryable(attempts: int = 3):
    return retry(
        stop=stop_after_attempt(attempts),
        wait=wait_exponential_jitter(initial=1, max=8),
        reraise=True,
    )
