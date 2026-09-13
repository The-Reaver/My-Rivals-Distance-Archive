"""Postgres connection pooling for canon-service.

Plain psycopg (sync), not an async driver -- the Knowledge Core logic this
backs (app.ratification, app.extraction) is deliberately pure, synchronous,
DB-agnostic code, unit-tested with in-memory fakes. Keeping the real
repository implementations sync too means every route that uses them is a
plain `def` (not `async def`) FastAPI path operation; Starlette runs those
in a thread pool automatically, so there's no event loop blocking and no
sync/async bridge to maintain between this and the pure logic modules.

DATABASE_URL is intentionally optional at startup: the existing /health and
/me routes (JWKS-only auth, no DB) must keep working in an environment that
hasn't configured a database connection at all, matching CLAUDE.md's
documented "needs SUPABASE_URL... to serve anything beyond /health" claim.
A route that actually needs the pool without one configured gets a clear
RuntimeError instead, not a startup crash.
"""

from __future__ import annotations

import os

from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def init_pool() -> ConnectionPool | None:
    global _pool
    if _pool is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            return None
        _pool = ConnectionPool(database_url, min_size=1, max_size=5, open=True)
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_pool() -> ConnectionPool:
    if _pool is None:
        raise RuntimeError(
            "DB pool not initialized -- set DATABASE_URL and ensure init_pool() ran at startup."
        )
    return _pool
