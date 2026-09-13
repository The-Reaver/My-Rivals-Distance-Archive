"""Admin authorization for canon-service.

Layered on top of require_user's JWT verification: this additionally
checks whether the authenticated reader's row in public.reader_profiles
has is_admin = true, using canon-service's own database connection.
canon-service always has DB access regardless -- the knowledge_core schema
it owns is reachable only via a service_role connection in the first place
(0002_knowledge_core_schema.sql revokes it from anon/authenticated
entirely), so checking one more table on that same connection adds no new
privilege surface.

A sync function, like the repositories it pairs with: FastAPI runs sync
dependencies in a thread pool the same way it runs sync path operations,
so this composes cleanly with require_user (async, JWKS-only, no DB) without
needing an async-to-sync bridge.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException

from app.auth import AuthenticatedUser, require_user
from app.db import get_pool


def require_admin(user: AuthenticatedUser = Depends(require_user)) -> AuthenticatedUser:
    pool = get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "select is_admin from public.reader_profiles where id = %s", (user.id,)
        ).fetchone()

    if row is None or not row[0]:
        raise HTTPException(status_code=403, detail="Admin access required")

    return user
