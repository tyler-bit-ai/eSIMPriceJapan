from __future__ import annotations

import random
import asyncio


async def random_delay(min_seconds: float, max_seconds: float) -> None:
    await asyncio.sleep(random.uniform(min_seconds, max_seconds))
