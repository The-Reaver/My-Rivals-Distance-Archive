"""canon-service: the Python backend for the Lords of Cian Archive.

Owns everything LLM-orchestration-heavy or canon-graph-shaped: AI-Parse,
bulk ingestion, the Knowledge Core ratification engine, extraction commits,
and demand-score computation. Never exposed publicly -- reachable only over
Railway's private network from apps/web and from scheduled jobs.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI

from app.auth import AuthenticatedUser, require_user

app = FastAPI(title="canon-service", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/me")
async def me(user: AuthenticatedUser = Depends(require_user)) -> dict[str, str | None]:
    """Verification stub: proves the Supabase-JWT-over-JWKS auth dependency
    works end-to-end. Real admin/ratification routes land in a later pass."""
    return {"id": user.id, "email": user.email}
