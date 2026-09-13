"""canon-service: the Python backend for the Lords of Cian Archive.

Owns everything LLM-orchestration-heavy or canon-graph-shaped: AI-Parse,
bulk ingestion, the Knowledge Core ratification engine, extraction commits,
and demand-score computation. Never exposed publicly -- reachable over
Railway's private network from apps/web and from scheduled jobs.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.auth import AuthenticatedUser, require_user
from app.db import close_pool, init_pool
from app.routes_knowledge_core import router as knowledge_core_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # A no-op if DATABASE_URL isn't set (see app/db.py's own docstring) --
    # /health and /me keep working either way; only /knowledge-core/* needs
    # the pool, and fails with a clear RuntimeError, not a startup crash,
    # if it's missing.
    init_pool()
    yield
    close_pool()


app = FastAPI(title="canon-service", version="0.1.0", lifespan=lifespan)
app.include_router(knowledge_core_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/me")
async def me(user: AuthenticatedUser = Depends(require_user)) -> dict[str, str | None]:
    """Verification stub: proves the Supabase-JWT-over-JWKS auth dependency
    works end-to-end."""
    return {"id": user.id, "email": user.email}
